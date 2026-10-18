use axum::{extract::State, http::{HeaderMap, StatusCode}, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Arc, time::Duration};
use subtle::ConstantTimeEq;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};
use crate::{network, send, storage, vault};

#[derive(Clone)]
pub struct App {
    pub directory: PathBuf,
    pub endpoint: String,
    pub key: Arc<Zeroizing<[u8; 32]>>,
    pub token: Arc<Zeroizing<String>>,
    // All wallet mutations are serialized in this first implementation.
    pub lock: Arc<Mutex<()>>,
}

#[derive(Deserialize)]
pub struct AllocationInput {
    merchant_id: String,
    request_id: Uuid,
}

#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct SendInput {
    merchant_id: String,
    request_id: Uuid,
    recipient_address: String,
    amount_zatoshis: u64,
    memo: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct CompletedSend {
    input: SendInput,
    txids: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SendResult {
    merchant_id: String,
    request_id: Uuid,
    txids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct Allocation {
    merchant_id: String,
    request_id: Uuid,
    address: String,
}

type ApiError = (StatusCode, Json<serde_json::Value>);

fn error(status: StatusCode, detail: &str) -> ApiError {
    (status, Json(serde_json::json!({"detail": detail})))
}

fn authorize(headers: &HeaderMap, token: &str) -> Result<(), ApiError> {
    let provided = headers.get("authorization").and_then(|h| h.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer ")).unwrap_or("");
    if provided.as_bytes().ct_eq(token.as_bytes()).into() { Ok(()) }
    else { Err(error(StatusCode::UNAUTHORIZED, "Invalid service token")) }
}

fn validate_merchant(merchant: &str) -> Result<(), ApiError> {
    // Django's persisted user ID, canonical decimal string; never a filesystem path.
    let value = merchant.parse::<u64>().ok().filter(|n| *n > 0);
    if value.is_some_and(|n| n.to_string() == merchant) { Ok(()) }
    else { Err(error(StatusCode::BAD_REQUEST, "Invalid merchant_id")) }
}

pub fn router(app: App) -> Router {
    Router::new()
        .route("/health", get(|| async { Json(serde_json::json!({
            "service": "ZOERDWALLET Wallet Service", "settlement_enabled": false
        })) }))
        .route("/v1/probe", get(probe))
        .route("/v1/addresses", post(allocate))
        .route("/v1/send", post(send_payment))
        .route("/v1/snapshot", post(snapshot))
        .with_state(app)
}

async fn probe(State(app): State<App>, headers: HeaderMap) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&headers, &app.token)?;
    let (tip, tree) = tokio::time::timeout(Duration::from_secs(10), network::get_birthday_tree_state(&app.endpoint))
        .await.map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "lightwalletd timed out"))?
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "lightwalletd probe failed"))?;
    Ok(Json(serde_json::json!({"chain_tip": tip, "tree_height": tree.height, "network": tree.network})))
}

async fn send_payment(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<SendInput>,
) -> Result<Json<SendResult>, ApiError> {
    authorize(&headers, &app.token)?;
    validate_merchant(&input.merchant_id)?;

    if input.amount_zatoshis == 0 || input.amount_zatoshis > 2_100_000_000_000_000 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Amount is outside the valid Zcash monetary range",
        ));
    }

    if input.recipient_address.trim().is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "Recipient address is required"));
    }

    let _guard = app.lock.lock().await;

    let result = send_inner(&app, input).await.map_err(|e| {
        eprintln!("Wallet send failed: {e}");

        if e.starts_with("Failed to create transaction proposal: InsufficientFunds {") {
            (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(serde_json::json!({
                    "code": "insufficient_funds",
                    "detail": "Insufficient ZEC balance to cover the transfer amount and network fee."
                })),
            )
        } else {
            error(
                StatusCode::SERVICE_UNAVAILABLE,
                "Wallet send outcome could not be confirmed. Check the transaction status before retrying.",
            )
        }
    })?;

    Ok(Json(result))
}


fn send_paths(merchant: &Path, request_id: Uuid) -> (PathBuf, PathBuf) {
    let directory = merchant.join("requests");
    (
        directory.join(format!("send-{request_id}.intent.json")),
        directory.join(format!("send-{request_id}.json")),
    )
}

