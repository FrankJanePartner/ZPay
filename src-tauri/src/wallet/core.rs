use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
use zcash_protocol::consensus::Network;
use zip32::{AccountId, DiversifierIndex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WalletAddress {
    pub id: u32,
    pub alias: String,
    pub address: String,
    pub balance_zatoshis: u64,
}

impl WalletAddress {
    pub fn balance_zec(&self) -> f64 {
        self.balance_zatoshis as f64 / 100_000_000.0
    }
}

#[derive(Debug)]
pub struct WalletCore {
    seed: [u8; 32],
    spending_key: UnifiedSpendingKey,
    addresses: Vec<WalletAddress>,
    next_diversifier_index: u64,
}

impl WalletCore {
    pub fn generate() -> Result<Self, String> {
        let mut seed = [0u8; 32];
        OsRng.fill_bytes(&mut seed);

        Self::from_seed(seed)
    }

    pub fn from_seed(seed: [u8; 32]) -> Result<Self, String> {
        let network = Network::MainNetwork;

        let spending_key = UnifiedSpendingKey::from_seed(
            &network,
            &seed,
            AccountId::ZERO,
        )
        .map_err(|e| format!("Failed to derive wallet keys: {e:?}"))?;

        Ok(Self {
            seed,
            spending_key,
            addresses: Vec::new(),
            next_diversifier_index: 0,
        })
    }

    pub fn create_address(
        &mut self,
        alias: String,
    ) -> Result<WalletAddress, String> {
        let ufvk = self.spending_key.to_unified_full_viewing_key();

        let start_index =
            DiversifierIndex::from(self.next_diversifier_index);

        let (address, actual_index) = ufvk
            .find_address(
                start_index,
                UnifiedAddressRequest::AllAvailableKeys,
            )
            .map_err(|e| format!("Failed to derive address: {e:?}"))?;

        let actual_index_u64 = u64::try_from(actual_index)
            .map_err(|_| "Address index is too large".to_string())?;

        self.next_diversifier_index = actual_index_u64
            .checked_add(1)
            .ok_or_else(|| "Address index overflow".to_string())?;

        let id = self.addresses.len() as u32;

        let wallet_address = WalletAddress {
            id,
            alias,
            address: address.encode(&Network::MainNetwork),
            balance_zatoshis: 0,
        };

        self.addresses.push(wallet_address.clone());

        Ok(wallet_address)
    }

    pub fn ensure_default_address(&mut self) -> Result<WalletAddress, String> {
        if let Some(address) = self.addresses.first() {
            return Ok(address.clone());
        }

        self.create_address("Main Address".to_string())
    }

    pub fn total_balance_zatoshis(&self) -> u64 {
        self.addresses
            .iter()
            .map(|address| address.balance_zatoshis)
            .sum()
    }

    pub fn total_balance_zec(&self) -> f64 {
        self.total_balance_zatoshis() as f64 / 100_000_000.0
    }

    pub fn addresses(&self) -> &[WalletAddress] {
        &self.addresses
    }

    pub fn set_address_balance(
        &mut self,
        id: u32,
        balance_zatoshis: u64,
    ) -> Result<(), String> {
        let address = self
            .addresses
            .iter_mut()
            .find(|address| address.id == id)
            .ok_or_else(|| format!("Address {} not found", id))?;

        address.balance_zatoshis = balance_zatoshis;

        Ok(())
    }

    pub fn seed(&self) -> &[u8; 32] {
        &self.seed
    }

    pub fn next_diversifier_index(&self) -> u64 {
        self.next_diversifier_index
    }
}