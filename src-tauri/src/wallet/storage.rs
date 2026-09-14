use std::path::Path;

use bip39::{Language, Mnemonic};
use rand::rngs::OsRng;
use secrecy::SecretVec;
use zcash_client_backend::data_api::{
    Account,
    AccountBirthday,
    WalletRead,
    WalletWrite,
};
use zcash_client_sqlite::{
    util::SystemClock,
    wallet::init::init_wallet_db,
    WalletDb,
};
use zcash_keys::keys::UnifiedAddressRequest;
use zcash_protocol::consensus::{
    BlockHeight,
    Network,
};

use super::network::get_birthday_tree_state;

#[derive(Debug, serde::Serialize)]
pub struct CreatedWallet {
    pub recovery_phrase: String,
    pub address: String,
    pub birthday_height: u32,
    pub chain_tip: u64,
    pub secure_storage_saved: bool,
}

pub async fn create_new_wallet<P: AsRef<Path>>(
    path: P,
    lightwalletd_endpoint: &str,
) -> Result<CreatedWallet, String> {
    let network = Network::MainNetwork;

    //
    // 1. Generate a fresh BIP-39 recovery phrase.
    //
    let mnemonic = Mnemonic::generate_in(
        Language::English,
        24,
    )
    .map_err(|e| {
        format!("Failed to generate recovery phrase: {e}")
    })?;

    //
    // 2. Convert mnemonic into the 64-byte BIP-39 seed.
    //
    let bip39_seed = mnemonic.to_seed("");

    let seed = SecretVec::new(
        bip39_seed.to_vec(),
    );

    //
    // 3. Obtain a recent TreeState from lightwalletd.
    //
    let (chain_tip, tree_state) =
        get_birthday_tree_state(lightwalletd_endpoint)
            .await?;

    //
    // 4. Construct the Zcash account birthday.
    //
    let birthday = AccountBirthday::from_treestate(
        tree_state,
        None,
    )
    .map_err(|e| {
        format!("Failed to construct account birthday: {e}")
    })?;

    //
    // 5. Open/create the Zcash wallet SQLite database.
    //
    let mut db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| {
        format!("Failed to open wallet database: {e:?}")
    })?;

    //
    // 6. Initialize official Zcash database schema.
    //
    init_wallet_db(&mut db, None)
        .map_err(|e| {
            format!("Failed to initialize wallet database: {e:?}")
        })?;

    //
    // 7. Create ZIP-32 Account 0.
    //
    let (account_id, _spending_key) = db
        .create_account(
            "ZOERDHUB",
            &seed,
            &birthday,
            Some("ZOERDHUB Wallet"),
        )
        .map_err(|e| {
            format!("Failed to create Zcash account: {e:?}")
        })?;

    //
    // 8. Tell the DB what the current chain tip is.
    //
    let chain_tip_height =
        BlockHeight::from_u32(
            u32::try_from(chain_tip)
                .map_err(|_| {
                    "Chain height exceeds u32 range".to_string()
                })?,
        );

    db.update_chain_tip(chain_tip_height)
        .map_err(|e| {
            format!("Failed to update chain tip: {e:?}")
        })?;

    //
    // 9. Allocate the first real persistent Unified Address.
    //
    let (address, _diversifier_index) = db
        .get_next_available_address(
            account_id,
            UnifiedAddressRequest::AllAvailableKeys,
        )
        .map_err(|e| {
            format!("Failed to generate Unified Address: {e:?}")
        })?
        .ok_or_else(|| {
            "No Unified Address could be generated".to_string()
        })?;

    let encoded_address =
        address.encode(&network);

    Ok(CreatedWallet {
        recovery_phrase: mnemonic.to_string(),
        address: encoded_address,
        birthday_height: u32::from(birthday.height()),
        chain_tip,
        secure_storage_saved: false,
    })
}

