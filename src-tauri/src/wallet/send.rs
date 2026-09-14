use bip39::{
    Language,
    Mnemonic,
};

use zcash_address::ZcashAddress;
use zcash_keys::keys::UnifiedSpendingKey;
use zcash_protocol::{
    consensus::Network,
    value::Zatoshis,
};

use zip321::{
    Payment,
    TransactionRequest,
};

pub fn spending_key_from_recovery_phrase(
    recovery_phrase: &str,
) -> Result<UnifiedSpendingKey, String> {
    let mnemonic = Mnemonic::parse_in(
        Language::English,
        recovery_phrase.trim(),
    )
    .map_err(|e| {
        format!("Invalid wallet recovery phrase: {e}")
    })?;

    let seed = mnemonic.to_seed("");

    UnifiedSpendingKey::from_seed(
        &Network::MainNetwork,
        &seed,
        zip32::AccountId::ZERO,
    )
    .map_err(|e| {
        format!(
            "Failed to derive Account 0 spending key: {e:?}"
        )
    })
}

pub fn zatoshis_from_zec(
    amount_zec: f64,
) -> Result<Zatoshis, String> {
    if !amount_zec.is_finite() {
        return Err(
            "Amount must be a finite number.".to_string(),
        );
    }

    if amount_zec <= 0.0 {
        return Err(
            "Amount must be greater than zero.".to_string(),
        );
    }

    const ZATOSHIS_PER_ZEC: f64 = 100_000_000.0;

    let raw = amount_zec * ZATOSHIS_PER_ZEC;

    if raw.fract() != 0.0 {
        return Err(
            "Amount cannot contain more than 8 decimal places."
                .to_string(),
        );
    }

    if raw > u64::MAX as f64 {
        return Err(
            "Amount is too large.".to_string(),
        );
    }

    Zatoshis::from_u64(raw as u64)
        .map_err(|_| {
            "Amount is outside the valid Zcash monetary range."
                .to_string()
        })
}

pub fn transaction_request(
    recipient: ZcashAddress,
    amount: Zatoshis,
) -> Result<TransactionRequest, String> {
    let payment =
        Payment::without_memo(recipient, amount);

    TransactionRequest::new(vec![payment])
        .map_err(|e| {
            format!(
                "Failed to construct payment request: {e}"
            )
        })
}

use rand::rngs::OsRng;

use zcash_client_backend::{
    data_api::{
        wallet::{
            create_proposed_transactions,
            input_selection::{
                GreedyInputSelector,
                SpendPolicy,
            },
            propose_transfer,
            ConfirmationsPolicy,
            SpendingKeys,
        },
        WalletRead,
    },
    fees::{
        DustOutputPolicy,
        StandardFeeRule,
        standard::SingleOutputChangeStrategy,
    },
    wallet::OvkPolicy,
};

use zcash_client_sqlite::{
    util::SystemClock,
    WalletDb,
};

use zcash_protocol::ShieldedPool;

use zcash_proofs::prover::LocalTxProver;

use zcash_primitives::transaction::TxId;

