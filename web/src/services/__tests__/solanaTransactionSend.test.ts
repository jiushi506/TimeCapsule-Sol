import assert from 'node:assert/strict';
import test from 'node:test';
import { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, type SendOptions, type TransactionSignature } from '@solana/web3.js';
import { assertBlockhashHasSubmissionWindow, chooseDefaultLegacySubmission, formatSolanaError, getFreshReviewBlockhash, reconcilePendingSubmission, sendSignedTransactionWithFreshContext, signAndSendLegacyTransaction, signAndSendLegacyWithPhantom } from '../solanaCapsuleService';
import type { PhantomSolanaProvider } from '../../context/solanaWalletUtils';

function encodeTestSignature(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let leadingZeroes = 0;
  while (leadingZeroes < bytes.length && bytes[leadingZeroes] === 0) leadingZeroes += 1;
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    const remainder = Number(value % 58n);
    value /= 58n;
    encoded = alphabet[remainder] + encoded;
  }
  return `${'1'.repeat(leadingZeroes)}${encoded}` || '1';
}

test('prefers one batch review when supported and wallet submission otherwise', () => {
  assert.equal(chooseDefaultLegacySubmission({ ownerMatches: true, canSign: true, canWalletSend: true, canSignAll: true }), 'app-batch');
  assert.equal(chooseDefaultLegacySubmission({ ownerMatches: true, canSign: false, canWalletSend: true }), 'phantom');
  assert.equal(chooseDefaultLegacySubmission({ ownerMatches: false, canSign: true, canWalletSend: true }), 'durable-nonce');
});

test('retries only a preflight BlockhashNotFound with the same bytes and minContextSlot', async () => {
  const signedBytes = new Uint8Array([1, 2, 3]);
  const attempts: Array<{ bytes: Uint8Array; options: SendOptions }> = [];
  const connection = {
    async sendRawTransaction(bytes: Uint8Array, options: SendOptions): Promise<TransactionSignature> {
      attempts.push({ bytes, options });
      if (attempts.length < 3) throw new Error('Transaction simulation failed: Blockhash not found. Logs: [].');
      return 'mock-signature';
    },
  } as unknown as Connection;

  const signature = await sendSignedTransactionWithFreshContext(connection, signedBytes, {
    maxRetries: 3,
    preflightCommitment: 'confirmed',
    minContextSlot: 42,
  });

  assert.equal(signature, 'mock-signature');
  assert.equal(attempts.length, 3);
  for (const attempt of attempts) {
    assert.equal(attempt.bytes, signedBytes);
    assert.equal(attempt.options.minContextSlot, 42);
    assert.equal(attempt.options.skipPreflight, false);
  }
});

test('does not retry unrelated RPC failures', async () => {
  let attempts = 0;
  const connection = {
    async sendRawTransaction(): Promise<TransactionSignature> {
      attempts += 1;
      throw new Error('HTTP 429');
    },
  } as unknown as Connection;

  await assert.rejects(() => sendSignedTransactionWithFreshContext(connection, new Uint8Array([1]), {
    maxRetries: 3,
    preflightCommitment: 'confirmed',
    minContextSlot: 42,
  }), /HTTP 429/);
  assert.equal(attempts, 1);
});

test('RPC errors omit secret-bearing endpoint URLs', () => {
  const formatted = formatSolanaError(new Error('Failed at https://example.test/?api-key=secret-fixture-value'), 'fallback');
  assert.ok(!formatted.includes('secret-fixture-value'));
  assert.ok(formatted.includes('[RPC URL]'));
});

test('checks the signed transaction lifetime before submission', async () => {
  const makeConnection = (height: number) => ({
    async getBlockHeight(commitment: string) {
      assert.equal(commitment, 'confirmed');
      return height;
    },
  }) as unknown as Connection;

  await assertBlockhashHasSubmissionWindow(makeConnection(120), { lastValidBlockHeight: 120 });
  await assert.rejects(
    () => assertBlockhashHasSubmissionWindow(makeConnection(121), { lastValidBlockHeight: 120 }, Date.now() - 10_000),
    /about 10 seconds.*Devnet block height 121 is past its last valid height 120; nothing was submitted/,
  );
});