pub fn reopen_wallet_first_address<P: AsRef<Path>>(
    path: P,
) -> Result<String, String> {
    let network = Network::MainNetwork;
    let path = path.as_ref();

    if !path.exists() {
        return Err(
            "No wallet exists on this device.".to_string()
        );
    }

    let db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| {
        format!("Failed to reopen wallet database: {e:?}")
    })?;

    let account_ids = db
        .get_account_ids()
        .map_err(|e| {
            format!("Failed to read wallet accounts: {e:?}")
        })?;

    let account_id = account_ids
        .into_iter()
        .next()
        .ok_or_else(|| {
            "Wallet contains no accounts".to_string()
        })?;

    let address = db
        .get_last_generated_address_matching(
            account_id,
            UnifiedAddressRequest::AllAvailableKeys,
        )
        .map_err(|e| {
            format!("Failed to read wallet address: {e:?}")
        })?
        .ok_or_else(|| {
            "Wallet contains no generated address".to_string()
        })?;

    Ok(address.encode(&network))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn create_and_reopen_persistent_wallet() {
        let endpoint = std::env::var("LIGHTWALLETD_URL")
            .unwrap_or_else(|_| {
                "http://127.0.0.1:9067".to_string()
            });

        let db_path =
            std::env::temp_dir().join("zoerd-wallet-persistence-test.sqlite");

        if db_path.exists() {
            std::fs::remove_file(&db_path)
                .expect("Could not remove previous test wallet");
        }

        println!("Creating persistent ZOERDHUB wallet...");

        let created = create_new_wallet(
            &db_path,
            &endpoint,
        )
        .await
        .expect("Failed to create persistent wallet");

        assert!(
            created.address.starts_with("u1"),
            "Expected a mainnet Unified Address"
        );

        println!("Account 0 created");
        println!("Unified Address: {}", created.address);
        println!("Birthday height: {}", created.birthday_height);
        println!("Chain tip: {}", created.chain_tip);
        println!("Recovery phrase generated: YES");
        println!("Recovery phrase printed: NO");

        let original_address = created.address.clone();

        drop(created);

        println!("Reopening wallet database...");

        let reopened_address =
            reopen_wallet_first_address(&db_path)
                .expect("Failed to reopen wallet");

        println!("Reopened Unified Address: {}", reopened_address);

        assert_eq!(
            original_address,
            reopened_address,
            "Address changed after reopening wallet database"
        );

        println!("Persistence verified: SAME ADDRESS");
        println!("Wallet DB: {}", db_path.display());
    }
}

pub async fn restore_wallet_from_phrase<P: AsRef<Path>>(
    path: P,
    lightwalletd_endpoint: &str,
    recovery_phrase: &str,
) -> Result<String, String> {
    let network = Network::MainNetwork;

    let mnemonic = Mnemonic::parse_in(
        Language::English,
        recovery_phrase,
    )
    .map_err(|e| {
        format!("Invalid recovery phrase: {e}")
    })?;

    let bip39_seed = mnemonic.to_seed("");

    let seed = SecretVec::new(
        bip39_seed.to_vec(),
    );

    let (chain_tip, tree_state) =
        get_birthday_tree_state(lightwalletd_endpoint)
            .await?;

    let birthday = AccountBirthday::from_treestate(
        tree_state,
        None,
    )
    .map_err(|e| {
        format!("Failed to construct restore birthday: {e}")
    })?;

    let mut db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| {
        format!("Failed to create restored wallet DB: {e:?}")
    })?;

    init_wallet_db(&mut db, None)
        .map_err(|e| {
            format!("Failed to initialize restored wallet DB: {e:?}")
        })?;

    let (account, _spending_key) = db
        .import_account_hd(
            "ZOERDHUB",
            &seed,
            zip32::AccountId::ZERO,
            &birthday,
            Some("ZOERDHUB Recovery"),
        )
        .map_err(|e| {
            format!("Failed to restore Account 0: {e:?}")
        })?;

    let chain_tip_height = BlockHeight::from_u32(
        u32::try_from(chain_tip)
            .map_err(|_| {
                "Chain height exceeds u32 range".to_string()
            })?,
    );

    db.update_chain_tip(chain_tip_height)
        .map_err(|e| {
            format!("Failed to update restored wallet chain tip: {e:?}")
        })?;

    let (address, _diversifier_index) = db
        .get_next_available_address(
            account.id(),
            UnifiedAddressRequest::AllAvailableKeys,
        )
        .map_err(|e| {
            format!("Failed to generate restored address: {e:?}")
        })?
        .ok_or_else(|| {
            "No Unified Address could be generated after restore".to_string()
        })?;

    Ok(address.encode(&network))
}

#[cfg(test)]
mod recovery_tests {
    use super::*;

