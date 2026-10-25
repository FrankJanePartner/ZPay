/** Shared typed contracts between the React desktop and Tauri wallet commands. */
export type WalletStatus = {
  chain_height: number | null;
  fully_scanned_height: number | null;
  total_zatoshis: number;
  spendable_zatoshis: number;
  pending_zatoshis: number;
  address_count: number;
};

export type TransactionHistoryEntry = {
  txid: string;
  direction: "sent" | "received" | "internal";
  status: "confirmed" | "pending" | "expired";
  amount_zatoshis: number;
  fee_zatoshis: number | null;
  mined_height: number | null;
  block_time: number | null;
  memos: string[];
};

export type CreatedWallet = {
  recovery_phrase: string;
  address: string;
  birthday_height: number;
  chain_tip: number;
  secure_storage_saved: boolean;
};