test('refreshes a stale RPC blockhash before opening Phantom', async () => {
  let latestCalls = 0;
  const configs: Array<{ commitment?: string; minContextSlot?: number }> = [];
  const connection = {
    async getLatestBlockhashAndContext(config: { commitment?: string; minContextSlot?: number }) {
      configs.push(config);
      latestCalls += 1;
      return latestCalls === 1
        ? { context: { slot: 42 }, value: { blockhash: 'stale', lastValidBlockHeight: 180 } }
        : { context: { slot: 48 }, value: { blockhash: 'fresh', lastValidBlockHeight: 300 } };
    },
    async getBlockHeight(commitment: string) {
      assert.equal(commitment, 'confirmed');
      return 100;
    },
  } as unknown as Connection;
  const result = await getFreshReviewBlockhash(connection);
  assert.equal(result.value.blockhash, 'fresh');
  assert.equal(latestCalls, 2);
  assert.deepEqual(configs, [
    { commitment: 'confirmed' },
    { commitment: 'confirmed', minContextSlot: 42 },
  ]);
});

test('does not open a wallet request when the RPC cannot provide enough blockhash lifetime', async () => {
  const connection = {
    async getLatestBlockhashAndContext() { return { context: { slot: 42 }, value: { blockhash: 'stale', lastValidBlockHeight: 180 } }; },
    async getBlockHeight() { return 100; },
  } as unknown as Connection;
  await assert.rejects(() => getFreshReviewBlockhash(connection), /only 80 blocks left.*No Phantom request was opened/);
});

test('formats a preflight blockhash error without exposing the raw RPC text', () => {
  const message = formatSolanaError(new Error('Transaction simulation failed: Blockhash not found. Logs: []'), 'fallback');
  assert.match(message, /Resume/);
  assert.doesNotMatch(message, /Logs:/);
});

test('Phantom broadcasts upon approval and finalized instructions are checked', async () => {
  const signer = Keypair.generate();
  const owner = signer.publicKey;
  const instruction = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
  const signature = encodeTestSignature(new Uint8Array(64).fill(7));
  const walletBlockhash = Keypair.generate().publicKey.toBase58();
  let walletCalls = 0;
  let rawBroadcasts = 0;
  const callOrder: string[] = [];
  let receiptMessage = new Transaction({ feePayer: owner, recentBlockhash: walletBlockhash }).add(instruction).compileMessage();
  const provider = {
    publicKey: owner,
    async signAndSendTransaction(transaction: Transaction, options: { preflightCommitment?: string; maxRetries?: number; minContextSlot?: number }) {
      callOrder.push('wallet');
      walletCalls += 1;
      assert.equal(transaction.recentBlockhash, walletBlockhash);
      assert.equal(transaction.instructions.length, 1);
      assert.equal(options.preflightCommitment, 'confirmed');
      assert.equal(options.maxRetries, 3);
      assert.equal(options.minContextSlot, undefined);
      return { signature };
    },
  } as unknown as PhantomSolanaProvider;
  const connection = {
    async getLatestBlockhashAndContext(config: { commitment: string }) {
      callOrder.push('latest-blockhash');
      assert.equal(config.commitment, 'confirmed');
      return { context: { slot: 42 }, value: { blockhash: walletBlockhash, lastValidBlockHeight: 260 } };
    },
    async getBlockHeight(commitment: string) {
      callOrder.push('block-height');
      assert.equal(commitment, 'confirmed');
      return 100;
    },
    async sendRawTransaction() { rawBroadcasts += 1; throw new Error('the app must not broadcast'); },
    async getSignatureStatuses() {
      return { context: { slot: 43 }, value: [{ confirmationStatus: 'confirmed', err: null }] };
    },
    async getTransaction() {
      return { version: 'legacy', meta: { err: null }, transaction: { message: receiptMessage, signatures: [signature] } };
    },
  } as unknown as Connection;
  let persistedSignature = '';
  assert.equal(await signAndSendLegacyWithPhantom(connection, provider, owner.toBase58(), instruction, undefined,
    (value, lifetime) => { persistedSignature = value; assert.equal(lifetime, Number.MAX_SAFE_INTEGER); }), signature);
  assert.equal(persistedSignature, signature);
  assert.equal(walletCalls, 1);
  assert.equal(rawBroadcasts, 0);
  assert.deepEqual(callOrder, ['latest-blockhash', 'block-height', 'wallet']);
  receiptMessage = new Transaction({ feePayer: owner, recentBlockhash: walletBlockhash }).add(
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: SystemProgram.programId, lamports: 0 }),
  ).compileMessage();
  await assert.rejects(() => signAndSendLegacyWithPhantom(connection, provider, owner.toBase58(), instruction), /differs from the reviewed instructions/);
});

