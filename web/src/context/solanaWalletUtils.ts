export interface PhantomSolanaProvider {
  isPhantom?: boolean;
  isConnected?: boolean;
  publicKey?: { toBase58?: () => string; toString: () => string } | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toBase58?: () => string; toString: () => string } }>;
  signTransaction?: <T>(transaction: T) => Promise<T>;
  signAllTransactions?: <T>(transactions: T[]) => Promise<T[]>;
  signAndSendTransaction?: <T>(transaction: T, options?: {
    preflightCommitment?: string;
    maxRetries?: number;
    minContextSlot?: number;
    skipPreflight?: boolean;
  }) => Promise<{ signature: string }>;
  disconnect?: () => Promise<void> | void;
  on?: (event: string, listener: (...args: any[]) => void) => void;
  off?: (event: string, listener: (...args: any[]) => void) => void;
  removeListener?: (event: string, listener: (...args: any[]) => void) => void;
}

type PhantomSolanaWindow = {
  phantom?: { solana?: PhantomSolanaProvider };
  solana?: PhantomSolanaProvider;
};

export function getPhantomSolanaProvider(win: PhantomSolanaWindow): PhantomSolanaProvider | null {
  const phantom = win.phantom?.solana;
  const solana = win.solana;
  // If one of them is already actively connected, prefer it
  if (phantom?.isPhantom && phantom.isConnected) return phantom;
  if (solana?.isPhantom && solana.isConnected) return solana;
  // Otherwise prefer namespaced phantom, fallback to window.solana
  if (phantom?.isPhantom) return phantom;
  if (solana?.isPhantom) return solana;
  return null;
}

export function isValidSolanaAddress(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 32 && value.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(value);
}

export function solanaPublicKeyString(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const publicKey = value as { toBase58?: () => string; toString?: () => string };
  try {
    const address = typeof publicKey.toBase58 === 'function'
      ? publicKey.toBase58()
      : typeof publicKey.toString === 'function'
        ? publicKey.toString()
        : null;
    return isValidSolanaAddress(address) ? address : null;
  } catch {
    return null;
  }
}

export async function connectPhantomSolana(
  provider: PhantomSolanaProvider,
  onlyIfTrusted = false,
): Promise<string> {
  const result = await provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
  const address = solanaPublicKeyString(result?.publicKey ?? provider.publicKey);
  if (!address) throw new Error('Phantom returned an invalid Solana public key.');
  return address;
}

export function subscribePhantomSolana(
  provider: PhantomSolanaProvider,
  handlers: { accountChanged: (publicKey: unknown) => void; disconnect: () => void },
): () => void {
  provider.on?.('accountChanged', handlers.accountChanged);
  provider.on?.('disconnect', handlers.disconnect);
  return () => {
    if (provider.off) {
      provider.off('accountChanged', handlers.accountChanged);
      provider.off('disconnect', handlers.disconnect);
    } else {
      provider.removeListener?.('accountChanged', handlers.accountChanged);
      provider.removeListener?.('disconnect', handlers.disconnect);
    }
  };
}
