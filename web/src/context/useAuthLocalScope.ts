import { useSolanaWallet } from "./solanaWalletState";
export function useAuthLocalScope() {
  const wallet = useSolanaWallet();
  return {
    key: `public-solana:${wallet.address ?? "drafts"}`,
    authenticated: wallet.isConnected,
  };
}