fn check_send_journal(
    intent: &Path,
    completed: &Path,
    input: &SendInput,
) -> Result<Option<SendResult>, String> {
    if completed.exists() {
        // Older completed journals did not record the destination or amount.
        // Never replay an unverifiable payment under a reused request ID.
        let previous: CompletedSend = serde_json::from_slice(
            &fs::read(completed).map_err(|e| e.to_string())?,
        ).map_err(|_| "Legacy or damaged send journal requires reconciliation".to_string())?;
        if previous.input != *input {
            return Err("Send journal payload mismatch".into());
        }
        return Ok(Some(SendResult {
            merchant_id: input.merchant_id.clone(),
            request_id: input.request_id,
            txids: previous.txids,
        }));
    }
    if intent.exists() {
        let previous: SendInput = serde_json::from_slice(
            &fs::read(intent).map_err(|e| e.to_string())?,
        ).map_err(|_| "Damaged send intent requires reconciliation".to_string())?;
        if previous != *input {
            return Err("Send intent payload mismatch".into());
        }
        return Err("Previous send attempt requires reconciliation; automatic retry blocked".into());
    }
    Ok(None)
}

fn begin_send(intent: &Path, input: &SendInput) -> Result<(), String> {
    vault::persist_new(
        intent,
        &serde_json::to_vec(input).map_err(|e| e.to_string())?,
    )
}

fn finish_send(completed: &Path, input: &SendInput, txids: Vec<String>)
    -> Result<SendResult, String>
{
    let record = CompletedSend { input: input.clone(), txids: txids.clone() };
    vault::persist_new(
        completed,
        &serde_json::to_vec(&record).map_err(|e| e.to_string())?,
    )?;
    Ok(SendResult {
        merchant_id: input.merchant_id.clone(),
        request_id: input.request_id,
        txids,
    })
}

async fn send_inner(app: &App, input: SendInput) -> Result<SendResult, String> {
    let merchant = app.directory.join("merchants").join(&input.merchant_id);
    let wallet_path = merchant.join("wallet.sqlite");

    if !wallet_path.is_file() {
        return Err("Merchant wallet not allocated".into());
    }

    let (intent, completed) = send_paths(&merchant, input.request_id);
    if let Some(previous) = check_send_journal(&intent, &completed, &input)? {
        return Ok(previous);
    }

    let encrypted =
        fs::read(merchant.join("recovery.enc")).map_err(|e| e.to_string())?;
    let plaintext = vault::open(&app.key, &input.merchant_id, &encrypted)?;

    #[derive(Deserialize)]
    struct RecoveryRecord { recovery_phrase: String }

    let mut created: RecoveryRecord =
        serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;

    // Durable intent is committed before building, signing or broadcasting.
    // On interruption, the request remains blocked until reconciled.
    if let Err(e) = begin_send(&intent, &input) {
        created.recovery_phrase.zeroize();
        return Err(e);
    }

    let result = send::send_zatoshis(
        &wallet_path,
        &app.endpoint,
        &created.recovery_phrase,
        &input.recipient_address,
        input.amount_zatoshis,
        input.memo.as_deref(),
    ).await;
    created.recovery_phrase.zeroize();

    let txids = match result {
        Ok(txids) => txids,
        Err(e) => {
            if e.starts_with("Failed to create transaction proposal: InsufficientFunds {") {
                // This failure is before signing and broadcasting.
                // If removal or directory fsync fails, report an uncertain
                // outcome and keep the caller from assuming a safe retry.
                fs::remove_file(&intent).map_err(|x| x.to_string())?;
                fs::File::open(intent.parent().ok_or("Invalid intent path")?)
                    .and_then(|f| f.sync_all()).map_err(|x| x.to_string())?;
            }
            return Err(e);
        }
    };
    finish_send(&completed, &input, txids)
}

async fn allocate(State(app): State<App>, headers: HeaderMap, Json(input): Json<AllocationInput>)
    -> Result<Json<Allocation>, ApiError>
{
    authorize(&headers, &app.token)?;
    validate_merchant(&input.merchant_id)?;
    let _guard = app.lock.lock().await;
    let result = allocate_inner(&app, input).await.map_err(|e| {
        // Errors contain no request payload, recovery phrase or authentication token.
        eprintln!("Wallet allocation failed: {e}");
        error(StatusCode::SERVICE_UNAVAILABLE, "Wallet allocation unavailable; retry same request_id")
    })?;
    Ok(Json(result))
}

