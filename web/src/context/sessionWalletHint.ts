export function sessionWalletHint(
  value?: string | null,
): { family: "solana" | "evm"; address: string } | null {
  return value?.startsWith("solana:")
    ? { family: "solana", address: value.slice(7) }
    : null;
}