test('Phantom signs locally, then the app RPC broadcasts with the blockhash context and verifies the finalized instructions', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const instruction = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
  const blockhash = Keypair.generate().publicKey.toBase58();
  const reviewed = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(instruction);
  const sent = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 70_000 }),
    instruction,
  );
  let receiptMessage = sent.compileMessage();
  let failConfirmation = false;
  let walletCalls = 0;
  let broadcastCalls = 0;
  const callOrder: string[] = [];
  let expectedSignature: string | undefined;
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      callOrder.push('wallet');
      walletCalls += 1;
      assert.deepEqual(transaction.serializeMessage(), reviewed.serializeMessage());
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 70_000 }),
      );
      transaction.partialSign(ownerSigner);
      // Simulate Phantom returning a Transaction instance from another copy of
      // web3.js: it has serialization but fails this app's instanceof check.
      return { serialize: (options: Parameters<Transaction['serialize']>[0]) => transaction.serialize(options) } as unknown as Transaction;
    },
  } as unknown as PhantomSolanaProvider;
  const connection = {
    async getLatestBlockhashAndContext(config: { commitment: string }) {
      callOrder.push('latest-blockhash');
      assert.equal(config.commitment, 'confirmed');
      return { context: { slot: 42 }, value: { blockhash, lastValidBlockHeight: 260 } };
    },
    async getBlockHeight(commitment: string) {
      assert.equal(commitment, 'confirmed');
      return 100;
    },
    async sendRawTransaction(bytes: Uint8Array, options: SendOptions) {
      broadcastCalls += 1;
      assert.ok(bytes.length > 64);
      assert.equal(options.minContextSlot, 42);
      assert.equal(options.skipPreflight, false);
      assert.ok(expectedSignature, 'the signed signature is persisted before broadcast');
      return expectedSignature;
    },
    async getSignatureStatuses() {
      return { context: { slot: 43 }, value: [{ confirmationStatus: 'confirmed', err: null }] };
    },
    async getTransaction() {
      if (failConfirmation) throw new Error('fixture receipt unavailable');
      return {
        version: 'legacy', meta: { err: null },
        transaction: { message: receiptMessage, signatures: [expectedSignature] },
      };
    },
  } as unknown as Connection;
  assert.equal(await signAndSendLegacyTransaction(connection, provider, owner.toBase58(), instruction, undefined, (signature, height) => {
    expectedSignature = signature;
    assert.equal(height, 260);
  }), expectedSignature);
  assert.equal(walletCalls, 1);
  assert.equal(broadcastCalls, 1);
  assert.deepEqual(callOrder.slice(0, 2), ['latest-blockhash', 'wallet']);
  receiptMessage = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: SystemProgram.programId, lamports: 0 }),
  ).compileMessage();
  await assert.rejects(
    () => signAndSendLegacyTransaction(connection, provider, owner.toBase58(), instruction, undefined, (signature) => { expectedSignature = signature; }),
    /differs from the reviewed capsule instructions/,
  );
  failConfirmation = true;
  let recordedSignature: string | undefined;
  await assert.rejects(
    () => signAndSendLegacyTransaction(connection, provider, owner.toBase58(), instruction, undefined, (value) => { expectedSignature = value; recordedSignature = value; }),
    /fixture receipt unavailable/,
  );
  assert.equal(recordedSignature, expectedSignature);
  assert.equal(walletCalls, 3);
});