async fn allocate_inner(app: &App, input: AllocationInput) -> Result<Allocation, String> {
    let merchant = app.directory.join("merchants").join(&input.merchant_id);
    if !merchant.exists() {
        // The reused wallet code is mainnet-only. Reject a different node network.
        let (_, tree) = tokio::time::timeout(Duration::from_secs(10), network::get_birthday_tree_state(&app.endpoint))
            .await.map_err(|_| "lightwalletd probe timed out")??;
        if tree.network != "main" && tree.network != "mainnet" {
            return Err("Existing wallet engine requires a mainnet lightwalletd endpoint".into());
        }
        let parent = app.directory.join("merchants");
        vault::private_directory(&parent)?;
        let staging = tempfile::tempdir_in(&parent).map_err(|e| e.to_string())?;
        let mut created = tokio::time::timeout(
            Duration::from_secs(15),
            storage::create_new_wallet(staging.path().join("wallet.sqlite"), &app.endpoint),
        ).await.map_err(|_| "Wallet creation timed out")??;
        let plaintext = Zeroizing::new(serde_json::to_vec(&created).map_err(|e| e.to_string())?);
        let encrypted = vault::seal(&app.key, &input.merchant_id, &plaintext)?;
        created.recovery_phrase.zeroize();
        vault::persist_new(&staging.path().join("recovery.enc"), &encrypted)?;
        vault::private_directory(&staging.path().join("requests"))?;
        // Wallet DB was committed and closed by create_new_wallet.
        fs::File::open(staging.path().join("wallet.sqlite"))
            .and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
        fs::rename(staging.path(), &merchant).map_err(|e| e.to_string())?;
        fs::File::open(&parent).and_then(|f| f.sync_all()).map_err(|e| e.to_string())?;
    }
    // Fail closed if the encrypted recovery record cannot be decrypted.
    let encrypted = fs::read(merchant.join("recovery.enc")).map_err(|e| e.to_string())?;
    let _recovery = vault::open(&app.key, &input.merchant_id, &encrypted)?;
    let journal = merchant.join("requests").join(format!("{}.json", input.request_id));
    allocate_once(&journal, input, || storage::create_next_address(merchant.join("wallet.sqlite")))
}

