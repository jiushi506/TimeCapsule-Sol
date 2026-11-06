import { PublicKey, type AccountInfo } from '@solana/web3.js';
import { SOLANA_PROGRAM_ID } from '../contracts/solanaConfig';

export const PYTH_RECEIVER = 'rec2HHDDnjLfj4kE7VyEtFA1HPGQLK33259532cRyHp';
export const SOL_PRICE_ACCOUNT = '7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE';
export const USDC_PRICE_ACCOUNT = '6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT';
export const SOL_FEED_ID = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
export const USDC_FEED_ID = 'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a';
export const FEE_POLICY_DISCRIMINATOR = Uint8Array.from([98, 183, 86, 160, 232, 222, 82, 45]);
const PRICE_DISCRIMINATOR = Uint8Array.from([34, 241, 35, 99, 157, 126, 244, 205]);
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const MAX_ORACLE_FUTURE_SECONDS = 5;
/** Program error numbers are checked against the generated IDL in fee tests. */
export const SOLANA_FEE_ERROR_MESSAGES: Record<number, string> = {
  6037: 'The price feed is temporarily out of date. Refresh the fee quote before signing again.',
  6038: 'The current price is outside the configured confidence limits. Try again when a valid quote is available.',
  6039: 'The price feed timestamps differ beyond the fee policy limits. Refresh the fee quote.',
  6040: 'The fee policy changed. Reopen the cost review before signing again.',
  6041: 'The fee review expired. Refresh the quote before signing again.',
  6042: 'The current protocol fee exceeds the signed SOL limit. Refresh the quote before signing again.',
};

export interface SolanaFeePolicy {
  mode: 'fixed-sol' | 'usdc-equivalent-sol';
  revision: bigint;
  targetUsdcMicros: bigint;
  maxPriceAgeSeconds: number;
  maxConfidenceBps: number;
  maxPriceSkewSeconds: number;
}

export interface SolanaProtocolFeeReview {
  mode: SolanaFeePolicy['mode'];
  policyRevision: bigint;
  feeRecipient: string;
  targetUsdcMicros: bigint;
  protocolFeeLamports: bigint;
  maxProtocolFeeLamports: bigint;
  validUntil: number;
  localExpiresAt: number;
  solPublishTime?: number;
  usdcPublishTime?: number;
  maxPriceAgeSeconds: number;
}

export interface SolanaOraclePrice {
  price: bigint;
  exponent: number;
  publishTime: number;
}

export function deriveSolanaFeePolicyPda(programId = SOLANA_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([new TextEncoder().encode('fee-policy-v1')], new PublicKey(programId))[0];
}

