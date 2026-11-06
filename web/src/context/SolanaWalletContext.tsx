import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SolanaWalletContext } from "./solanaWalletState";
import { useWallet } from "./useWallet";
import { getPhantomSolanaProvider } from "./solanaWalletUtils";
import { createSolanaConnection } from "../services/solanaCapsuleService";

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  const [balance, setBalance] = useState("—");
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const balanceVersion = useRef(0);
  const refreshBalance = useCallback(async () => {
    const version = ++balanceVersion.current;
    if (!wallet.owner) return;
    try {
      const { PublicKey } = await import("@solana/web3.js");
      const value = await createSolanaConnection().getBalance(
        new PublicKey(wallet.owner),
        "confirmed",
      );
      if (version !== balanceVersion.current) return;
      setBalance((value / 1e9).toFixed(4));
      setBalanceError(null);
    } catch {
      if (version !== balanceVersion.current) return;
      setBalance("—");
      setBalanceError("Could not read the public Devnet balance.");
    }
  }, [wallet.owner]);
  useEffect(() => {
    setBalance("—");
    void refreshBalance();
    return () => {
      balanceVersion.current++;
    };
  }, [refreshBalance]);
  return (
    <SolanaWalletContext.Provider
      value={{
        address: wallet.owner || null,
        isInstalled: !!getPhantomSolanaProvider(window as never),
        isConnected: !!wallet.owner,
        isConnecting: wallet.connecting,
        error: wallet.error || null,
        balance,
        balanceError,
        refreshBalance,
        connect: async () => {
          await wallet.connect();
          return !!wallet.provider.current;
        },
        cancelConnection: wallet.cancelConnection,
        disconnect: wallet.disconnect,
        clearError: wallet.clearError,
      }}
    >
      {children}
    </SolanaWalletContext.Provider>
  );
}
