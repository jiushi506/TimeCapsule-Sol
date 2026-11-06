import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PublicKey } from '@solana/web3.js';
import {
  assertSolanaFeeReview, calculateUsdcFeeLamports, createSolanaProtocolFeeReview,
  decodeSolanaFeePolicy, decodeSolanaOraclePrice,
  encodeSolanaFinalizeFeeArgs, FEE_POLICY_DISCRIMINATOR, formatUsdcMicros,
  PYTH_RECEIVER, SOL_FEED_ID, USDC_FEED_ID, type SolanaFeePolicy,
  SOLANA_FEE_ERROR_MESSAGES,
} from '../solanaProtocolFee';
import { deriveSolanaCapsulePda, formatSolanaError, SOLANA_PROGRAM_ID, submitSolanaCapsule, type SolanaSealQuote } from '../solanaCapsuleService';

const policy: SolanaFeePolicy = { mode: 'usdc-equivalent-sol', revision: 1n, targetUsdcMicros: 10n,
  maxPriceAgeSeconds: 120, maxConfidenceBps: 100, maxPriceSkewSeconds: 120 };
const now = 1_800_000_000;
function priceBytes(feed: string, price: bigint, exponent = -8, time = now - 5) {
  const bytes = new Uint8Array(134), data = new DataView(bytes.buffer);
  bytes.set([34, 241, 35, 99, 157, 126, 244, 205]); bytes[40] = 1;
  bytes.set(Uint8Array.from(feed.match(/../g)!.map((part) => parseInt(part, 16))), 41);
  data.setBigInt64(73, price, true); data.setBigUint64(81, 1n, true);
  data.setInt32(89, exponent, true); data.setBigInt64(93, BigInt(time), true);
  return bytes;
}
const account = (bytes: Uint8Array) => ({ data: bytes, executable: false, owner: new PublicKey(PYTH_RECEIVER), lamports: 1 });
function review(params: Partial<Parameters<typeof createSolanaProtocolFeeReview>[0]> = {}) {
  return createSolanaProtocolFeeReview({ policy, fixedLamports: 123n,
    feeRecipient: new PublicKey(new Uint8Array(32).fill(2)).toBase58(), now,
    solAccount: account(priceBytes(SOL_FEED_ID, 10_000_000_000n)),
    usdcAccount: account(priceBytes(USDC_FEED_ID, 100_000_000n)), ...params });
}

test('testnet and mainnet amounts use the USDC/SOL ratio with integer rounding', () => {
  const sol = { price: 10483372560n, exponent: -8, publishTime: now };
  const usdc = { price: 99991634n, exponent: -8, publishTime: now };
  assert.equal(calculateUsdcFeeLamports(10n, sol, usdc, 120), 96n);
  assert.equal(calculateUsdcFeeLamports(1_000_000n, sol, usdc, 120), 9_538_117n);
  assert.equal(calculateUsdcFeeLamports(1_000_000n, { ...sol, price: 10_000_000_000n }, { ...usdc, price: 1n, exponent: 0 }, 120), 10_000_000n);
  assert.equal(formatUsdcMicros(10n), '0.00001');
  assert.equal(formatUsdcMicros(1_000_000n), '1');
});

test('fully verified correct account layouts are required', () => {
  const good = priceBytes(SOL_FEED_ID, 10_000_000_000n);
  assert.equal(decodeSolanaOraclePrice(good, SOL_FEED_ID, policy, now).price, 10_000_000_000n);
  for (const length of [0, 40, 100, 133]) assert.throws(() => decodeSolanaOraclePrice(good.slice(0, length), SOL_FEED_ID, policy, now));
  for (const index of [0, 40, 41]) { const bad = good.slice(); bad[index] ^= 1; assert.throws(() => decodeSolanaOraclePrice(bad, SOL_FEED_ID, policy, now)); }
  assert.throws(() => review({ solAccount: { ...account(good), owner: new PublicKey(new Uint8Array(32)) } }), /trusted/);
  assert.throws(() => review({ solAccount: { ...account(good), executable: true } }), /trusted/);
});

test('stale, future, uncertain, nonpositive and unsupported exponent prices stop before signing', () => {
  assert.throws(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, 1n, -8, now - 121), SOL_FEED_ID, policy, now), /out of date/);
  assert.doesNotThrow(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, 10_000n, -8, now - 120), SOL_FEED_ID, policy, now));
  assert.throws(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, 1n, -8, now + 6), SOL_FEED_ID, policy, now), /future/);
  assert.doesNotThrow(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, 10_000n, -8, now + 5), SOL_FEED_ID, policy, now));
  assert.throws(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, 1n), SOL_FEED_ID, policy, now), /confidence/);
  for (const value of [0n, -1n]) assert.throws(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, value), SOL_FEED_ID, policy, now), /invalid/);
  for (const exponent of [-13, 1]) assert.throws(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, 10_000n, exponent), SOL_FEED_ID, policy, now), /invalid/);
  assert.doesNotThrow(() => decodeSolanaOraclePrice(priceBytes(SOL_FEED_ID, 10_000n, -8, now - 300), SOL_FEED_ID, { ...policy, maxPriceAgeSeconds: 600 }, now));
});

