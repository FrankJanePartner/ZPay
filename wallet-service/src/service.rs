use axum::{extract::State, http::{HeaderMap, StatusCode}, routing::{get, post}, Json, Router};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Arc, time::Duration};
use subtle::ConstantTimeEq;
use tokio::sync::Mutex;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};
use crate::{network, storage, vault};

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
            "service": "ZPay wallet service", "settlement_enabled": false
        })) }))
        .route("/v1/probe", get(probe))
        .route("/v1/addresses", post(allocate))
        .with_state(app)
}

async fn probe(State(app): State<App>, headers: HeaderMap) -> Result<Json<serde_json::Value>, ApiError> {
    authorize(&headers, &app.token)?;
    let (tip, tree) = tokio::time::timeout(Duration::from_secs(10), network::get_birthday_tree_state(&app.endpoint))
        .await.map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "lightwalletd timed out"))?
        .map_err(|_| error(StatusCode::SERVICE_UNAVAILABLE, "lightwalletd probe failed"))?;
    Ok(Json(serde_json::json!({"chain_tip": tip, "tree_height": tree.height, "network": tree.network})))
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