test('durable nonce keeps the reviewed transaction valid through a delayed wallet review', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const nonceAccount = Keypair.generate().publicKey;
  const nonceValue = Keypair.generate().publicKey.toBase58();
  const advance = SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner });
  const instruction = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
  const reviewed = new Transaction({ feePayer: owner, recentBlockhash: nonceValue }).add(advance, instruction);
  let expectedSignature: string | undefined;
  let receiptMessage = reviewed.compileMessage();
  let heightChecks = 0;
  let latestBlockhashChecks = 0;
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      assert.equal(transaction.recentBlockhash, nonceValue);
      assert.equal(transaction.instructions[0].programId.toBase58(), SystemProgram.programId.toBase58());
      transaction.partialSign(ownerSigner);
      return transaction;
    },
  } as unknown as PhantomSolanaProvider;
  const connection = {
    async getLatestBlockhashAndContext() { latestBlockhashChecks += 1; throw new Error('a durable nonce must not request a recent blockhash'); },
    async getBlockHeight() { heightChecks += 1; throw new Error('a durable nonce must not expire by block height'); },
    async sendRawTransaction(bytes: Uint8Array, options: SendOptions) {
      assert.equal(options.minContextSlot, 42);
      const signed = Transaction.from(bytes);
      expectedSignature = encodeTestSignature(signed.signature!);
      receiptMessage = signed.compileMessage();
      return expectedSignature;
    },
    async getSignatureStatuses() {
      return { context: { slot: 43 }, value: [{ confirmationStatus: 'confirmed', err: null }] };
    },
    async getTransaction(signature: string) {
      return { version: 'legacy', meta: { err: null }, transaction: { message: receiptMessage, signatures: [signature] } };
    },
  } as unknown as Connection;
  const signature = await signAndSendLegacyTransaction(
    connection, provider, owner.toBase58(), instruction, undefined,
    (_signature, lastValidBlockHeight) => assert.equal(lastValidBlockHeight, Number.MAX_SAFE_INTEGER),
    undefined,
    { account: nonceAccount, value: nonceValue, contextSlot: 42 },
  );
  assert.ok(signature);
  assert.equal(heightChecks, 0);
  assert.equal(latestBlockhashChecks, 0);
});

test('accepts bounded Phantom fee instructions appended to the one-time nonce setup', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const seed = 'timecapsule-devnet-nonce-v1';
  const nonceAccount = await PublicKey.createWithSeed(owner, seed, SystemProgram.programId);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const setup = SystemProgram.createNonceAccount({
    fromPubkey: owner,
    noncePubkey: nonceAccount,
    basePubkey: owner,
    seed,
    lamports: 1_056_640,
    authorizedPubkey: owner,
  });
  let expectedSignature: string | undefined;
  let receiptMessage = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(...setup.instructions).compileMessage();
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      transaction.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_000 }),
      );
      transaction.partialSign(ownerSigner);
      return transaction;
    },
  } as unknown as PhantomSolanaProvider;
  const connection = {
    async getLatestBlockhashAndContext() { return { context: { slot: 42 }, value: { blockhash, lastValidBlockHeight: 260 } }; },
    async simulateTransaction() { return { value: { err: null } }; },
    async getBlockHeight() { return 100; },
    async sendRawTransaction(bytes: Uint8Array) {
      const signed = Transaction.from(bytes);
      expectedSignature = encodeTestSignature(signed.signature!);
      receiptMessage = signed.compileMessage();
      return expectedSignature;
    },
    async getSignatureStatuses() {
      return { context: { slot: 43 }, value: [{ confirmationStatus: 'confirmed', err: null }] };
    },
    async getTransaction(signature: string) {
      return { version: 'legacy', meta: { err: null }, transaction: { message: receiptMessage, signatures: [signature] } };
    },
  } as unknown as Connection;

  const signature = await signAndSendLegacyTransaction(connection, provider, owner.toBase58(), setup.instructions);
  assert.equal(signature, expectedSignature);
});