fn allocate_once(journal: &std::path::Path, input: AllocationInput, generate: impl FnOnce() -> Result<String, String>)
    -> Result<Allocation, String>
{
    if journal.exists() {
        let previous: Allocation = serde_json::from_slice(&fs::read(journal).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if previous.merchant_id != input.merchant_id || previous.request_id != input.request_id {
            return Err("Allocation journal identity mismatch".into());
        }
        return Ok(previous);
    }
    let address = generate()?;
    address.parse::<zcash_address::ZcashAddress>().map_err(|_| "Wallet returned an invalid address")?;
    let allocation = Allocation { merchant_id: input.merchant_id, request_id: input.request_id, address };
    vault::persist_new(journal, &serde_json::to_vec(&allocation).map_err(|e| e.to_string())?)?;
    Ok(allocation)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_send() -> SendInput {
        SendInput {
            merchant_id: "42".into(),
            request_id: Uuid::new_v4(),
            recipient_address: "test-recipient".into(),
            amount_zatoshis: 27900,
            memo: Some("test memo".into()),
        }
    }

    #[test]
    fn interrupted_send_blocks_replay() {
        let dir = tempfile::tempdir().unwrap();
        let input = test_send();
        let (intent, completed) = send_paths(dir.path(), input.request_id);
        begin_send(&intent, &input).unwrap();
        assert!(check_send_journal(&intent, &completed, &input)
            .unwrap_err().contains("reconciliation"));
    }

    #[test]
    fn completed_send_replays_and_rejects_changed_payload() {
        let dir = tempfile::tempdir().unwrap();
        let input = test_send();
        let (intent, completed) = send_paths(dir.path(), input.request_id);
        begin_send(&intent, &input).unwrap();
        finish_send(&completed, &input, vec!["a".repeat(64)]).unwrap();
        let replay = check_send_journal(&intent, &completed, &input)
            .unwrap().unwrap();
        assert_eq!(replay.txids, vec!["a".repeat(64)]);
        let mut changed = input.clone();
        changed.memo = Some("different".into());
        assert!(check_send_journal(&intent, &completed, &changed).is_err());
    }

    #[test]
    fn legacy_send_record_requires_reconciliation() {
        let dir = tempfile::tempdir().unwrap();
        let input = test_send();
        let (intent, completed) = send_paths(dir.path(), input.request_id);
        let old = SendResult {
            merchant_id: input.merchant_id.clone(),
            request_id: input.request_id,
            txids: vec!["a".repeat(64)],
        };
        vault::persist_new(&completed, &serde_json::to_vec(&old).unwrap()).unwrap();
        assert!(check_send_journal(&intent, &completed, &input).is_err());
    }

    #[test]
    fn journal_replay_survives_restart_and_rejects_wrong_merchant() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.json");
        let request_id = Uuid::new_v4();
        let original = Allocation { merchant_id: "42".into(), request_id, address: "persisted-test-record".into() };
        vault::persist_new(&path, &serde_json::to_vec(&original).unwrap()).unwrap();
        let replay = allocate_once(&path, AllocationInput { merchant_id: "42".into(), request_id },
            || panic!("A replay must not allocate another address")).unwrap();
        assert_eq!(replay.address, "persisted-test-record");
        assert!(allocate_once(&path, AllocationInput { merchant_id: "43".into(), request_id },
            || panic!("Mismatched identity must not allocate")).is_err());
    }
    #[test]
    fn allocation_failure_does_not_publish_a_journal_record() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("request.json");
        assert!(allocate_once(&path, AllocationInput { merchant_id: "42".into(), request_id: Uuid::new_v4() },
            || Err("provider unavailable".into())).is_err());
        assert!(!path.exists());
    }
    #[test]
    fn merchant_ids_cannot_escape_the_data_directory() {
        for id in ["../1", "/tmp", "", "0", "-1", "01", "1/2"] {
            assert!(validate_merchant(id).is_err());
        }
        assert!(validate_merchant("42").is_ok());
    }
    #[test]
    fn service_auth_rejects_missing_and_wrong_tokens() {
        let mut headers = HeaderMap::new();
        assert!(authorize(&headers, "test-only").is_err());
        headers.insert("authorization", "Bearer incorrect".parse().unwrap());
        assert!(authorize(&headers, "test-only").is_err());
        headers.insert("authorization", "Bearer test-only".parse().unwrap());
        assert!(authorize(&headers, "test-only").is_ok());
    }
}


#[derive(Deserialize)]
struct SnapshotInput { merchant_id: String, timeout_seconds: Option<u64> }

async fn snapshot(State(app): State<App>, headers: HeaderMap, Json(input): Json<SnapshotInput>)
    -> Result<Json<serde_json::Value>, ApiError>
{
    authorize(&headers, &app.token)?;
    validate_merchant(&input.merchant_id)?;
    let timeout_seconds = input.timeout_seconds.unwrap_or(120);
    if !(60..=1800).contains(&timeout_seconds) {
        return Err(error(StatusCode::BAD_REQUEST, "timeout_seconds must be between 60 and 1800"));
    }
    let path = app.directory.join("merchants").join(&input.merchant_id).join("wallet.sqlite");
    if !path.is_file() { return Err(error(StatusCode::NOT_FOUND, "Merchant wallet not allocated")); }
    let operation = async {
        let _guard = app.lock.lock().await;
        eprintln!("Wallet snapshot: starting SDK scan (budget {timeout_seconds} seconds)");
        storage::sync_existing_wallet(&path, &app.endpoint).await
            .map_err(|e| format!("SDK scan failed: {e}"))?;
        eprintln!("Wallet snapshot: SDK scan completed; reading snapshot");
        crate::snapshot::read(&path, &input.merchant_id)
            .map_err(|e| format!("Snapshot read failed: {e}"))
    };
    match tokio::time::timeout(Duration::from_secs(timeout_seconds), operation).await {
        Ok(Ok(value)) => Ok(Json(value)),
        Ok(Err(cause)) => {
            eprintln!("Wallet snapshot failed: {cause}");
            Err(error(StatusCode::SERVICE_UNAVAILABLE, "Wallet snapshot failed; check wallet-service terminal"))
        }
        Err(_) => {
            eprintln!("Wallet snapshot timed out after {timeout_seconds} seconds");
            Err(error(StatusCode::SERVICE_UNAVAILABLE, "Wallet scan exceeded its configured timeout"))
        }
    }
}
