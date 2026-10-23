//! Presentation model for account-level Zcash transaction history.
//! Values are exact signed zatoshis. Database reads will use the wallet's
//! supported v_transactions and v_tx_outputs views.

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionDirection {
    Sent,
    Received,
    Internal,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransactionStatus {
    Confirmed,
    Pending,
    Expired,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TransactionHistoryEntry {
    pub txid: String,
    pub direction: TransactionDirection,
    pub status: TransactionStatus,
    pub amount_zatoshis: i64,
    pub fee_zatoshis: Option<u64>,
    pub mined_height: Option<u32>,
    pub block_time: Option<i64>,
    pub memos: Vec<String>,
}

pub fn direction_from_balance_delta(delta: i64) -> TransactionDirection {
    match delta.cmp(&0) {
        std::cmp::Ordering::Less => TransactionDirection::Sent,
        std::cmp::Ordering::Greater => TransactionDirection::Received,
        std::cmp::Ordering::Equal => TransactionDirection::Internal,
    }
}

pub fn status_from_chain(mined_height: Option<u32>, expired_unmined: bool) -> TransactionStatus {
    if mined_height.is_some() {
        TransactionStatus::Confirmed
    } else if expired_unmined {
        TransactionStatus::Expired
    } else {
        TransactionStatus::Pending
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_account_balance_delta() {
        assert_eq!(direction_from_balance_delta(-100), TransactionDirection::Sent);
        assert_eq!(direction_from_balance_delta(100), TransactionDirection::Received);
        assert_eq!(direction_from_balance_delta(0), TransactionDirection::Internal);
    }

    #[test]
    fn classifies_mined_pending_and_expired() {
        assert_eq!(status_from_chain(Some(123), false), TransactionStatus::Confirmed);
        assert_eq!(status_from_chain(None, false), TransactionStatus::Pending);
        assert_eq!(status_from_chain(None, true), TransactionStatus::Expired);
        assert_eq!(status_from_chain(Some(123), true), TransactionStatus::Confirmed);
    }
}

pub fn read_transaction_history(path: &std::path::Path) -> Result<Vec<TransactionHistoryEntry>, String> {
    use rusqlite::{Connection, OpenFlags};
    if !path.is_file() {
        return Err("Wallet database is not available.".to_owned());
    }
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ).map_err(|e| format!("Unable to read wallet history: {e}"))?;
    // Refuse a database that does not expose the expected history columns.
    // A partial schema must not silently produce misleading balances or fees.
    let schema_ok = connection.prepare("SELECT txid, account_balance_delta, fee_paid, mined_height, block_time, expired_unmined, pool_crossing_value FROM v_transactions LIMIT 0").is_ok()
        && connection.prepare("SELECT txid, memo FROM v_tx_outputs LIMIT 0").is_ok();
    if !schema_ok {
        return Err("Wallet history schema is incompatible with this app version. Update the wallet or contact support; no wallet data was changed.".to_owned());
    }
    // Reject incompatible databases before querying transaction views.
    let mut statement = connection.prepare(
        "SELECT hex(txid), SUM(account_balance_delta), MAX(fee_paid),          MAX(mined_height), MAX(block_time), MAX(expired_unmined), MAX(pool_crossing_value)          FROM v_transactions GROUP BY txid          ORDER BY MAX(COALESCE(mined_height, 2147483647)) DESC LIMIT 200"
    ).map_err(|e| format!("Unable to query wallet history: {e}"))?;
    let rows = statement.query_map([], |row| {
        let txid: String = row.get(0)?;
        let delta: i64 = row.get(1)?;
        let fee: Option<i64> = row.get(2)?;
        let height: Option<u32> = row.get(3)?;
        let block_time: Option<i64> = row.get(4)?;
        let expired: Option<i64> = row.get(5)?;
        let pool_crossing: Option<i64> = row.get(6)?;
        let amount = if let Some(crossing) = pool_crossing {
            crossing
        } else if delta < 0 {
            delta.saturating_add(fee.unwrap_or(0)).saturating_abs()
        } else {
            delta
        };
        Ok(TransactionHistoryEntry {
            txid: txid.to_lowercase(),
            direction: if pool_crossing.is_some() {
                TransactionDirection::Internal
            } else {
                direction_from_balance_delta(delta)
            },
            status: status_from_chain(height, expired.unwrap_or(0) != 0),
            amount_zatoshis: amount,
            fee_zatoshis: fee.and_then(|f| u64::try_from(f).ok()),
            mined_height: height,
            block_time,
            memos: Vec::new(),
        })
    }).map_err(|e| format!("Unable to load wallet history: {e}"))?;
    let mut entries = rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Unable to decode wallet history: {e}"))?;
    drop(statement);

    // A pool-crossing transaction has a balance delta consisting only of its fee;
    // show the migrated value as an internal transfer, not as a zero-value send.
    // Memos are binary ZIP-302 values. The empty memo (0xf6 followed by
    // zero padding) must not be rendered as a user-written message.
    let mut memo_query = connection.prepare(
        "SELECT memo FROM v_tx_outputs WHERE hex(txid) = ?1 AND memo IS NOT NULL"
    ).map_err(|e| format!("Unable to query transaction memos: {e}"))?;
    for entry in &mut entries {
        let values = memo_query.query_map([entry.txid.to_uppercase()], |row| {
            row.get::<_, Vec<u8>>(0)
        }).map_err(|e| format!("Unable to read transaction memos: {e}"))?;
        for value in values {
            let bytes = value.map_err(|e| format!("Unable to decode transaction memo: {e}"))?;
            if let Some(text) = display_memo(&bytes) {
                if !entry.memos.contains(&text) {
                    entry.memos.push(text);
                }
            }
        }
    }
    Ok(entries)
}

fn display_memo(bytes: &[u8]) -> Option<String> {
    // ZIP-302: 0x00..0xf4 are text memos, 0xf5 is a future-use memo,
    // and 0xf6 is the canonical empty memo. Never interpret future-use
    // or other non-text memo payloads as a user-written message.
    if bytes.is_empty() || bytes[0] > 0xf4 {
        return None;
    }
    let text = std::str::from_utf8(bytes).ok()?.trim_end_matches(char::from(0));
    if text.is_empty() { None } else { Some(text.to_owned()) }
}

#[cfg(test)]
mod memo_display_tests {
    use super::display_memo;

    #[test]
    fn reads_unicode_memos_and_ignores_empty() {
        assert_eq!(display_memo("Payment ✓".as_bytes()), Some("Payment ✓".to_owned()));
        assert_eq!(display_memo(b"Invoice paid  "), Some("Invoice paid  ".to_owned()));
        assert_eq!(display_memo(b"Invoice paid  \0\0"), Some("Invoice paid  ".to_owned()));
        assert_eq!(display_memo(&[0xf6, 0, 0]), None);
        assert_eq!(display_memo(&[0xf5, 0, 0]), None);
        assert_eq!(display_memo(&[0xf7, 0, 0]), None);
        assert_eq!(display_memo(&[0, 0, 0]), None);
        assert_eq!(display_memo(&[0xff, 0]), None);
    }
}

#[cfg(test)]
mod sqlite_history_tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn reads_sent_transaction_and_memo_from_sqlite_views() {
        let path = std::env::temp_dir().join(format!(
            "zoerd-history-sent-{}.sqlite", std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE tx (txid BLOB, account_balance_delta INTEGER,
             fee_paid INTEGER, mined_height INTEGER, block_time INTEGER,
             expired_unmined INTEGER, pool_crossing_value INTEGER);
             CREATE VIEW v_transactions AS SELECT * FROM tx;
             CREATE TABLE outputs (txid BLOB, memo BLOB);
             CREATE VIEW v_tx_outputs AS SELECT * FROM outputs;
             INSERT INTO tx VALUES (X'01020304', -110, 10, 42, 1700000000, 0, NULL);
             INSERT INTO outputs VALUES (X'01020304', X'48656C6C6F');
             INSERT INTO tx VALUES (X'05060708', 250, NULL, NULL, NULL, 0, NULL);
             INSERT INTO outputs VALUES (X'05060708', X'5468616E6B73');"
        ).unwrap();
        drop(db);
        let entries = read_transaction_history(&path).unwrap();
        assert_eq!(entries.len(), 2);
        let sent = entries.iter().find(|entry| entry.txid == "01020304").unwrap();
        assert_eq!(sent.direction, TransactionDirection::Sent);
        assert_eq!(sent.amount_zatoshis, 100);
        assert_eq!(sent.fee_zatoshis, Some(10));
        assert_eq!(sent.memos, vec!["Hello"]);
        assert_eq!(sent.status, TransactionStatus::Confirmed);
        assert_eq!(sent.mined_height, Some(42));
        assert_eq!(sent.block_time, Some(1_700_000_000));
        let received = entries.iter().find(|entry| entry.txid == "05060708").unwrap();
        assert_eq!(received.direction, TransactionDirection::Received);
        assert_eq!(received.amount_zatoshis, 250);
        assert_eq!(received.status, TransactionStatus::Pending);
        assert_eq!(received.memos, vec!["Thanks"]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn incompatible_history_schema_preserves_wallet_bytes() {
        let path = std::env::temp_dir().join(format!(
            "zoerd-history-incompatible-{}.sqlite", std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE tx (txid BLOB, account_balance_delta INTEGER);
             CREATE VIEW v_transactions AS SELECT * FROM tx;
             CREATE TABLE outputs (txid BLOB, memo BLOB);
             CREATE VIEW v_tx_outputs AS SELECT * FROM outputs;
             INSERT INTO tx VALUES (X'01020304', -100);"
        ).unwrap();
        drop(db);
        let before = std::fs::read(&path).unwrap();
        let error = read_transaction_history(&path).unwrap_err();
        assert!(error.contains("Wallet history schema is incompatible"));
        assert_eq!(std::fs::read(&path).unwrap(), before);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_schema_returns_readable_error() {
        let path = std::env::temp_dir().join(format!(
            "zoerd-history-schema-{}.sqlite", std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        Connection::open(&path).unwrap();
        let result = read_transaction_history(&path);
        assert!(result.unwrap_err().contains("Wallet history schema is incompatible"));
        let _ = std::fs::remove_file(&path);
    }
}