function hasPrefix(bytes: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

export function decodeSolanaFeePolicy(bytes: Uint8Array): SolanaFeePolicy {
  if (bytes.length !== 36 || !hasPrefix(bytes, FEE_POLICY_DISCRIMINATOR) || bytes[8] !== 1 || bytes[9] > 1) {
    throw new Error('Fee policy does not match the supported on-chain layout.');
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const policy: SolanaFeePolicy = {
    mode: bytes[9] === 0 ? 'fixed-sol' : 'usdc-equivalent-sol',
    revision: data.getBigUint64(10, true), targetUsdcMicros: data.getBigUint64(18, true),
    maxPriceAgeSeconds: data.getUint32(26, true), maxConfidenceBps: data.getUint16(30, true),
    maxPriceSkewSeconds: data.getUint32(32, true),
  };
  if (policy.revision === 0n || policy.targetUsdcMicros > 1_000_000_000_000n ||
      (policy.mode === 'usdc-equivalent-sol' && policy.targetUsdcMicros === 0n) ||
      policy.maxPriceAgeSeconds < 1 || policy.maxPriceAgeSeconds > 3_600 ||
      policy.maxConfidenceBps < 1 || policy.maxConfidenceBps > 1_000 ||
      policy.maxPriceSkewSeconds < 1 || policy.maxPriceSkewSeconds > policy.maxPriceAgeSeconds) {
    throw new Error('Fee policy contains invalid pricing settings.');
  }
  return policy;
}

export function decodeSolanaOraclePrice(bytes: Uint8Array, feedId: string, policy: SolanaFeePolicy, now: number): SolanaOraclePrice {
  if (bytes.length !== 134 || !hasPrefix(bytes, PRICE_DISCRIMINATOR)) throw new Error('The price account layout is invalid.');
  if (bytes[40] !== 1) throw new Error('The price update is not fully verified.');
  const actualFeed = [...bytes.subarray(41, 73)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (actualFeed !== feedId) throw new Error('The oracle price feed does not match.');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const price = data.getBigInt64(73, true), confidence = data.getBigUint64(81, true);
  const exponent = data.getInt32(89, true), publishTime = Number(data.getBigInt64(93, true));
  if (price <= 0n || exponent < -12 || exponent > 0) throw new Error('The oracle price or exponent is invalid.');
  if (!Number.isSafeInteger(publishTime) || publishTime <= 0 || publishTime > now + MAX_ORACLE_FUTURE_SECONDS) throw new Error('The oracle price timestamp is invalid or too far in the future.');
  if (now - publishTime > policy.maxPriceAgeSeconds) throw new Error('The price feed is temporarily out of date. Refresh the fee quote before signing.');
  if (confidence * 10_000n > price * BigInt(policy.maxConfidenceBps)) throw new Error('The price confidence interval exceeds the fee policy limit.');
  return { price, exponent, publishTime };
}

export function calculateUsdcFeeLamports(targetUsdcMicros: bigint, sol: SolanaOraclePrice, usdc: SolanaOraclePrice, maxSkewSeconds: number): bigint {
  if (targetUsdcMicros <= 0n || targetUsdcMicros > 1_000_000_000_000n ||
      [sol, usdc].some((value) => value.price <= 0n || value.price > (1n << 63n) - 1n || !Number.isInteger(value.exponent) || value.exponent < -12 || value.exponent > 0)) {
    throw new Error('The fee calculation inputs are invalid.');
  }
  if (Math.abs(sol.publishTime - usdc.publishTime) > maxSkewSeconds) throw new Error('The two price feeds were updated too far apart. Refresh the fee quote.');
  const exponent = Math.min(sol.exponent, usdc.exponent);
  const normalized = (value: SolanaOraclePrice) => value.price * 10n ** BigInt(value.exponent - exponent);
  const numerator = targetUsdcMicros * 1_000_000_000n * normalized(usdc);
  const denominator = 1_000_000n * normalized(sol);
  if (numerator > U128_MAX || denominator > U128_MAX) throw new Error('The fee calculation overflowed.');
  const amount = (numerator + denominator - 1n) / denominator;
  if (amount > U64_MAX) throw new Error('The protocol fee exceeds the supported SOL amount.');
  return amount;
}

function checkedOracle(account: AccountInfo<Uint8Array> | null, feedId: string, policy: SolanaFeePolicy, now: number) {
  if (!account || account.executable || account.owner.toBase58() !== PYTH_RECEIVER) throw new Error('The price account is not owned by the trusted oracle program.');
  return decodeSolanaOraclePrice(account.data, feedId, policy, now);
}

export function createSolanaProtocolFeeReview(params: {
  policy: SolanaFeePolicy; fixedLamports: bigint; feeRecipient: string; now: number; localNow?: number;
  solAccount: AccountInfo<Uint8Array> | null; usdcAccount: AccountInfo<Uint8Array> | null;
}): SolanaProtocolFeeReview {
  const { policy, now } = params;
  const sol = policy.mode === 'usdc-equivalent-sol' ? checkedOracle(params.solAccount, SOL_FEED_ID, policy, now) : undefined;
  const usdc = policy.mode === 'usdc-equivalent-sol' ? checkedOracle(params.usdcAccount, USDC_FEED_ID, policy, now) : undefined;
  const protocolFeeLamports = sol && usdc
    ? calculateUsdcFeeLamports(policy.targetUsdcMicros, sol, usdc, policy.maxPriceSkewSeconds) : params.fixedLamports;
  if (protocolFeeLamports < 0n || protocolFeeLamports > U64_MAX) throw new Error('The fixed SOL fee is invalid.');
  // 1% maximum movement, rounded to a lamport. Only the current calculated
  // amount is charged, never the full cap unless that is the calculated price.
  const cap = policy.mode === 'usdc-equivalent-sol' ? (protocolFeeLamports * 101n + 99n) / 100n : protocolFeeLamports;
  return { mode: policy.mode, policyRevision: policy.revision, feeRecipient: params.feeRecipient,
    targetUsdcMicros: policy.mode === 'usdc-equivalent-sol' ? policy.targetUsdcMicros : 0n,
    protocolFeeLamports, maxProtocolFeeLamports: cap > U64_MAX ? U64_MAX : cap,
    validUntil: now + 600, localExpiresAt: (params.localNow ?? now) + 600,
    solPublishTime: sol?.publishTime, usdcPublishTime: usdc?.publishTime,
    maxPriceAgeSeconds: policy.maxPriceAgeSeconds };
}

export function assertSolanaFeeReview(current: SolanaProtocolFeeReview, reviewed: SolanaProtocolFeeReview, now: number): void {
  if (current.policyRevision !== reviewed.policyRevision || current.feeRecipient !== reviewed.feeRecipient ||
      current.mode !== reviewed.mode || current.targetUsdcMicros !== reviewed.targetUsdcMicros) {
    throw new Error('The fee policy or recipient changed. Reopen the cost review before signing.');
  }
  if (reviewed.validUntil < now) throw new Error('The fee review expired. Refresh the fee quote before signing.');
  if (current.protocolFeeLamports > reviewed.maxProtocolFeeLamports) throw new Error('The current protocol fee exceeds the reviewed SOL limit. Refresh the fee quote before signing.');
}

export function encodeSolanaFinalizeFeeArgs(review: SolanaProtocolFeeReview): Uint8Array {
  if (review.maxProtocolFeeLamports < 0n || review.maxProtocolFeeLamports > U64_MAX ||
      review.policyRevision < 1n || review.policyRevision > U64_MAX ||
      !Number.isSafeInteger(review.validUntil) || review.validUntil <= 0) {
    throw new Error('The signed fee limits are invalid. Refresh the fee review.');
  }
  const bytes = new Uint8Array(24), data = new DataView(bytes.buffer);
  data.setBigUint64(0, review.maxProtocolFeeLamports, true);
  data.setBigUint64(8, review.policyRevision, true);
  data.setBigInt64(16, BigInt(review.validUntil), true);
  return bytes;
}

export function formatUsdcMicros(micros: bigint): string {
  const fraction = (micros % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${micros / 1_000_000n}${fraction ? `.${fraction}` : ''}`;
}
