use fs2::FileExt;
use rand::RngCore;
use std::{env, fs, path::PathBuf, sync::Arc};
use tokio::sync::Mutex;
use zeroize::Zeroizing;
use zpay_wallet_service::{network, service::{App, router}, vault};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let endpoint = env::var("LIGHTWALLETD_URL").unwrap_or_else(|_| "http://127.0.0.1:9067".into());
    // Read-only gRPC connectivity check; no wallet or secret creation.
    if args.get(1).map(String::as_str) == Some("probe") {
        let (tip, tree) = tokio::time::timeout(
            std::time::Duration::from_secs(10), network::get_birthday_tree_state(&endpoint)
        ).await?.map_err(std::io::Error::other)?;
        println!("{}", serde_json::json!({"chain_tip":tip,"tree_height":tree.height,"network":tree.network}));
        return Ok(());
    }
    let directory = PathBuf::from(env::var("ZPAY_WALLET_DATA")
        .map_err(|_| "Set ZPAY_WALLET_DATA to an Ubuntu filesystem directory outside the repository")?);
    let command = args.get(1).map(String::as_str).unwrap_or("serve");
    if command == "init" {
        if directory.exists() { return Err("Data directory already exists; refusing to overwrite secrets".into()); }
        vault::private_directory(&directory)?;
        let mut key = Zeroizing::new([0u8; 32]);
        let mut token = Zeroizing::new([0u8; 32]);
        rand::rngs::OsRng.fill_bytes(&mut *key);
        rand::rngs::OsRng.fill_bytes(&mut *token);
        vault::persist_new(&directory.join("vault.key"), &*key)?;
        vault::persist_new(&directory.join("service.token"), hex::encode(&*token).as_bytes())?;
        println!("Created private wallet service files. Back up vault.key separately; never paste it into chat.");
        return Ok(());
    }
    if command != "serve" { return Err("Usage: zpay-wallet-service [probe|init|serve]".into()); }
    let key_bytes = Zeroizing::new(fs::read(directory.join("vault.key"))?);
    let key: [u8; 32] = key_bytes.as_slice().try_into().map_err(|_| "Invalid vault.key length")?;
    let token = Zeroizing::new(fs::read_to_string(directory.join("service.token"))?.trim().to_owned());
    if token.len() != 64 { return Err("Invalid service.token length".into()); }
    let lock_file = fs::OpenOptions::new().create(true).truncate(false).read(true).write(true)
        .open(directory.join("service.lock"))?;
    lock_file.try_lock_exclusive().map_err(|_| "Another wallet service already uses this data directory")?;
    let app = App { directory, endpoint, key: Arc::new(Zeroizing::new(key)),
        token: Arc::new(token), lock: Arc::new(Mutex::new(())) };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:9070").await?;
    println!("ZPay wallet service listening on 127.0.0.1:9070; settlement is not enabled.");
    axum::serve(listener, router(app)).await?;
    drop(lock_file);
    Ok(())
}