test('checks Phantom priority fees against the implicit instruction-based CU limit', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const seed = 'timecapsule-devnet-nonce-v1';
  const nonceAccount = await PublicKey.createWithSeed(owner, seed, SystemProgram.programId);
  const blockhash = Keypair.generate().publicKey.toBase58();
  const setup = SystemProgram.createNonceAccount({
    fromPubkey: owner,
    noncePubkey: nonceAccount,
    basePubkey: owner,
    seed,
    lamports: 1_056_640,
    authorizedPubkey: owner,
  });
  let expectedSignature: string | undefined;
  let receiptMessage = new Transaction({ feePayer: owner, recentBlockhash: blockhash }).add(...setup.instructions).compileMessage();
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      // Phantom can attach a price without an explicit CU limit. The default
      // for these two System Program instructions (plus this built-in fee
      // instruction) is 9,000 CU, so the fee is 90,000 lamports, within cap.
      transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000 }));
      transaction.partialSign(ownerSigner);
      return transaction;
    },
  } as unknown as PhantomSolanaProvider;
  const connection = {
    async getLatestBlockhashAndContext() { return { context: { slot: 42 }, value: { blockhash, lastValidBlockHeight: 260 } }; },
    async simulateTransaction() { return { value: { err: null } }; },
    async getBlockHeight() { return 100; },
    async sendRawTransaction(bytes: Uint8Array) {
      const signed = Transaction.from(bytes);
      expectedSignature = encodeTestSignature(signed.signature!);
      receiptMessage = signed.compileMessage();
      return expectedSignature;
    },
    async getSignatureStatuses() {
      return { context: { slot: 43 }, value: [{ confirmationStatus: 'confirmed', err: null }] };
    },
    async getTransaction(signature: string) {
      return { version: 'legacy', meta: { err: null }, transaction: { message: receiptMessage, signatures: [signature] } };
    },
  } as unknown as Connection;

  const signature = await signAndSendLegacyTransaction(connection, provider, owner.toBase58(), setup.instructions);
  assert.equal(signature, expectedSignature);
});

test('does not broadcast a wallet-modified capsule instruction', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const instruction = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
  const blockhash = Keypair.generate().publicKey.toBase58();
  let broadcasts = 0;
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      transaction.instructions[0].data[4] = 1;
      transaction.partialSign(ownerSigner);
      return transaction;
    },
  } as unknown as PhantomSolanaProvider;
  const connection = {
    async getLatestBlockhashAndContext() { return { context: { slot: 42 }, value: { blockhash, lastValidBlockHeight: 260 } }; },
    async simulateTransaction() { return { value: { err: null } }; },
    async getBlockHeight() { return 100; },
    async sendRawTransaction() { broadcasts += 1; return 'unexpected'; },
  } as unknown as Connection;
  await assert.rejects(
    () => signAndSendLegacyTransaction(connection, provider, owner.toBase58(), instruction),
    /application instruction changed, was added, or was omitted/,
  );
  assert.equal(broadcasts, 0);
});