pub fn build_signed_transaction<P: AsRef<std::path::Path>>(
    wallet_path: P,
    recovery_phrase: &str,
    recipient: ZcashAddress,
    amount: Zatoshis,
) -> Result<Vec<TxId>, String> {
    let network = Network::MainNetwork;

    let usk =
        spending_key_from_recovery_phrase(
            recovery_phrase,
        )?;

    let spending_keys =
        SpendingKeys::from_unified_spending_key(
            usk,
        );

    let request =
        transaction_request(
            recipient,
            amount,
        )?;

    let mut db =
        WalletDb::for_path(
            wallet_path,
            network,
            SystemClock,
            OsRng,
        )
        .map_err(|e| {
            format!(
                "Failed to open wallet database for sending: {e:?}"
            )
        })?;

    let account_id = db
        .get_account_ids()
        .map_err(|e| {
            format!(
                "Failed to read wallet accounts: {e:?}"
            )
        })?
        .into_iter()
        .next()
        .ok_or_else(|| {
            "Wallet contains no account."
                .to_string()
        })?;

    let input_selector =
        GreedyInputSelector::new();

    let change_strategy =
        SingleOutputChangeStrategy::new(
            StandardFeeRule::Zip317,
            None,
            ShieldedPool::Orchard,
            DustOutputPolicy::default(),
        );

    let proposal =
        propose_transfer::<_, _, _, _, std::convert::Infallible>(
            &mut db,
            &network,
            account_id,
            &input_selector,
            &change_strategy,
            request,
            ConfirmationsPolicy::MIN,
            &SpendPolicy::default(),
            None,
            None,
        )
        .map_err(|e| {
            format!(
                "Failed to create transaction proposal: {e:?}"
            )
        })?;

    let prover =
        LocalTxProver::with_default_location()
            .ok_or_else(|| {
                concat!(
                    "Sapling proving parameters were not found. ",
                    "Install the standard Zcash Sapling parameters ",
                    "before sending transactions."
                )
                .to_string()
            })?;

    let txids =
        create_proposed_transactions::<
            _,
            _,
            std::convert::Infallible,
            _,
            std::convert::Infallible,
            _,
        >(
            &mut db,
            &network,
            &prover,
            &prover,
            &spending_keys,
            OvkPolicy::Sender,
            &proposal,
            None,
        )
        .map_err(|e| {
            format!(
                "Failed to build/sign transaction: {e:?}"
            )
        })?;

    Ok(
        txids
            .iter()
            .copied()
            .collect(),
    )
}

use zcash_client_backend::proto::service::{
    compact_tx_streamer_client::CompactTxStreamerClient,
    RawTransaction,
};

pub async fn broadcast_signed_transactions<P: AsRef<std::path::Path>>(
    wallet_path: P,
    lightwalletd_endpoint: &str,
    txids: &[TxId],
) -> Result<Vec<String>, String> {
    let network = Network::MainNetwork;

    let db =
        WalletDb::for_path(
            wallet_path,
            network,
            SystemClock,
            OsRng,
        )
        .map_err(|e| {
            format!(
                "Failed to open wallet database for broadcast: {e:?}"
            )
        })?;

    let mut client =
        CompactTxStreamerClient::connect(
            lightwalletd_endpoint.to_string(),
        )
        .await
        .map_err(|e| {
            format!(
                "Failed to connect to lightwalletd for broadcast: {e}"
            )
        })?;

    let mut broadcast_txids =
        Vec::with_capacity(txids.len());

    for txid in txids {
        let transaction = db
            .get_transaction(*txid)
            .map_err(|e| {
                format!(
                    "Failed to retrieve signed transaction {txid}: {e:?}"
                )
            })?
            .ok_or_else(|| {
                format!(
                    "Signed transaction {txid} was not found in the wallet database."
                )
            })?;

        let mut raw_bytes =
            Vec::new();

        transaction
            .write(&mut raw_bytes)
            .map_err(|e| {
                format!(
                    "Failed to serialize transaction {txid}: {e}"
                )
            })?;

        let response = client
            .send_transaction(
                RawTransaction {
                    data: raw_bytes,
                    height: 0,
                },
            )
            .await
            .map_err(|e| {
                format!(
                    "lightwalletd rejected transaction RPC {txid}: {e}"
                )
            })?
            .into_inner();

        if response.error_code != 0 {
            return Err(
                format!(
                    "Zcash network rejected transaction {txid}: code {}: {}",
                    response.error_code,
                    response.error_message,
                )
            );
        }

        broadcast_txids.push(
            txid.to_string(),
        );
    }

    Ok(broadcast_txids)
}

pub async fn send_zec<P: AsRef<std::path::Path>>(
    wallet_path: P,
    lightwalletd_endpoint: &str,
    recovery_phrase: &str,
    recipient_address: &str,
    amount_zec: f64,
) -> Result<Vec<String>, String> {
    let recipient =
        recipient_address
            .trim()
            .parse::<ZcashAddress>()
            .map_err(|e| {
                format!(
                    "Invalid Zcash recipient address: {e}"
                )
            })?;

    let amount =
        zatoshis_from_zec(
            amount_zec,
        )?;

    let txids =
        build_signed_transaction(
            wallet_path.as_ref(),
            recovery_phrase,
            recipient,
            amount,
        )?;

    broadcast_signed_transactions(
        wallet_path,
        lightwalletd_endpoint,
        &txids,
    )
    .await
}
