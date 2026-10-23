/** Exact integer formatting for display-only Zcash values. */
const ZATOSHIS_PER_ZEC = 100_000_000n;

export function formatZec(zatoshis: number): string {
  if (!Number.isSafeInteger(zatoshis)) return "Amount unavailable";
  const value = BigInt(zatoshis);
  const absolute = value < 0n ? -value : value;
  const whole = absolute / ZATOSHIS_PER_ZEC;
  const fractional = (absolute % ZATOSHIS_PER_ZEC)
    .toString().padStart(8, "0");
  return `${value < 0n ? "-" : ""}${whole}.${fractional}`;
}
