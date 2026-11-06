import { createContext, useContext } from "react";
import { useSolanaWallet } from "./solanaWalletState";

// Local UI compatibility only: no account SDK, cookies, tokens, login endpoint
// or server-side authentication implementation is included in this release.
export const PublicWalletUiContext = createContext<() => void>(() => {});
export function useAuthSession() {
  const wallet = useSolanaWallet();
  const openWallet = useContext(PublicWalletUiContext);
  return {
    status: wallet.isConnected ? "authenticated" : "anonymous",
    scopeKey: wallet.address ? `wallet:${wallet.address}` : "anonymous:public",
    session: wallet.address
      ? { displayName: `solana:${wallet.address}` }
      : null,
    loginPhase: wallet.isConnecting ? "waiting" : "idle",
    walletMismatch: false,
    login: (_returnTo?: string) => openWallet(),
    loginInThisTab: (_returnTo?: string) => openWallet(),
    cancelLogin: wallet.cancelConnection,
    logout: async () => wallet.disconnect(),
    refresh: async () => {},
  };
}