test('accepts a wallet-refreshed blockhash with unchanged instructions and a verified owner signature', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const instruction = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
  const blockhash = Keypair.generate().publicKey.toBase58();
  const refreshedHash = Keypair.generate().publicKey.toBase58();
  let expectedSignature = '';
  let receiptMessage: ReturnType<Transaction['compileMessage']>;
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      transaction.recentBlockhash = refreshedHash;
      transaction.partialSign(ownerSigner);
      expectedSignature = encodeTestSignature(transaction.signature!);
      receiptMessage = transaction.compileMessage();
      return transaction;
    },
  } as unknown as PhantomSolanaProvider;
  let broadcasts = 0;
  const connection = {
    async getLatestBlockhashAndContext() { return { context: { slot: 42 }, value: { blockhash, lastValidBlockHeight: 260 } }; },
    async simulateTransaction() { return { value: { err: null } }; },
    async getBlockHeight() { return 100; },
    async sendRawTransaction() { broadcasts += 1; return expectedSignature; },
    async getSignatureStatuses() { return { context: { slot: 43 }, value: [{ confirmationStatus: 'confirmed', err: null }] }; },
    async getTransaction() { return { version: 'legacy', meta: { err: null }, transaction: { message: receiptMessage, signatures: [expectedSignature] } }; },
  } as unknown as Connection;
  const signature = await signAndSendLegacyTransaction(connection, provider, owner.toBase58(), instruction, undefined,
    (_signature, height, nonce, actualHash) => {
      assert.equal(height, Number.MAX_SAFE_INTEGER);
      assert.equal(nonce, undefined);
      assert.equal(actualHash, refreshedHash);
    });
  assert.equal(signature, expectedSignature);
  assert.equal(broadcasts, 1);
});

test('does not broadcast a Phantom priority fee above the displayed per-transaction cap', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const instruction = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
  const blockhash = Keypair.generate().publicKey.toBase58();
  let broadcasts = 0;
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500_001 }),
      );
      transaction.partialSign(ownerSigner);
      return transaction;
    },
  } as unknown as PhantomSolanaProvider;
  const connection = {
    async getLatestBlockhashAndContext() { return { context: { slot: 42 }, value: { blockhash, lastValidBlockHeight: 260 } }; },
    async simulateTransaction() { return { value: { err: null } }; },
    async getBlockHeight() { return 100; },
    async sendRawTransaction() { broadcasts += 1; return 'unexpected'; },
  } as unknown as Connection;
  await assert.rejects(
    () => signAndSendLegacyTransaction(connection, provider, owner.toBase58(), instruction),
    /Phantom priority fee exceeds the accepted cap/,
  );
  assert.equal(broadcasts, 0);
});

test('does not request another wallet signature while a signed transaction may still be processing', async () => {
  const draft = {
    schemaVersion: 1, cluster: 'devnet', programId: 'program', owner: 'owner', capsuleId: '1', capsulePda: 'pda',
    unlockAt: 1, mode: 'public', formatVersion: 1, payloadHash: 'hash', payloadBase64: 'AA==',
    publicTitle: '', updatedAt: 1, pendingSignature: 'pending-signature', pendingLastValidBlockHeight: 200, pendingPhase: 'begin',
  } as const;
  const connection = {
    async getSignatureStatuses(signatures: string[], options: { searchTransactionHistory: boolean }) {
      assert.deepEqual(signatures, ['pending-signature']);
      assert.equal(options.searchTransactionHistory, true);
      return { value: [null] };
    },
    async getBlockHeight() { return 100; },
  } as unknown as Connection;
  await assert.rejects(
    () => reconcilePendingSubmission(connection, draft as any),
    /No new wallet request was sent/,
  );
  assert.equal(draft.pendingSignature, 'pending-signature');
});

