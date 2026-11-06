import { createContext, useContext } from 'react';

export interface SolanaWalletContextValue {
  address: string | null;
  isInstalled: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  balance: string;
  balanceError: string | null;
  refreshBalance: () => Promise<void>;
  connect: () => Promise<boolean>;
  cancelConnection: () => void;
  disconnect: () => void;
  clearError: () => void;
}

export const SolanaWalletContext = createContext<SolanaWalletContextValue | null>(null);

export function useSolanaWallet(): SolanaWalletContextValue {
  const context = useContext(SolanaWalletContext);
  if (!context) throw new Error('useSolanaWallet must be used within a SolanaWalletProvider');
  return context;
}
