const ZATOSHI_PER_ZEC = 100_000_000n;
const ZATOSHI_PATTERN = /^(0|[1-9][0-9]*)$/;

export function formatZec(zatoshi: string): string {
  if (!ZATOSHI_PATTERN.test(zatoshi)) {
    throw new Error("Invalid zatoshi amount");
  }

  const amount = BigInt(zatoshi);
  const whole = amount / ZATOSHI_PER_ZEC;
  const fraction = amount % ZATOSHI_PER_ZEC;

  return `${whole}.${fraction.toString().padStart(8, "0")}`;
}
