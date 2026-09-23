//! Read-only snapshot of SDK-owned tables, pinned to zcash_client_sqlite 0.22.0.
use std::path::Path;
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};

pub fn read(path: &Path, merchant_id: &str) -> Result<Value, String> {
    let status = crate::storage::get_wallet_status(path)?;
    let tip = status.chain_height.ok_or("Wallet has no chain height")?;
    if status.fully_scanned_height != Some(tip) { return Err("Wallet scan is incomplete".into()); }
    let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    let outputs = read_outputs(&db, tip)?;
    Ok(json!({"merchant_id": merchant_id, "network": "main", "complete": true,
        "chain_height": tip, "fully_scanned_height": tip,
        "total_zatoshis": status.total_zatoshis.to_string(),
        "spendable_zatoshis": status.spendable_zatoshis.to_string(),
        "pending_zatoshis": status.pending_zatoshis.to_string(), "outputs": outputs}))
}

fn read_outputs(db: &Connection, tip: u32) -> Result<Vec<Value>, String> {
    let mut query = db.prepare("SELECT t.txid, r.pool, r.output_index, r.value, a.address, t.mined_height, b.time
        FROM v_received_outputs r JOIN transactions t ON t.id_tx = r.transaction_id
        JOIN blocks b ON b.height = t.mined_height
        LEFT JOIN addresses a ON a.id = r.address_id
        WHERE r.is_change = 0 AND r.sent_note_id IS NULL AND t.mined_height <= ?1
        ORDER BY t.mined_height, t.txid, r.pool, r.output_index").map_err(|e| e.to_string())?;
    let rows = query.query_map([tip], |r| {
        let mut txid: Vec<u8> = r.get(0)?;
        txid.reverse(); // SDK stores consensus-order bytes; explorers use reversed hex.
        Ok(json!({"txid": hex::encode(txid), "pool": r.get::<_, u32>(1)?,
            "output_index": r.get::<_, u32>(2)?, "amount_zatoshis": r.get::<_, u64>(3)?.to_string(),
            "address": r.get::<_, Option<String>>(4)?, "mined_height": r.get::<_, u32>(5)?,
            "block_time": r.get::<_, u64>(6)?}))
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())

}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_query_matches_real_sdk_schema() {
        use zcash_client_sqlite::{WalletDb, util::SystemClock, wallet::init::init_wallet_db};
        use zcash_protocol::consensus::Network;
        use rand::rngs::OsRng;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("wallet.sqlite");
        let mut wallet = WalletDb::for_path(&path, Network::MainNetwork, SystemClock, OsRng).unwrap();
        init_wallet_db(&mut wallet, None).unwrap();
        let db = Connection::open(&path).unwrap();
        assert!(read_outputs(&db, 100).unwrap().is_empty());
    }
    #[test]
    fn snapshot_filters_change_unmined_and_internal_outputs() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE transactions(id_tx INTEGER, txid BLOB, mined_height INTEGER);
            CREATE TABLE blocks(height INTEGER, time INTEGER);
            CREATE TABLE addresses(id INTEGER, address TEXT);
            CREATE TABLE v_received_outputs(transaction_id INTEGER, pool INTEGER, output_index INTEGER, value INTEGER, address_id INTEGER, is_change INTEGER, sent_note_id INTEGER);
            INSERT INTO transactions VALUES(1, X'0102', 99), (2, X'0304', NULL);
            INSERT INTO blocks VALUES(99, 1700000000);
            INSERT INTO addresses VALUES(1, 'test-address');
            INSERT INTO v_received_outputs VALUES(1,3,0,100,1,0,NULL), (1,3,1,200,1,1,NULL), (1,3,2,300,1,0,1), (2,3,0,400,1,0,NULL);").unwrap();
        let rows = read_outputs(&db, 100).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["txid"], "0201");
        assert_eq!(rows[0]["amount_zatoshis"], "100");
        assert!(read_outputs(&db, 98).unwrap().is_empty());
    }
}
