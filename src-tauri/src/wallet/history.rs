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
