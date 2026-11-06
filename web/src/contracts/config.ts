import { SOLANA_PROGRAM_ID } from "./solanaConfig";

// Public display metadata only. No deployment/operator configuration is loaded.
export const DEFAULT_CHAIN_ID = -1;
export const SUPPORTED_CHAINS: Record<number, any> = {
  [-1]: {
    id: -1,
    name: "Solana Devnet",
    shortName: "Solana",
    color: "#ab9ff2",
    badgeColor: "#ab9ff2",
    icon: "◎",
    nativeCurrency: { name: "Solana", symbol: "SOL", decimals: 9 },
    rpcUrls: [],
    blockExplorer: "https://explorer.solana.com",
    contractAddress: SOLANA_PROGRAM_ID,
  },
};
export const MAINNET_CHAIN_IDS: number[] = [];
export const TESTNET_CHAIN_IDS: number[] = [-1];
export const hasVerifiedRegistryDeployment = (id: number) =>
  id === DEFAULT_CHAIN_ID;
