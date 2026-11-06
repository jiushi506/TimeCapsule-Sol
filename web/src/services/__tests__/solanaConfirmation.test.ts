import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { ComputeBudgetProgram, Connection, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { confirmSolanaTransaction, requestSolanaWallet } from '../solanaTransactionConfirmation';
import { reconcilePendingSubmission, signAndSendLegacyTransaction, signLegacyTransactionBatch } from '../solanaCapsuleService';

test('real web3 Connection confirms through an HTTP-only proxy without a WebSocket', async () => {
  let statusReads = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.method, 'getSignatureStatuses');
    statusReads += 1;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { context: { slot: 100 }, value: [
      { slot: 99, confirmations: 2, err: null, confirmationStatus: statusReads === 1 ? 'processed' : 'confirmed' },
    ] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const endpoint = server.address() as { port: number };
    const connection = new Connection(`http://127.0.0.1:${endpoint.port}/api/solana-devnet-rpc`);
    connection.confirmTransaction = async () => { throw new Error('WebSocket confirmation must not be used'); };
    const result = await confirmSolanaTransaction(connection, '1'.repeat(64), { timeoutMs: 1_000, pollIntervalMs: 1 });
    assert.equal(result.value.err, null);
    assert.equal(result.context.slot, 100);
    assert.equal(statusReads, 2);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('an RPC read failure does not lose a later confirmed signature', async () => {
  let reads = 0;
  const connection = { async getSignatureStatuses() {
    if (++reads === 1) throw new Error('temporary HTTP 504');
    return { context: { slot: 10 }, value: [{ err: null, confirmationStatus: 'confirmed' }] };
  } } as unknown as Connection;
  assert.equal((await confirmSolanaTransaction(connection, 'signature', { pollIntervalMs: 1 })).value.err, null);
  assert.equal(reads, 2);
});

test('a merely processed error waits for confirmed commitment before reporting failure', async () => {
  let reads = 0;
  const error = { InstructionError: [0, 'Custom'] };
  const connection = { async getSignatureStatuses() {
    return { context: { slot: 10 }, value: [{ err: error, confirmationStatus: ++reads === 1 ? 'processed' : 'confirmed' }] };
  } } as unknown as Connection;
  const result = await confirmSolanaTransaction(connection, 'signature', { pollIntervalMs: 1 });
  assert.deepEqual(result.value.err, error);
  assert.equal(reads, 2);
});

test('an outstanding wallet request cannot be replaced, and its late result is retained', async () => {
  const provider = {};
  let finish!: (value: string) => void;
  const first = requestSolanaWallet(provider, () => new Promise<string>((resolve) => { finish = resolve; }));
  await assert.rejects(() => requestSolanaWallet(provider, async () => 'duplicate'), /already open/);
  finish('late signed result');
  assert.equal(await first, 'late signed result');
  assert.equal(await requestSolanaWallet(provider, async () => 'next request'), 'next request');
});

test('durable nonce submissions never expire just because an RPC has not indexed their signature', async () => {
  for (const pendingLastValidBlockHeight of [0, Number.MAX_SAFE_INTEGER]) {
    const draft = { pendingSignature: 'pending', pendingLastValidBlockHeight } as any;
    const connection = { async getSignatureStatuses() { return { value: [null] }; },
      async getBlockHeight() { throw new Error('a durable nonce has no block-height expiry'); } } as unknown as Connection;
    await assert.rejects(() => reconcilePendingSubmission(connection, draft), /No new wallet request/);
    assert.equal(draft.pendingSignature, 'pending');
  }
});

test('a wallet must not move nonce advancement behind Compute Budget instructions', async () => {
  const signer = Keypair.generate();
  let broadcasts = 0;
  const provider = { publicKey: signer.publicKey, async signTransaction(transaction: Transaction) {
    transaction.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
    transaction.partialSign(signer);
    return transaction;
  } } as any;
  const connection = { async sendRawTransaction() { broadcasts += 1; throw new Error('unexpected broadcast'); } } as unknown as Connection;
  await assert.rejects(() => signAndSendLegacyTransaction(connection, provider, signer.publicKey.toBase58(),
    SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: signer.publicKey, lamports: 0 }),
    undefined, undefined, undefined,
    { account: Keypair.generate().publicKey, value: Keypair.generate().publicKey.toBase58(), contextSlot: 10 }),
  /durable nonce advance instruction changed or moved/);
  assert.equal(broadcasts, 0);
});

function batchFixture(tamper = false, refreshHash = false) {
  const signer = Keypair.generate();
  const owner = signer.publicKey;
  const blockhash = Keypair.generate().publicKey.toBase58();
  let walletRequests = 0;
  const connection = {
    async getLatestBlockhashAndContext() { return { context: { slot: 10 }, value: { blockhash, lastValidBlockHeight: 250 } }; },
    async getBlockHeight() { return 100; },
    async sendRawTransaction() { throw new Error('the complete signing batch must be verified before broadcast'); },
  } as unknown as Connection;
  const provider = { publicKey: owner, async signAllTransactions(transactions: Transaction[]) {
    walletRequests += 1;
    if (tamper) transactions[1].instructions[2].data[4] ^= 1;
    if (refreshHash) {
      const refreshed = Keypair.generate().publicKey.toBase58();
      for (const transaction of transactions) transaction.recentBlockhash = refreshed;
    }
    for (const transaction of transactions) transaction.partialSign(signer);
    return transactions;
  } } as any;
  const instructionSets = [0, 1].map((lamports) => [SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports })]);
  return { owner, connection, provider, instructionSets, walletRequests: () => walletRequests };
}

