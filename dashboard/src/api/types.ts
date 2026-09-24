export interface SessionResponse {
  token: string;
  expires_in: number;
}

export interface KeyMetadata {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  revoked_at: string | null;
}

export interface IssuedKey extends KeyMetadata {
  key: string;
}

export interface PaymentRequest {
  id: string;
  reference: string;
  amount_zatoshis: string;
  address: string | null;
  status: "provisioning" | "awaiting_payment" | "expired";
  created_at: string;
  expires_at: string | null;
  received_zatoshis: string;
  funding_status: "unpaid" | "partially_paid" | "paid" | "overpaid";
}

export interface SendRequest {
  id: string;
  recipient_address: string;
  amount_zatoshis: string;
  status: "pending" | "broadcast" | "failed";
  txids: string[];
  error: string;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface WalletBalance {
  total_zatoshis: string | null;
  spendable_zatoshis: string | null;
  pending_zatoshis: string | null;
  confirmed_received_zatoshis: string | null;
  chain_height: number | null;
  synced_at: string | null;
  stale: boolean;
  sync_error: string;
  settlement_enabled: boolean;
}

export interface DepositOutput {
  id: string;
  payment_request: string | null;
  txid: string;
  pool: number;
  output_index: number;
  amount_zatoshis: string;
  address: string | null;
  mined_height: number;
  block_time: string;
  confirmations: number;
  status: "confirmed" | "reversed";
  late: boolean | null;
  first_seen_at: string;
}

export type ApiErrorFields = Record<string, string | string[]>;
