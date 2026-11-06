import type { Connection, SignatureStatus } from '@solana/web3.js';

export interface SolanaTransactionLifetime {
  blockhash: string;
  lastValidBlockHeight: number;
}

/** HTTP confirmation also works behind an ordinary same-origin RPC proxy. */
export async function confirmSolanaTransaction(
  connection: Connection,
  signature: string,
  options: {
    lifetime?: SolanaTransactionLifetime;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<{ context: { slot: number }; value: Pick<SignatureStatus, 'err'> }> {
  const deadline = Date.now() + (options.timeoutMs ?? 90_000);
  let nextHeightCheck = Date.now() + 4_000;
  let lastReadError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const status = result.value[0];
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) {
        return { context: result.context, value: { err: status.err } };
      }
      if (!status && options.lifetime && Date.now() >= nextHeightCheck) {
        nextHeightCheck = Date.now() + 4_000;
        const height = await connection.getBlockHeight('confirmed');
        if (height > options.lifetime.lastValidBlockHeight) {
          // A status read can lag the bank used for the height read. Reconcile
          // once more before declaring an unseen signature expired.
          const finalRead = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
          const finalStatus = finalRead.value[0];
          if (finalStatus && (finalStatus.confirmationStatus === 'confirmed' || finalStatus.confirmationStatus === 'finalized')) {
            return { context: finalRead.context, value: { err: finalStatus.err } };
          }
          if (!finalStatus) throw new ExpiredSolanaSubmissionError(signature);
        }
      }
      lastReadError = undefined;
    } catch (cause) {
      if (cause instanceof ExpiredSolanaSubmissionError) throw cause;
      // A failed read is not evidence of a failed transaction. Keep the saved
      // signature and retry reads; never request another signature here.
      lastReadError = cause;
    }
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 250));
  }
  throw new Error(`Transaction ${signature} is still awaiting confirmation${lastReadError ? ' because RPC status reads are unavailable' : ''}. Its signature is saved; resume checks the chain before another wallet request.`);
}

class ExpiredSolanaSubmissionError extends Error {
  constructor(signature: string) {
    super(`Transaction ${signature} was not found after its blockhash expired. Resume checks the chain before requesting a fresh signature.`);
    this.name = 'ExpiredSolanaSubmissionError';
  }
}

// Wallet requests cannot be cancelled by racing them against a timer. Retain
// the lock until the wallet actually settles, including after a UI unmount.
const pendingWalletRequests = new WeakSet<object>();

export async function requestSolanaWallet<T>(provider: object, request: () => Promise<T>): Promise<T> {
  if (pendingWalletRequests.has(provider)) {
    throw new Error('A Phantom request is already open. Finish or reject that request in the wallet before starting another.');
  }
  pendingWalletRequests.add(provider);
  try {
    return await request();
  } finally {
    pendingWalletRequests.delete(provider);
  }
}
