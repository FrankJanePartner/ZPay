mod wallet;

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};
use tauri_plugin_secure_storage::{
    OptionsRequest,
    SecureStorageExt,
};

use wallet::storage::{
    create_new_wallet,
    reopen_wallet_first_address,
    restore_wallet_from_phrase,
    restore_wallet_from_phrase_at_birthday,
    sync_existing_wallet,
    get_wallet_status,
    get_wallet_addresses,
    create_next_address,
    CreatedWallet,
    WalletStatus,
};

const RECOVERY_PHRASE_KEY: &str =
    "zoerdhub_wallet_recovery_phrase_v1";

fn secure_storage_request(
    data: Option<String>,
) -> OptionsRequest {
    OptionsRequest {
        prefixed_key: Some(
            RECOVERY_PHRASE_KEY.to_string()
        ),
        data,
        sync: None,
        keychain_access: None,
    }
}

fn store_recovery_phrase(
    app: &AppHandle,
    phrase: &str,
) -> Result<(), String> {
    app.secure_storage()
        .set_item(
            app.clone(),
            secure_storage_request(
                Some(phrase.to_string())
            ),
        )
        .map(|_| ())
        .map_err(|e| {
            format!(
                "Failed to save wallet recovery secret: {e}"
            )
        })
}

fn load_recovery_phrase(
    app: &AppHandle,
) -> Result<String, String> {
    let response = app
        .secure_storage()
        .get_item(
            app.clone(),
            secure_storage_request(None),
        )
        .map_err(|e| {
            format!(
                "Failed to access wallet recovery secret: {e}"
            )
        })?;

    response.data.ok_or_else(|| {
        "No wallet recovery secret is stored on this device."
            .to_string()
    })
}

fn remove_recovery_phrase(
    app: &AppHandle,
) -> Result<(), String> {
    app.secure_storage()
        .remove_item(
            app.clone(),
            secure_storage_request(None),
        )
        .map(|_| ())
        .map_err(|e| {
            format!(
                "Failed to remove wallet recovery secret: {e}"
            )
        })
}

#[tauri::command]
fn secure_secret_available(
    app: AppHandle,
) -> bool {
    load_recovery_phrase(&app).is_ok()
}

struct AppState {
    wallet_db_path: PathBuf,
    lightwalletd_endpoint: String,
}

#[tauri::command]
async fn check_lightwalletd(
    state: State<'_, AppState>,
) -> Result<u64, String> {
    wallet::network::get_latest_block_height(
        &state.lightwalletd_endpoint,
    )
    .await
}

#[tauri::command]
async fn create_wallet(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CreatedWallet, String> {
    let path = state.wallet_db_path.clone();
    let endpoint = state.lightwalletd_endpoint.clone();

    if path.exists() {
        return Err(
            "A wallet already exists on this device.".to_string()
        );
    }

    let mut created = create_new_wallet(
        path,
        &endpoint,
    )
    .await?;

    match store_recovery_phrase(
        &app,
        &created.recovery_phrase,
    ) {
        Ok(()) => {
            created.secure_storage_saved = true;
        }
        Err(error) => {
            eprintln!(
                "Secure credential storage unavailable: {error}"
            );

            created.secure_storage_saved = false;
        }
    }

    Ok(created)
}

#[tauri::command]
fn open_wallet(
    state: State<'_, AppState>,
) -> Result<String, String> {
    reopen_wallet_first_address(
        &state.wallet_db_path,
    )
}

#[tauri::command]
async fn restore_wallet(
    app: AppHandle,
    state: State<'_, AppState>,
    recovery_phrase: String,
) -> Result<String, String> {
    let path = state.wallet_db_path.clone();
    let endpoint = state.lightwalletd_endpoint.clone();

    if path.exists() {
        return Err(
            "A wallet already exists on this device.".to_string()
        );
    }

    let phrase = recovery_phrase.trim();

    store_recovery_phrase(
        &app,
        phrase,
    )?;

    match restore_wallet_from_phrase(
        path,
        &endpoint,
        phrase,
    )
    .await
    {
        Ok(address) => Ok(address),
        Err(error) => {
            let _ = remove_recovery_phrase(&app);
            Err(error)
        }
    }
}


#[tauri::command]
async fn restore_wallet_at_birthday(
    app: AppHandle,
    state: State<'_, AppState>,
    recovery_phrase: String,
    birthday_height: u32,
) -> Result<String, String> {
    let path = state.wallet_db_path.clone();
    let endpoint = state.lightwalletd_endpoint.clone();

    if path.exists() {
        return Err(
            "A wallet already exists on this device.".to_string()
        );
    }

    let phrase = recovery_phrase.trim();

    store_recovery_phrase(
        &app,
        phrase,
    )?;

    match restore_wallet_from_phrase_at_birthday(
        path,
        &endpoint,
        phrase,
        birthday_height,
    )
    .await
    {
        Ok(address) => Ok(address),
        Err(error) => {
            let _ = remove_recovery_phrase(&app);
            Err(error)
        }
    }
}

#[tauri::command]
async fn sync_wallet(
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = state.wallet_db_path.clone();
    let endpoint = state.lightwalletd_endpoint.clone();

    if !path.exists() {
        return Err(
            "No wallet exists yet.".to_string()
        );
    }

    sync_existing_wallet(
        path,
        &endpoint,
    )
    .await
}


#[tauri::command]
fn wallet_status(
    state: State<'_, AppState>,
) -> Result<WalletStatus, String> {
    get_wallet_status(&state.wallet_db_path)
}

#[tauri::command]
fn get_addresses(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    get_wallet_addresses(&state.wallet_db_path)
}

#[tauri::command]
fn create_address(
    state: State<'_, AppState>,
) -> Result<String, String> {
    create_next_address(&state.wallet_db_path)
}

#[tauri::command]
async fn send_zec(
    app: AppHandle,
    state: State<'_, AppState>,
    recipient_address: String,
    amount_zec: f64,
) -> Result<Vec<String>, String> {
    let path = state.wallet_db_path.clone();
    let endpoint = state.lightwalletd_endpoint.clone();

    if !path.exists() {
        return Err(
            "No wallet exists yet.".to_string()
        );
    }

    let recovery_phrase =
        load_recovery_phrase(&app)?;

    wallet::send::send_zec(
        path,
        &endpoint,
        &recovery_phrase,
        &recipient_address,
        amount_zec,
    )
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_opener::init()
        )
        .plugin(
            tauri_plugin_secure_storage::init()
        )
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| {
                    format!(
                        "Could not determine application data directory: {e}"
                    )
                })?;

            std::fs::create_dir_all(
                &app_data_dir,
            )?;

            let wallet_db_path =
                app_data_dir.join(
                    "zoerdhub-wallet.sqlite"
                );

            let endpoint =
                std::env::var(
                    "LIGHTWALLETD_URL",
                )
                .unwrap_or_else(|_| {
                    "http://127.0.0.1:9067".to_string()
                });

            app.manage(AppState {
                wallet_db_path,
                lightwalletd_endpoint: endpoint,
            });

            Ok(())
        })
        .invoke_handler(
            tauri::generate_handler![
                check_lightwalletd,
                secure_secret_available,
                create_wallet,
                open_wallet,
                restore_wallet,
                restore_wallet_at_birthday,
                sync_wallet,
                wallet_status,
                get_addresses,
                create_address,
                send_zec,
            ],
        )
        .run(
            tauri::generate_context!()
        )
        .expect(
            "error while running Tauri application"
        );
}