    #[tokio::test]
    #[ignore]
    async fn mnemonic_restores_same_account_zero_address() {
        let endpoint = std::env::var("LIGHTWALLETD_URL")
            .unwrap_or_else(|_| {
                "http://127.0.0.1:9067".to_string()
            });

        let temp = std::env::temp_dir();

        let original_path =
            temp.join("zoerd-original-recovery-test.sqlite");

        let restored_path =
            temp.join("zoerd-restored-recovery-test.sqlite");

        for path in [&original_path, &restored_path] {
            if path.exists() {
                std::fs::remove_file(path)
                    .expect("Could not remove previous test DB");
            }
        }

        println!("Creating original wallet...");

        let original = create_new_wallet(
            &original_path,
            &endpoint,
        )
        .await
        .expect("Could not create original wallet");

        let original_address = original.address.clone();

        println!("Original Account 0 created");
        println!("Original address: {}", original_address);
        println!("Recovery phrase retained in test memory only");

        let recovery_phrase = original.recovery_phrase.clone();

        drop(original);

        println!("Restoring Account 0 into fresh database...");

        let restored_address =
            restore_wallet_from_phrase(
                &restored_path,
                &endpoint,
                &recovery_phrase,
            )
            .await
            .expect("Could not restore wallet");

        println!("Restored address: {}", restored_address);

        //
        // The restored wallet may allocate a different diversified UA.
        // What matters is that the same mnemonic controls restored Account 0.
        //
        let mnemonic = Mnemonic::parse_in(
            Language::English,
            &recovery_phrase,
        )
        .expect("Recovery phrase became invalid");

        let bip39_seed = mnemonic.to_seed("");

        let seed = SecretVec::new(
            bip39_seed.to_vec(),
        );

        let network = Network::MainNetwork;

        let restored_db = WalletDb::for_path(
            &restored_path,
            network,
            SystemClock,
            OsRng,
        )
        .expect("Could not reopen restored wallet DB");

        let account_id = restored_db
            .get_account_ids()
            .expect("Could not read restored accounts")
            .into_iter()
            .next()
            .expect("Restored wallet contains no Account 0");

        let seed_valid = restored_db
            .validate_seed(
                account_id,
                &seed,
            )
            .expect("Seed validation failed");

        assert!(
            seed_valid,
            "Recovery mnemonic does not control restored Account 0"
        );

        assert!(
            original_address.starts_with("u1"),
            "Original address is not a mainnet Unified Address"
        );

        assert!(
            restored_address.starts_with("u1"),
            "Restored address is not a mainnet Unified Address"
        );

        println!("RECOVERY VERIFIED: SEED CONTROLS ACCOUNT 0");
        println!("Original UA: {}", original_address);
        println!("Restored allocated UA: {}", restored_address);
        println!("Recovery phrase printed: NO");
    }
}

// -----------------------------------------------------------------------------
// Wallet synchronization
// -----------------------------------------------------------------------------

pub async fn sync_existing_wallet<P: AsRef<Path>>(
    path: P,
    lightwalletd_endpoint: &str,
) -> Result<(), String> {
    use zcash_client_backend::{
        proto::service::compact_tx_streamer_client::
            CompactTxStreamerClient,
        sync,
    };

    use super::cache::MemoryBlockCache;

    let network = Network::MainNetwork;

    let mut db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| {
        format!(
            "Failed to open wallet database for synchronization: {e:?}"
        )
    })?;

    let mut client =
        CompactTxStreamerClient::connect(
            lightwalletd_endpoint.to_string(),
        )
        .await
        .map_err(|e| {
            format!(
                "Failed to connect to lightwalletd for synchronization: {e}"
            )
        })?;

    let cache = MemoryBlockCache::new();

    //
    // Keep batches small for the first production integration.
    // sync::run deletes each scanned range from this RAM cache.
    //
    const SYNC_BATCH_SIZE: u32 = 100;

    sync::run(
        &mut client,
        &network,
        &cache,
        &mut db,
        SYNC_BATCH_SIZE,
    )
    .await
    .map_err(|e| {
        format!("Wallet synchronization failed: {e:?}")
    })?;

    Ok(())
}

#[cfg(test)]
mod sync_tests {
    use super::*;

    use zcash_client_backend::data_api::wallet::
        ConfirmationsPolicy;