test('two short-record transactions require one wallet request and both signatures are verified', async () => {
  const fixture = batchFixture();
  const result = await signLegacyTransactionBatch(fixture.connection, fixture.provider, fixture.owner.toBase58(), fixture.instructionSets);
  assert.equal(fixture.walletRequests(), 1);
  assert.equal(result.signed.length, 2);
  for (const signed of result.signed) assert.equal(Transaction.from(signed.bytes).verifySignatures(), true);
});

test('a changed second transaction rejects the whole signing batch before any broadcast', async () => {
  const fixture = batchFixture(true);
  await assert.rejects(() => signLegacyTransactionBatch(fixture.connection, fixture.provider, fixture.owner.toBase58(), fixture.instructionSets), /application instruction changed/);
});

test('wallet-refreshed batch hashes do not inherit the originally fetched expiry height', async () => {
  const fixture = batchFixture(false, true);
  const result = await signLegacyTransactionBatch(fixture.connection, fixture.provider, fixture.owner.toBase58(), fixture.instructionSets);
  assert.equal(result.signed.length, 2);
  for (const signed of result.signed) {
    assert.equal(signed.lifetime, undefined);
    assert.ok(signed.refreshedBlockhash);
    assert.equal(Transaction.from(signed.bytes).recentBlockhash, signed.refreshedBlockhash);
  }
});

test('resume checks a refreshed hash and re-reads its signature before declaring expiry', async () => {
  const draft = { pendingSignature: 'pending', pendingLastValidBlockHeight: Number.MAX_SAFE_INTEGER,
    pendingBlockhash: 'wallet-refreshed-hash', pendingPhase: 'payload' } as any;
  let reads = 0;
  let valid = true;
  const connection = {
    async getSignatureStatuses() { return { value: [++reads === 1 ? null : { confirmationStatus: 'confirmed', err: null }] }; },
    async isBlockhashValid(hash: string) { assert.equal(hash, 'wallet-refreshed-hash'); return { value: valid }; },
    async getBlockHeight() { throw new Error('the old hash expiry height must not be used'); },
  } as unknown as Connection;
  await assert.rejects(() => reconcilePendingSubmission(connection, draft), /No new wallet request/);
  assert.equal(draft.pendingSignature, 'pending');
  valid = false;
  reads = 0;
  assert.equal(await reconcilePendingSubmission(connection, draft), 'confirmed');
  assert.equal(draft.pendingSignature, undefined);
  assert.equal(draft.pendingBlockhash, undefined);
});
