// The original navigation accepts an EVM wallet context. The public Solana
// edition exposes no EVM adapters, contracts or production deployment settings.
export type SupportedWallet = "metamask" | "demo";
const noop = () => {};
const unsupported = async () => false;
const value = {
  address: null as `0x${string}` | null,
  chainId: -1,
  walletChainId: null as number | null,
  walletType: null as SupportedWallet | null,
  isConnected: false,
  isConnecting: false,
  balance: "—",
  error: null,
  detected: { metamask: false },
  networkCheckChainId: null as number | null,
  connect: (_wallet: SupportedWallet) => unsupported(),
  cancelConnection: noop,
  disconnect: noop,
  refreshBalance: async () => {},
  clearError: noop,
  getProvider: (): any => null,
  selectNetwork: (_id: number) => {},
  clearNetworkCheck: (_id: number) => {},
  switchChain: async (_id: number) => {},
};
export const useWallet = () => value;