test('clears an unconfirmed signed transaction only after its blockhash expires', async () => {
  const draft = {
    schemaVersion: 1, cluster: 'devnet', programId: 'program', owner: 'owner', capsuleId: '1', capsulePda: 'pda',
    unlockAt: 1, mode: 'public', formatVersion: 1, payloadHash: 'hash', payloadBase64: 'AA==',
    publicTitle: '', updatedAt: 1, pendingSignature: 'expired-signature', pendingLastValidBlockHeight: 200, pendingPhase: 'payload',
  } as any;
  const connection = {
    async getSignatureStatuses() { return { value: [null] }; },
    async getBlockHeight() { return 201; },
  } as unknown as Connection;
  assert.equal(await reconcilePendingSubmission(connection, draft), 'expired');
  assert.equal(draft.pendingSignature, undefined);
  assert.equal(draft.pendingLastValidBlockHeight, undefined);
});

test('keeps a transaction that becomes visible between the status and expiry reads', async () => {
  const draft = {pendingSignature:'late-confirmation',pendingLastValidBlockHeight:200,pendingPhase:'begin'} as any;
  let reads=0;
  const connection = {
    async getSignatureStatuses() { return {value:[++reads===1?null:{confirmationStatus:'confirmed',err:null}]}; },
    async getBlockHeight() { return 201; },
  } as unknown as Connection;
  assert.equal(await reconcilePendingSubmission(connection,draft),'confirmed');
  assert.equal(draft.lastSignature,'late-confirmation');
  assert.equal(draft.beginSignature,'late-confirmation');
});

test('reconciles a known confirmed transaction before clearing its pending marker', async () => {
  const draft = {
    schemaVersion: 1, cluster: 'devnet', programId: 'program', owner: 'owner', capsuleId: '1', capsulePda: 'pda',
    unlockAt: 1, mode: 'public', formatVersion: 1, payloadHash: 'hash', payloadBase64: 'AA==',
    publicTitle: '', updatedAt: 1, pendingSignature: 'finalized-signature', pendingLastValidBlockHeight: 200, pendingPhase: 'begin',
  } as any;
  const connection = {
    async getSignatureStatuses() {
      return { context: { slot: 43 }, value: [{ confirmationStatus: 'confirmed', err: null }] };
    },
  } as unknown as Connection;
  assert.equal(await reconcilePendingSubmission(connection, draft), 'confirmed');
  assert.equal(draft.lastSignature, 'finalized-signature');
  assert.equal(draft.beginSignature, 'finalized-signature');
  assert.equal(draft.pendingSignature, undefined);
});

test('a definitive RPC 429 clears the signed-but-unsubmitted marker and never retries the wallet', async () => {
  const ownerSigner = Keypair.generate();
  const owner = ownerSigner.publicKey;
  const instruction = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
  const blockhash = Keypair.generate().publicKey.toBase58();
  const provider = {
    publicKey: owner,
    async signTransaction(transaction: Transaction) {
      transaction.partialSign(ownerSigner);
      return transaction;
    },
  } as unknown as PhantomSolanaProvider;
  let broadcasts = 0;
  let signatureWasRecorded = false;
  let rejectionWasRecorded = false;
  const connection = {
    async getLatestBlockhashAndContext() {
      return { context: { slot: 42 }, value: { blockhash, lastValidBlockHeight: 260 } };
    },
    async simulateTransaction() { return { value: { err: null } }; },
    async getBlockHeight() { return 100; },
    async sendRawTransaction() {
      broadcasts += 1;
      throw new Error('HTTP 429 Too Many Requests');
    },
  } as unknown as Connection;

  await assert.rejects(
    () => signAndSendLegacyTransaction(
      connection, provider, owner.toBase58(), instruction, undefined,
      () => { signatureWasRecorded = true; },
      () => { rejectionWasRecorded = true; },
    ),
    /rate-limited \(HTTP 429\)/,
  );
  assert.equal(signatureWasRecorded, true);
  assert.equal(rejectionWasRecorded, true);
  assert.equal(broadcasts, 1);
});