    #[tokio::test]
    #[ignore]
    async fn sync_fresh_wallet_with_lightwalletd() {
        let endpoint = std::env::var(
            "LIGHTWALLETD_URL",
        )
        .unwrap_or_else(|_| {
            "http://127.0.0.1:9067".to_string()
        });

        let wallet_path = std::env::temp_dir()
            .join("zoerd-real-sync-test.sqlite");

        if wallet_path.exists() {
            std::fs::remove_file(&wallet_path)
                .expect(
                    "Could not remove previous sync test DB"
                );
        }

        println!("Creating fresh wallet for sync test...");

        let created = create_new_wallet(
            &wallet_path,
            &endpoint,
        )
        .await
        .expect("Could not create wallet");

        println!(
            "Wallet birthday: {}",
            created.birthday_height
        );

        println!(
            "Chain tip during creation: {}",
            created.chain_tip
        );

        println!(
            "Recovery phrase generated: YES"
        );

        println!(
            "Recovery phrase printed: NO"
        );

        drop(created);

        println!(
            "Starting real lightwalletd synchronization..."
        );

        sync_existing_wallet(
            &wallet_path,
            &endpoint,
        )
        .await
        .expect(
            "Real lightwalletd wallet synchronization failed"
        );

        println!("Synchronization completed.");

        let db = WalletDb::for_path(
            &wallet_path,
            Network::MainNetwork,
            SystemClock,
            OsRng,
        )
        .expect(
            "Could not reopen synchronized wallet"
        );

        let chain_height = db
            .chain_height()
            .expect(
                "Could not read synchronized chain height"
            )
            .expect(
                "Wallet does not know the chain height"
            );

        println!(
            "Wallet chain height after sync: {}",
            u32::from(chain_height)
        );

        let summary = db
            .get_wallet_summary(
                ConfirmationsPolicy::MIN,
            )
            .expect(
                "Could not read wallet summary"
            )
            .expect(
                "Wallet summary is unavailable after sync"
            );

        println!(
            "Wallet summary after sync: {summary:?}"
        );

        println!(
            "REAL LIGHTWALLETD SYNC VERIFIED"
        );
    }
}

#[derive(Debug, serde::Serialize)]
pub struct WalletStatus {
    pub chain_height: Option<u32>,
    pub fully_scanned_height: Option<u32>,
    pub total_zatoshis: u64,
    pub spendable_zatoshis: u64,
    pub pending_zatoshis: u64,
    pub address_count: usize,
}

pub fn get_wallet_status<P: AsRef<Path>>(
    path: P,
) -> Result<WalletStatus, String> {
    use zcash_client_backend::data_api::wallet::ConfirmationsPolicy;

    let network = Network::MainNetwork;

    let db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| format!("Failed to open wallet DB: {e:?}"))?;

    let chain_height = db
        .chain_height()
        .map_err(|e| format!("Failed to read chain height: {e:?}"))?
        .map(u32::from);

    let account_ids = db
        .get_account_ids()
        .map_err(|e| format!("Failed to read accounts: {e:?}"))?;

    let mut address_count = 0usize;

    for account_id in account_ids.iter().copied() {
        address_count += db
            .list_addresses(account_id)
            .map_err(|e| format!("Failed to list addresses: {e:?}"))?
            .len();
    }

    let summary = db
        .get_wallet_summary(ConfirmationsPolicy::MIN)
        .map_err(|e| format!("Failed to read wallet summary: {e:?}"))?;

    let Some(summary) = summary else {
        return Ok(WalletStatus {
            chain_height,
            fully_scanned_height: None,
            total_zatoshis: 0,
            spendable_zatoshis: 0,
            pending_zatoshis: 0,
            address_count,
        });
    };

    let mut total = 0u64;
    let mut spendable = 0u64;
    let mut pending = 0u64;

    for account_balance in summary.account_balances().values() {
        let pools = [
            account_balance.sapling_balance(),
            account_balance.orchard_balance(),
            account_balance.ironwood_balance(),
            account_balance.unshielded_regular_balance(),
            account_balance.unshielded_coinbase_balance(),
        ];

        for balance in pools {
            total = total.saturating_add(
                balance.total().into_u64()
            );

            spendable = spendable.saturating_add(
                balance.spendable_value().into_u64()
            );

            pending = pending
                .saturating_add(
                    balance.change_pending_confirmation().into_u64()
                )
                .saturating_add(
                    balance.value_pending_spendability().into_u64()
                );
        }
    }

    Ok(WalletStatus {
        chain_height: Some(
            u32::from(summary.chain_tip_height())
        ),
        fully_scanned_height: Some(
            u32::from(summary.fully_scanned_height())
        ),
        total_zatoshis: total,
        spendable_zatoshis: spendable,
        pending_zatoshis: pending,
        address_count,
    })
}

pub fn get_wallet_addresses<P: AsRef<Path>>(
    path: P,
) -> Result<Vec<String>, String> {
    let network = Network::MainNetwork;

    let db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| format!("Failed to open wallet DB: {e:?}"))?;

    let account_id = db
        .get_account_ids()
        .map_err(|e| format!("Failed to read accounts: {e:?}"))?
        .into_iter()
        .next()
        .ok_or_else(|| "Wallet contains no accounts.".to_string())?;

    db.list_addresses(account_id)
        .map_err(|e| format!("Failed to list addresses: {e:?}"))?
        .into_iter()
        .map(|info| {
            Ok(info.address().encode(&network))
        })
        .collect()
}