test('mismatched update times and chain integer overflows are rejected', () => {
  const sol = { price: 1n, exponent: -12, publishTime: now };
  const usdc = { price: (1n << 63n) - 1n, exponent: 0, publishTime: now };
  assert.throws(() => calculateUsdcFeeLamports(1_000_000_000_000n, sol, usdc, 120), /overflow/);
  assert.throws(() => calculateUsdcFeeLamports(1n, sol, { ...usdc, publishTime: now - 121 }, 120), /far apart/);
  assert.throws(() => calculateUsdcFeeLamports(0n, sol, usdc, 120), /invalid/);
});

test('fixed SOL mode works without live prices and signed caps stay separate from estimates', () => {
  const fixed = review({ policy: { ...policy, mode: 'fixed-sol' }, solAccount: null, usdcAccount: null });
  assert.equal(fixed.protocolFeeLamports, 123n);
  assert.equal(fixed.maxProtocolFeeLamports, 123n);
  assert.equal(fixed.targetUsdcMicros, 0n);
  assert.equal(review().protocolFeeLamports, 100n);
  assert.equal(review().maxProtocolFeeLamports, 101n);
});

test('review refresh checks recipient, policy, expiry and signed SOL cap', () => {
  const original = review();
  assert.doesNotThrow(() => assertSolanaFeeReview({ ...original, protocolFeeLamports: 101n }, original, now));
  assert.throws(() => assertSolanaFeeReview({ ...original, protocolFeeLamports: 102n }, original, now), /limit/);
  assert.throws(() => assertSolanaFeeReview({ ...original, policyRevision: 2n }, original, now), /policy/);
  assert.throws(() => assertSolanaFeeReview({ ...original, feeRecipient: 'other' }, original, now), /recipient/);
  assert.throws(() => assertSolanaFeeReview(original, original, now + 601), /expired/);
  const bytes = encodeSolanaFinalizeFeeArgs(original), data = new DataView(bytes.buffer);
  assert.equal(bytes.length, 24); assert.equal(data.getBigUint64(0, true), 101n);
  assert.equal(data.getBigUint64(8, true), 1n); assert.equal(data.getBigInt64(16, true), BigInt(now + 600));
  assert.throws(() => encodeSolanaFinalizeFeeArgs({ ...original, maxProtocolFeeLamports: -1n }), /invalid/);
});

test('fee policy decoding matches the new 36-byte Anchor layout', () => {
  const bytes = new Uint8Array(36), data = new DataView(bytes.buffer);
  bytes.set(FEE_POLICY_DISCRIMINATOR); bytes[8] = 1; bytes[9] = 1;
  data.setBigUint64(10, 1n, true); data.setBigUint64(18, 10n, true); data.setUint32(26, 120, true);
  data.setUint16(30, 100, true); data.setUint32(32, 120, true);
  assert.deepEqual(decodeSolanaFeePolicy(bytes), policy);
  for (const index of [0, 8, 9, 10, 18, 26, 30, 32]) {
    const bad = bytes.slice(); bad[index] = index === 9 ? 2 : 0;
    assert.throws(() => decodeSolanaFeePolicy(bad));
  }
});

test('browser clock offsets do not change the signed chain deadline', () => {
  const result = review({ now, localNow: now + 3_600 });
  assert.equal(result.validUntil, now + 600);
  assert.equal(result.localExpiresAt, now + 4_200);
  assert.throws(() => assertSolanaFeeReview(result, result, now + 601), /expired/);
});

test('a wallet change invalidates the reviewed capsule before a wallet or RPC request', async () => {
  const original = new PublicKey(new Uint8Array(32).fill(2)), switched = new PublicKey(new Uint8Array(32).fill(3));
  let requests = 0;
  await assert.rejects(() => submitSolanaCapsule({ owner: switched.toBase58(),
    provider: { isPhantom: true, isConnected: true, publicKey: switched,
      async connect() { requests += 1; return { publicKey: switched }; } },
    quote: { capsuleId: '7', capsulePda: deriveSolanaCapsulePda(original.toBase58(), '7').toBase58() } as SolanaSealQuote,
    mode: 'public', unlockAt: now + 600, publicTitle: 'Synthetic test', payloadBytes: new Uint8Array(), payloadHash: '0x' }), /wallet changed/);
  assert.equal(requests, 0);
});

test('program fee error mappings match generated IDL and give actionable messages', () => {
  const idl = JSON.parse(readFileSync(new URL('../../../../idl/time_capsule.json', import.meta.url), 'utf8'));
  const expected = ['StaleOraclePrice', 'UncertainOraclePrice', 'OraclePriceSkew', 'FeePolicyChanged', 'FeeQuoteExpired', 'ProtocolFeeCapExceeded'];
  for (const [index, [code, message]] of Object.entries(SOLANA_FEE_ERROR_MESSAGES).entries()) {
    assert.equal(idl.errors.find((error: { code: number }) => error.code === Number(code)).name, expected[index]);
    assert.equal(formatSolanaError(new Error(`Solana transaction failed: {"InstructionError":[0,{"Custom":${code}}]}`), 'fallback'), message);
    assert.equal(formatSolanaError(new Error(`custom program error: 0x${Number(code).toString(16)}`), 'fallback'), message);
  }
});