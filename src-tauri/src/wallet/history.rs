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
    let text = std::str::from_utf8(bytes).ok()?.trim_end_matches(char::from(0)).trim_end();
    if text.is_empty() { None } else { Some(text.to_owned()) }
}

#[cfg(test)]
mod memo_display_tests {
    use super::display_memo;

    #[test]
    fn reads_unicode_memos_and_ignores_empty() {
        assert_eq!(display_memo("Payment ✓".as_bytes()), Some("Payment ✓".to_owned()));
        assert_eq!(display_memo(&[0xf6, 0, 0]), None);
        assert_eq!(display_memo(&[0xf5, 0, 0]), None);
        assert_eq!(display_memo(&[0xf7, 0, 0]), None);
        assert_eq!(display_memo(&[0, 0, 0]), None);
        assert_eq!(display_memo(&[0xff, 0]), None);
    }
}