pub fn create_next_address<P: AsRef<Path>>(
    path: P,
) -> Result<String, String> {
    let network = Network::MainNetwork;

    let mut db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| format!("Failed to open wallet DB: {e:?}"))?;

    let account_id = db
        .get_account_ids()
        .map_err(|e| format!("Failed to read accounts: {e:?}"))?
        .into_iter()
        .next()
        .ok_or_else(|| "Wallet contains no accounts.".to_string())?;

    let chain_height = db
        .chain_height()
        .map_err(|e| format!("Failed to read wallet chain height: {e:?}"))?
        .ok_or_else(|| {
            "Wallet does not know the chain height yet.".to_string()
        })?;

    db.update_chain_tip(chain_height)
        .map_err(|e| format!("Failed to update chain tip: {e:?}"))?;

    let (address, _) = db
        .get_next_available_address(
            account_id,
            UnifiedAddressRequest::AllAvailableKeys,
        )
        .map_err(|e| format!("Failed to create address: {e:?}"))?
        .ok_or_else(|| {
            "Could not generate another Unified Address.".to_string()
        })?;

    Ok(address.encode(&network))
}

pub async fn restore_wallet_from_phrase_at_birthday<P: AsRef<Path>>(
    path: P,
    lightwalletd_endpoint: &str,
    recovery_phrase: &str,
    birthday_height: u32,
) -> Result<String, String> {
    use super::network::{
        get_latest_block_height,
        get_tree_state_at_height,
    };

    let network = Network::MainNetwork;

    if birthday_height == 0 {
        return Err(
            "Birthday height must be greater than zero.".to_string()
        );
    }

    let mnemonic =
        Mnemonic::parse_in(Language::English, recovery_phrase)
            .map_err(|e| {
                format!("Invalid recovery phrase: {e}")
            })?;

    let bip39_seed = mnemonic.to_seed("");
    let seed = SecretVec::new(bip39_seed.to_vec());

    // AccountBirthday::from_treestate treats the supplied
    // TreeState as the block immediately BEFORE the first
    // height that should be scanned.
    let tree_state_height = birthday_height
        .checked_sub(1)
        .ok_or_else(|| {
            "Invalid birthday height.".to_string()
        })?;

    let tree_state = get_tree_state_at_height(
        lightwalletd_endpoint,
        u64::from(tree_state_height),
    )
    .await?;

    let birthday =
        AccountBirthday::from_treestate(
            tree_state,
            None,
        )
        .map_err(|e| {
            format!(
                "Failed to construct historical birthday: {e}"
            )
        })?;

    let mut db = WalletDb::for_path(
        path,
        network,
        SystemClock,
        OsRng,
    )
    .map_err(|e| {
        format!(
            "Failed to create restored wallet DB: {e:?}"
        )
    })?;

    init_wallet_db(&mut db, None)
        .map_err(|e| {
            format!(
                "Failed to initialize restored wallet DB: {e:?}"
            )
        })?;

    let (account, _spending_key) = db
        .import_account_hd(
            "ZOERDHUB",
            &seed,
            zip32::AccountId::ZERO,
            &birthday,
            Some("ZOERDHUB Historical Recovery"),
        )
        .map_err(|e| {
            format!(
                "Failed to restore Account 0: {e:?}"
            )
        })?;

    let chain_tip =
        get_latest_block_height(
            lightwalletd_endpoint,
        )
        .await?;

    let chain_tip_u32 =
        u32::try_from(chain_tip)
            .map_err(|_| {
                "Chain height exceeds u32 range."
                    .to_string()
            })?;

    db.update_chain_tip(
        BlockHeight::from_u32(chain_tip_u32),
    )
    .map_err(|e| {
        format!(
            "Failed to update restored wallet chain tip: {e:?}"
        )
    })?;

    let (address, _) = db
        .get_next_available_address(
            account.id(),
            UnifiedAddressRequest::AllAvailableKeys,
        )
        .map_err(|e| {
            format!(
                "Failed to generate restored address: {e:?}"
            )
        })?
        .ok_or_else(|| {
            "No Unified Address could be generated after restore."
                .to_string()
        })?;

    Ok(address.encode(&network))
}
