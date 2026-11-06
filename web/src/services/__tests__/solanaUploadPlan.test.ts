import assert from 'node:assert/strict';
import test from 'node:test';
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { planAtomicV1Upload, planLegacyUpload, SOLANA_PROGRAM_ID } from '../solanaCapsuleService';
import { deriveSolanaFeePolicyPda, encodeSolanaFinalizeFeeArgs, SOL_PRICE_ACCOUNT, USDC_PRICE_ACCOUNT, type SolanaProtocolFeeReview } from '../solanaProtocolFee';

const owner = new PublicKey('C3oF3qoFTqiR9CEL2mmn9NFpXdHnAvKPaF6PYhS6STZS');
const capsule = new PublicKey('5tHcLyNM2Q2DiL9btNSWjxYuyvdftqFxeEtvj9nzj7ae');
const feeReview: SolanaProtocolFeeReview = { mode: 'usdc-equivalent-sol', policyRevision: 1n,
  feeRecipient: owner.toBase58(), targetUsdcMicros: 10n, protocolFeeLamports: 100n,
  maxProtocolFeeLamports: 101n, validUntil: 1_900_000_000, localExpiresAt: 1_900_000_000, maxPriceAgeSeconds: 600 };

test('a short V1 capsule begins, writes, and finalizes atomically, while oversized records keep chunking', async () => {
  const common = { owner, capsule, feeRecipient: owner, capsuleId: '7', unlockAt: 1_900_000_000,
    mode: 'private' as const, payloadHash: new Uint8Array(32), title: new Uint8Array() };
  const short = await planAtomicV1Upload({ ...common, payload: new Uint8Array(1_184) });
  assert.equal(short?.length, 3);
  assert.equal(await planAtomicV1Upload({ ...common, payload: new Uint8Array(65_536) }), null);
  assert.equal(await planAtomicV1Upload({ ...common, mode: 'public', payload: new Uint8Array(3_800), title: new Uint8Array(2_048) }), null);
});

function wireSize(
  instructions: Awaited<ReturnType<typeof planLegacyUpload>>[number]['instructions'],
  nonceAdvance?: ReturnType<typeof SystemProgram.nonceAdvance>,
  prefix: ReturnType<typeof SystemProgram.createNonceAccount>['instructions'] = [],
): number {
  const tx = new Transaction({ feePayer: owner, recentBlockhash: SOLANA_PROGRAM_ID }).add(
    ...(nonceAdvance ? [nonceAdvance] : []),
    ...prefix,
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 70_000 }),
    ...instructions,
  );
  return tx.serializeMessage().length + 65;
}

test('legacy planner combines a 2,336-byte synthetic payload and title into fewer wallet approvals', async () => {
  const payload = new Uint8Array(2_336);
  const title = new Uint8Array(38).fill(65);
  const common = {
    owner, capsule, feeRecipient: owner, capsuleId: '1', unlockAt: 1_900_000_000,
    mode: 'public' as const, payload, payloadHash: new Uint8Array(32), title,
    maxChunkBytes: 1_012,
  };
  const batches = await planLegacyUpload({ ...common, includeBegin: true, payloadOffset: 0, titleOffset: 0 });
  assert.equal(batches.length, 3);
  assert.equal(batches.at(-1)?.payloadEnd, payload.length);
  assert.equal(batches.at(-1)?.titleEnd, title.length);
  for (const batch of batches) {
    const size = wireSize(batch.instructions);
    assert.ok(size <= 1_232);
  }

  const resumed = await planLegacyUpload({ ...common, includeBegin: false, payloadOffset: batches[0].payloadEnd, titleOffset: batches[0].titleEnd });
  assert.equal(resumed.at(-1)?.payloadEnd, payload.length);
  assert.equal(resumed.at(-1)?.titleEnd, title.length);
  for (const batch of resumed) assert.ok(wireSize(batch.instructions) <= 1_232);
});

test('durable nonce instruction is first and reserved in every packed legacy capsule transaction', async () => {
  const nonceAccount = await PublicKey.createWithSeed(owner, 'timecapsule-devnet-nonce-v1', SystemProgram.programId);
  const advance = SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner });
  const batches = await planLegacyUpload({
    owner, capsule, feeRecipient: owner, capsuleId: '3', unlockAt: 1_900_000_000,
    mode: 'public', payload: new Uint8Array(2_336), payloadHash: new Uint8Array(32),
    title: new Uint8Array(38).fill(65), includeBegin: true, payloadOffset: 0, titleOffset: 0,
    maxChunkBytes: 1_050, nonceAdvanceInstruction: advance,
  });
  assert.equal(batches.length, 3);
  for (const batch of batches) {
    assert.ok(wireSize(batch.instructions, advance) <= 1_232);
    assert.ok(batch.instructions.length > 0);
  }
});

test('standalone nonce bootstrap stays separate from Capsule transaction planning', async () => {
  const nonceAccount = await PublicKey.createWithSeed(owner, 'timecapsule-devnet-nonce-v1', SystemProgram.programId);
  const advance = SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner });
  const setup = SystemProgram.createNonceAccount({
    fromPubkey: owner, noncePubkey: nonceAccount, basePubkey: owner,
    seed: 'timecapsule-devnet-nonce-v1', lamports: 1_056_640, authorizedPubkey: owner,
  });
  const batches = await planLegacyUpload({
    owner, capsule, feeRecipient: owner, capsuleId: '5', unlockAt: 1_900_000_000,
    mode: 'public', payload: new Uint8Array(996), payloadHash: new Uint8Array(32),
    title: new Uint8Array(18).fill(65), includeBegin: true, payloadOffset: 0, titleOffset: 0,
    maxChunkBytes: 854, nonceAdvanceInstruction: advance,
  });
  assert.equal(batches.length, 2);
  assert.equal(batches.at(-1)?.payloadEnd, 996);
  assert.equal(batches.at(-1)?.titleEnd, 18);
  for (const batch of batches) assert.ok(wireSize(batch.instructions, advance) <= 1_232);
  assert.ok(wireSize(setup.instructions) <= 1_232);
});

test('legacy planner keeps a maximum-size payload within each wire limit', async () => {
  const batches = await planLegacyUpload({
    owner, capsule, feeRecipient: owner, capsuleId: '2', unlockAt: 1_900_000_000,
    mode: 'private', payload: new Uint8Array(65_536), payloadHash: new Uint8Array(32),
    title: new Uint8Array(), includeBegin: true, payloadOffset: 0, titleOffset: 0,
    maxChunkBytes: 1_012,
  });
  assert.equal(batches.length, 69);
  assert.equal(batches.at(-1)?.payloadEnd, 65_536);
  for (const batch of batches) assert.ok(wireSize(batch.instructions) <= 1_232);
});

test('durable nonce wire reservation keeps a maximum encrypted payload within packet limit', async () => {
  const nonceAccount = await PublicKey.createWithSeed(owner, 'timecapsule-devnet-nonce-v1', SystemProgram.programId);
  const advance = SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner });
  const batches = await planLegacyUpload({
    owner, capsule, feeRecipient: owner, capsuleId: '4', unlockAt: 1_900_000_000,
    mode: 'private', payload: new Uint8Array(65_536), payloadHash: new Uint8Array(32),
    title: new Uint8Array(), includeBegin: true, payloadOffset: 0, titleOffset: 0,
    maxChunkBytes: 1_050, nonceAdvanceInstruction: advance,
  });
  assert.equal(batches.at(-1)?.payloadEnd, 65_536);
  for (const batch of batches) assert.ok(wireSize(batch.instructions, advance) <= 1_232);
});

test('dynamic SOL pricing is packed into finalization without a separate payment transaction', async () => {
  for (const size of [32, 1_184, 2_336, 65_536]) {
    const batches = await planLegacyUpload({ owner, capsule, feeRecipient: owner,
      capsuleId: '10', unlockAt: 1_900_000_000, mode: 'private', payload: new Uint8Array(size),
      payloadHash: new Uint8Array(32), title: new Uint8Array(), includeBegin: true,
      payloadOffset: 0, titleOffset: 0, maxChunkBytes: 1_012, feeReview });
    for (const batch of batches) assert.ok(wireSize(batch.instructions) <= 1_232);
    const finalize = batches.at(-1)!.instructions.at(-1)!;
    assert.equal(finalize.keys.length, 8);
    assert.deepEqual(finalize.keys.slice(5).map((key) => key.pubkey.toBase58()),
      [deriveSolanaFeePolicyPda().toBase58(), SOL_PRICE_ACCOUNT, USDC_PRICE_ACCOUNT]);
    assert.ok(finalize.keys.slice(5).every((key) => !key.isSigner && !key.isWritable));
    assert.deepEqual(new Uint8Array(finalize.data.subarray(8)), encodeSolanaFinalizeFeeArgs(feeReview));
    assert.equal(batches.at(-1)!.payloadEnd, size);
    if (size <= 2_336) assert.ok(batches.length <= 4, 'short records fit a single signing batch');
  }
  const atomic = await planAtomicV1Upload({ owner, capsule, feeRecipient: owner, capsuleId: '11',
    unlockAt: 1_900_000_000, mode: 'private', payload: new Uint8Array(1_184),
    payloadHash: new Uint8Array(32), title: new Uint8Array(), feeReview });
  assert.equal(atomic!.length, 3);
  assert.deepEqual(new Uint8Array(atomic!.at(-1)!.data.subarray(8)), encodeSolanaFinalizeFeeArgs(feeReview));
});
