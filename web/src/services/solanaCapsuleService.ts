import {
  Connection,
  ComputeBudgetProgram,
  Message,
  NONCE_ACCOUNT_LENGTH,
  NonceAccount,
  PublicKey,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type Commitment,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
if (typeof globalThis !== 'undefined' && !(globalThis as unknown as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  estimateResourceLimitsFactory,
  getTransactionEncoder,
  getBase58Encoder,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { SolanaSignTransaction, type SolanaSignTransactionInput, type SolanaSignTransactionOutput } from '@solana/wallet-standard-features';
import type { CapsuleMode } from '../codec';
import { getPhantomSolanaProvider, type PhantomSolanaProvider } from '../context/solanaWalletUtils';
import { confirmSolanaTransaction, requestSolanaWallet } from './solanaTransactionConfirmation';
import {
  assertSolanaFeeReview, createSolanaProtocolFeeReview, decodeSolanaFeePolicy,
  deriveSolanaFeePolicyPda, encodeSolanaFinalizeFeeArgs, SOL_PRICE_ACCOUNT, USDC_PRICE_ACCOUNT,
  SOLANA_FEE_ERROR_MESSAGES,
  type SolanaProtocolFeeReview,
} from './solanaProtocolFee';

import { SOLANA_DEVNET_GENESIS_HASH, SOLANA_PROGRAM_ID } from '../contracts/solanaConfig';
export { SOLANA_DEVNET_GENESIS_HASH, SOLANA_PROGRAM_ID } from '../contracts/solanaConfig';
import { resolveSolanaRpcUrl, solanaRpcFetch } from './solanaRpcConfig';
export { resolveSolanaRpcUrl, SOLANA_DEVNET_RPC_URL } from './solanaRpcConfig';
export const SOLANA_MAX_PAYLOAD_SIZE = 65_536;
export const SOLANA_MAX_TITLE_BYTES = 2_048;
export const SOLANA_MAX_TITLE_CHARACTERS = 512;
export const SOLANA_ACCOUNT_FIXED_SPACE = 137;
// The deployed Devnet program runs with the default 32 KiB heap. Larger records
// can fail after the storage deposit is paid, so reject them before any review.
export const SOLANA_SAFE_RECORD_BYTES = 8 * 1024;
function assertSolanaSafeRecordSize(payloadBytes: number, titleBytes: number): void {
  if (payloadBytes + titleBytes > SOLANA_SAFE_RECORD_BYTES) {
    throw new Error(`This Solana memory is ${(payloadBytes + titleBytes).toLocaleString()} encrypted bytes; the current Solana program supports up to ${SOLANA_SAFE_RECORD_BYTES.toLocaleString()} bytes including any public title. Shorten the text. No wallet request was sent.`);
  }
}
export const SOLANA_UPLOAD_DRAFT_KEY = 'timecapsule_public_solana_upload_v1';
const CONFIG_SEED = new TextEncoder().encode('config-v1');
const CAPSULE_SEED = new TextEncoder().encode('capsule-v1');
const DEVNET_NONCE_SEED = 'timecapsule-devnet-nonce-v1';
const BPF_LOADER_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const LEGACY_TRANSACTION_LIMIT = 1_232;
const LEGACY_MAX_COMPUTE_UNIT_LIMIT = 1_400_000;
const LEGACY_DEFAULT_BUILTIN_COMPUTE_UNITS = 3_000;
const LEGACY_DEFAULT_PROGRAM_COMPUTE_UNITS = 200_000;
const LEGACY_MAX_PRIORITY_FEE_LAMPORTS = 100_000n;
const LEGACY_MIN_REVIEW_BLOCKHASH_WINDOW = 130;
const LEGACY_BLOCKHASH_REFRESH_ATTEMPTS = 3;
// Used only to reserve packet bytes in the planner; live fees are checked
// against the Compute Unit limit actually returned by the wallet.
const LEGACY_PLANNED_COMPUTE_UNIT_PRICE = 70_000n;
const V1_TRANSACTION_LIMIT = 4_096;
const V1_WRITE_CHUNK_BYTES = 3_800;
// The configured maximum payload and title fit within this one review batch.
const V1_SIGNING_BATCH_SIZE = 32;
const V1_LOADED_ACCOUNT_PAGE_BYTES = 32 * 1024;
const LEGACY_SIGNING_BATCH_SIZE = 4;
const DEFAULT_COMMITMENT: Commitment = 'confirmed';
const PUBLIC_FINAL_FILTERS = [
  { memcmp: { offset: 65, bytes: '1' } }, // CapsuleMode::Public
  { memcmp: { offset: 68, bytes: '2' } }, // CapsuleState::Final
];

export interface SolanaConfigRecord {
  schemaVersion: number;
  admin: string;
  feeRecipient: string;
  protocolFeeLamports: bigint;
  maxPayloadSize: number;
  minLockDuration: number;
}

export interface SolanaRecoveryCard {
  appName: 'TimeCapsule';
  version: 2;
  chainNamespace: 'solana';
  cluster: 'devnet';
  genesisHash: string;
  programId: string;
  capsulePda: string;
  capsuleId: string;
  owner: string;
  createdAt: number;
  unlockAt: number;
  mode: CapsuleMode;
  formatVersion: 1;
  payloadHash: string;
  finalizeSignature: string;
}

export interface SolanaCapsuleRecord {
  chainNamespace: 'solana';
  cluster: 'devnet';
  capsulePda: string;
  capsuleId: string;
  owner: string;
  createdAt: number;
  unlockAt: number;
  mode: CapsuleMode;
  formatVersion: number;
  payloadHash: string;
  payloadBytes: Uint8Array;
  publicTitle: string;
  finalizedAt: number;
  finalizeSignature?: string;
}

export interface SolanaSealQuote {
  capsuleId: string;
  capsulePda: string;
  payloadBytes: number;
  titleBytes: number;
  maxChunkBytes: number;
  transactionCount: number;
  walletApprovalCount: number;
  capsuleTransactionCount: number;
  nonceAccount: string;
  nonceSetupRequired: boolean;
  nonceSetupInFirstTransaction: boolean;
  nonceAccountRentLamports: bigint;
  minimumUploadWindowSeconds: number;
  transactionVersion: 'v1' | 'legacy';
  atomicV1?: boolean;
  legacySubmission?: 'phantom' | 'app-signed' | 'app-batch' | 'durable-nonce';
  fallbackReason?: string;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
  estimatedNetworkFeeLamports: bigint;
  maximumPriorityFeeLamports?: bigint;
  accountRentLamports: bigint;
  protocolFeeLamports: bigint;
  ownerBalanceLamports: bigint;
  feeReview: SolanaProtocolFeeReview;
}

export function chooseDefaultLegacySubmission(params: {
  ownerMatches: boolean;
  canSign: boolean;
  canWalletSend: boolean;
  canSignAll?: boolean;
}): NonNullable<SolanaSealQuote['legacySubmission']> {
  if (!params.ownerMatches) return 'durable-nonce';
  if (params.canSignAll) return 'app-batch';
  if (params.canWalletSend) return 'phantom';
  return 'app-signed';
}

interface PhantomWalletStandardSigner {
  wallet: Wallet;
  account: WalletAccount;
  signTransaction: (...inputs: readonly SolanaSignTransactionInput[]) => Promise<readonly SolanaSignTransactionOutput[]>;
}

export function getPhantomV1Signer(owner: string): PhantomWalletStandardSigner | null {
  let wallets: readonly Wallet[];
  try { wallets = getWallets().get(); }
  catch { return null; }
  const expectedOwner = solanaPublicKey(owner).toBase58();
  for (const wallet of wallets) {
    if (!/phantom/i.test(wallet.name)) continue;
    const feature = wallet.features[SolanaSignTransaction] as {
      supportedTransactionVersions?: readonly (string | number)[];
      signTransaction?: PhantomWalletStandardSigner['signTransaction'];
    } | undefined;
    if (!feature?.signTransaction || !feature.supportedTransactionVersions?.some((version) => String(version) === '1')) continue;
    const account = wallet.accounts.find((candidate) => candidate.address === expectedOwner);
    if (!account) continue;
    if (!wallet.chains.includes('solana:devnet') || !account.chains.includes('solana:devnet')) continue;
    return { wallet, account, signTransaction: feature.signTransaction.bind(feature) };
  }
  return null;
}

export interface SolanaUploadDraft {
  schemaVersion: 1;
  cluster: 'devnet';
  programId: string;
  owner: string;
  capsuleId: string;
  capsulePda: string;
  unlockAt: number;
  mode: CapsuleMode;
  formatVersion: 1;
  payloadHash: string;
  payloadBase64: string;
  publicTitle: string;
  beginSignature?: string;
  lastSignature?: string;
  pendingSignature?: string;
  pendingLastValidBlockHeight?: number;
  pendingPhase?: 'nonce-setup' | 'begin' | 'payload' | 'title' | 'finalize' | 'cancel';
  pendingNonce?: { account: string; value: string };
  pendingBlockhash?: string;
  updatedAt: number;
}

export interface SolanaUploadCallbacks {
  onStatus?: (status: string) => void;
  onProgress?: (progress: { completed: number; total: number; phase: 'nonce' | 'begin' | 'payload' | 'title' | 'finalize' }) => void;
}

export function createSolanaConnection(rpcUrl?: string): Connection {
  return new Connection(resolveSolanaRpcUrl(rpcUrl), {
    commitment: DEFAULT_COMMITMENT,
    confirmTransactionInitialTimeout: 90_000,
    fetch: solanaRpcFetch,
    // The shared fetch wrapper retries only read-only requests. In particular,
    // it never replays sendTransaction after a wallet has signed it.
    disableRetryOnRateLimit: true,
  });
}

function getSafeErrorMessage(value: unknown, depth = 0): string {
  if (depth > 2 || !value || typeof value !== 'object') return '';
  const candidate = value as { message?: unknown; cause?: unknown };
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return message || getSafeErrorMessage(candidate.cause, depth + 1);
}

export function formatSolanaError(cause: unknown, fallback: string): string {
  const message = getSafeErrorMessage(cause);
  if (/\b5663037\b/.test(message)) {
    return 'The next Solana upload transaction could not be simulated to estimate its resource limits. Nothing was signed for this step. The encrypted upload remains saved; resume to check the confirmed on-chain offset before continuing.';
  }
  const numericFeeError = /["']?Custom["']?\s*:\s*(\d+)/.exec(message)?.[1];
  const hexFeeError = /custom program error:\s*0x([0-9a-f]+)/i.exec(message)?.[1];
  const feeError = numericFeeError ? Number(numericFeeError) : hexFeeError ? Number.parseInt(hexFeeError, 16) : undefined;
  if (feeError !== undefined && SOLANA_FEE_ERROR_MESSAGES[feeError]) return SOLANA_FEE_ERROR_MESSAGES[feeError];
  if (/\b429\b|too many requests/i.test(message)) {
    return 'The Solana Devnet RPC is rate-limited (HTTP 429). Read-only requests retry automatically. Wait briefly, then resume; the app checks the saved signature and on-chain upload offset before requesting another wallet signature.';
  }
  if (/\b504\b|gateway timeout|did not respond in time/i.test(message)) {
    return 'The Solana Devnet RPC timed out. Resume will check the chain for any signed transaction before requesting another Phantom approval.';
  }
  if (/simulation failed[\s\S]*blockhash not found/i.test(message)) {
    return 'The Solana transaction expired or its recent blockhash was unavailable before submission. Resume to review a fresh transaction in Phantom.';
  }
  return (message || fallback)
    .replace(/https?:\/\/[^\s"')]+/gi, '[RPC URL]')
    .replace(/(api[-_]?key\s*[=:]\s*)[^&\s"']+/gi, '$1[redacted]');
}

export function solanaPublicKey(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error('Enter a valid Solana public key.');
  }
}

export function encodeU64LE(value: bigint | number | string): Uint8Array {
  const integer = BigInt(value);
  if (integer < 0n || integer > 0xffff_ffff_ffff_ffffn) throw new Error('Capsule ID must fit in an unsigned 64-bit integer.');
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, integer, true);
  return bytes;
}

export function deriveSolanaConfigPda(programId = SOLANA_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([CONFIG_SEED], solanaPublicKey(programId))[0];
}

export function deriveSolanaCapsulePda(owner: string, capsuleId: bigint | number | string, programId = SOLANA_PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [CAPSULE_SEED, solanaPublicKey(owner).toBuffer(), encodeU64LE(capsuleId)],
    solanaPublicKey(programId),
  )[0];
}

async function deriveSolanaDevnetNonceAddress(owner: PublicKey): Promise<PublicKey> {
  return PublicKey.createWithSeed(owner, DEVNET_NONCE_SEED, SystemProgram.programId);
}

function nonceAdvanceInstruction(owner: PublicKey, nonceAccount: PublicKey): TransactionInstruction {
  return SystemProgram.nonceAdvance({ noncePubkey: nonceAccount, authorizedPubkey: owner });
}

async function readSolanaDevnetNonce(connection: Connection, owner: PublicKey) {
  const address = await deriveSolanaDevnetNonceAddress(owner);
  const result = await connection.getAccountInfoAndContext(address, { commitment: 'confirmed' });
  const account = result.value;
  if (!account) return { address, contextSlot: result.context.slot, account: null as null };
  if (!account.owner.equals(SystemProgram.programId) || account.data.length !== NONCE_ACCOUNT_LENGTH) {
    throw new Error('The derived Devnet transaction nonce account exists with an unexpected owner or size. Stop and inspect it before signing.');
  }
  if (readUnsignedLE(new Uint8Array(account.data), 4, 4) !== 1n) {
    throw new Error('The derived Devnet transaction nonce account is not initialized. Stop and inspect it before signing.');
  }
  let state: NonceAccount;
  try { state = NonceAccount.fromAccountData(account.data); }
  catch { throw new Error('The derived Devnet transaction nonce account is not initialized. Stop and inspect it before signing.'); }
  if (!state.authorizedPubkey.equals(owner)) {
    throw new Error('The derived Devnet transaction nonce belongs to a different authority. Stop and inspect it before signing.');
  }
  return { address, contextSlot: result.context.slot, account: { state, lamports: account.lamports } };
}

function readUnsignedLE(bytes: Uint8Array, offset: number, length: number): bigint {
  if (offset < 0 || length < 1 || offset + length > bytes.length) throw new Error('Solana account data is truncated.');
  let value = 0n;
  for (let index = length - 1; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[offset + index]);
  return value;
}

function readSignedLE(bytes: Uint8Array, offset: number, length: number): bigint {
  return BigInt.asIntN(length * 8, readUnsignedLE(bytes, offset, length));
}

const ACCOUNT_DISCRIMINATORS = {
  Config: Uint8Array.from([0x9b, 0x0c, 0xaa, 0xe0, 0x1e, 0xfa, 0xcc, 0x82]),
  Capsule: Uint8Array.from([0xd4, 0xe7, 0x4d, 0xdb, 0x3a, 0x0d, 0x76, 0xf1]),
} as const;

function accountDiscriminator(name: 'Config' | 'Capsule'): Uint8Array {
  return ACCOUNT_DISCRIMINATORS[name];
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const data = bytes.slice();
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return `0x${hex(await sha256Bytes(bytes))}`;
}

function base64Encode(bytes: Uint8Array): string {
  let output = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    output += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  }
  return btoa(output);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function getAnchorDiscriminator(namespace: 'global' | 'event', name: string): Promise<Uint8Array> {
  return (await sha256Bytes(new TextEncoder().encode(`${namespace}:${name}`))).subarray(0, 8);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function littleEndian(value: bigint | number, length: number, signed = false): Uint8Array {
  const bytes = new Uint8Array(length);
  const view = new DataView(bytes.buffer);
  if (length === 8) {
    if (signed) view.setBigInt64(0, BigInt(value), true);
    else view.setBigUint64(0, BigInt(value), true);
  } else if (length === 4) view.setUint32(0, Number(value), true);
  else if (length === 2) view.setUint16(0, Number(value), true);
  else if (length === 1) view.setUint8(0, Number(value));
  else throw new Error('Unsupported integer field size.');
  return bytes;
}

function anchorVec(bytes: Uint8Array): Uint8Array {
  return concat(littleEndian(bytes.length, 4), bytes);
}

function accountBytes(account: AccountInfo<Buffer> | null, name: string): Uint8Array {
  if (!account) throw new Error(`${name} account was not found on Solana Devnet.`);
  return new Uint8Array(account.data);
}

export function decodeSolanaConfig(data: Uint8Array): SolanaConfigRecord {
  if (data.length !== 93 || !equalBytes(data.subarray(0, 8), accountDiscriminator('Config'))) {
    throw new Error('Config PDA data does not match the deployed Anchor account layout.');
  }
  if (data[8] !== 1) throw new Error('This Config account version is unsupported.');
  const config = {
    schemaVersion: data[8],
    admin: new PublicKey(data.subarray(9, 41)).toBase58(),
    feeRecipient: new PublicKey(data.subarray(41, 73)).toBase58(),
    protocolFeeLamports: readUnsignedLE(data, 73, 8),
    maxPayloadSize: Number(readUnsignedLE(data, 81, 4)),
    minLockDuration: Number(readSignedLE(data, 85, 8)),
  };
  if (config.maxPayloadSize <= 0 || config.maxPayloadSize > SOLANA_MAX_PAYLOAD_SIZE || config.minLockDuration < 0) {
    throw new Error('Config PDA contains invalid capacity or lock-time settings.');
  }
  return config;
}

export interface DecodedSolanaCapsule {
  schemaVersion: number;
  owner: string;
  capsuleId: string;
  createdAt: number;
  unlockAt: number;
  mode: CapsuleMode;
  formatVersion: number;
  state: 'uploading' | 'final';
  expectedPayloadLen: number;
  uploadedPayloadLen: number;
  payloadHash: string;
  expectedTitleLen: number;
  uploadedTitleLen: number;
  publicTitle: string;
  expiresAt: number;
  finalizedAt: number;
  payloadBytes: Uint8Array;
}

export function decodeSolanaCapsule(data: Uint8Array): DecodedSolanaCapsule {
  if (data.length < SOLANA_ACCOUNT_FIXED_SPACE || !equalBytes(data.subarray(0, 8), accountDiscriminator('Capsule'))) {
    throw new Error('Capsule PDA data does not match the deployed Anchor account layout.');
  }
  let cursor = 8;
  const schemaVersion = data[cursor++];
  const owner = new PublicKey(data.subarray(cursor, cursor + 32)).toBase58(); cursor += 32;
  const capsuleId = readUnsignedLE(data, cursor, 8).toString(); cursor += 8;
  const createdAt = Number(readSignedLE(data, cursor, 8)); cursor += 8;
  const unlockAt = Number(readSignedLE(data, cursor, 8)); cursor += 8;
  const modeIndex = data[cursor++];
  const formatVersion = Number(readUnsignedLE(data, cursor, 2)); cursor += 2;
  const stateIndex = data[cursor++];
  const expectedPayloadLen = Number(readUnsignedLE(data, cursor, 4)); cursor += 4;
  const uploadedPayloadLen = Number(readUnsignedLE(data, cursor, 4)); cursor += 4;
  const payloadHash = `0x${hex(data.subarray(cursor, cursor + 32))}`; cursor += 32;
  const expectedTitleLen = Number(readUnsignedLE(data, cursor, 2)); cursor += 2;
  const uploadedTitleLen = Number(readUnsignedLE(data, cursor, 2)); cursor += 2;
  const titleLen = Number(readUnsignedLE(data, cursor, 4)); cursor += 4;
  if (titleLen > SOLANA_MAX_TITLE_BYTES || cursor + titleLen > data.length) throw new Error('Capsule public-title length is invalid.');
  let publicTitle = '';
  try {
    publicTitle = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(cursor, cursor + titleLen));
  } catch {
    throw new Error('Capsule public title is not valid UTF-8.');
  }
  cursor += titleLen;
  const expiresAt = Number(readSignedLE(data, cursor, 8)); cursor += 8;
  const finalizedAt = Number(readSignedLE(data, cursor, 8)); cursor += 8;
  const payloadLen = Number(readUnsignedLE(data, cursor, 4)); cursor += 4;
  if (payloadLen > SOLANA_MAX_PAYLOAD_SIZE || cursor + payloadLen !== data.length) throw new Error('Capsule payload size does not match its serialized account.');
  const payloadBytes = new Uint8Array(data.subarray(cursor));
  const mode: CapsuleMode | null = modeIndex === 0 ? 'public' : modeIndex === 1 ? 'private' : null;
  const state = stateIndex === 0 ? 'uploading' : stateIndex === 1 ? 'final' : null;
  if (!mode || !state || schemaVersion !== 1) throw new Error('Capsule version, mode, or state is unsupported.');
  if (data.length !== SOLANA_ACCOUNT_FIXED_SPACE + titleLen + payloadLen) throw new Error('Capsule account space does not match its stored fields.');
  return {
    schemaVersion, owner, capsuleId, createdAt, unlockAt, mode, formatVersion, state,
    expectedPayloadLen, uploadedPayloadLen, payloadHash, expectedTitleLen, uploadedTitleLen,
    publicTitle, expiresAt, finalizedAt, payloadBytes,
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function validateCapsuleTitle(record: DecodedSolanaCapsule): void {
  const titleBytes = new TextEncoder().encode(record.publicTitle);
  if (record.mode === 'private') {
    if (titleBytes.length || record.expectedTitleLen !== 0 || record.uploadedTitleLen !== 0) throw new Error('Private capsule contains public-title data.');
    return;
  }
  if (!titleBytes.length || titleBytes.length > SOLANA_MAX_TITLE_BYTES ||
      titleBytes.length !== record.expectedTitleLen || titleBytes.length !== record.uploadedTitleLen ||
      !record.publicTitle.trim() || Array.from(record.publicTitle).length > SOLANA_MAX_TITLE_CHARACTERS) {
    throw new Error('Public capsule title violates the on-chain title limits.');
  }
}

function validateV1Header(record: DecodedSolanaCapsule): void {
  let capsule: Record<string, unknown>;
  const serialized = new TextDecoder('utf-8', { fatal: true }).decode(record.payloadBytes);
  try {
    capsule = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new Error('On-chain payload is not valid Capsule Open Format V1 JSON.');
  }
  if (!capsule || typeof capsule !== 'object' || Array.isArray(capsule) || JSON.stringify(capsule) !== serialized ||
      capsule.formatVersion !== 1 || capsule.mode !== record.mode || capsule.unlockAt !== record.unlockAt) {
    throw new Error('On-chain payload does not match the finalized V1 metadata.');
  }
}

function toSolanaRecord(capsulePda: string, decoded: DecodedSolanaCapsule, finalizeSignature?: string): SolanaCapsuleRecord {
  return {
    chainNamespace: 'solana', cluster: 'devnet', capsulePda, capsuleId: decoded.capsuleId,
    owner: decoded.owner, createdAt: decoded.createdAt, unlockAt: decoded.unlockAt,
    mode: decoded.mode, formatVersion: decoded.formatVersion, payloadHash: decoded.payloadHash,
    payloadBytes: decoded.payloadBytes, publicTitle: decoded.publicTitle,
    finalizedAt: decoded.finalizedAt, finalizeSignature,
  };
}

async function readProgramAndConfig(connection: Connection, programId = SOLANA_PROGRAM_ID, includeFee = false) {
  const programAddress = solanaPublicKey(programId);
  // These checks are independent. Keep wallet handoff latency down by fetching
  // the cluster identity and both finalized accounts concurrently, with one
  // batched account read instead of three sequential RPC round trips.
  const [genesisHash, accounts] = await Promise.all([
    connection.getGenesisHash(),
    connection.getMultipleAccountsInfo([programAddress, deriveSolanaConfigPda(programId),
      ...(includeFee ? [deriveSolanaFeePolicyPda(programId), new PublicKey(SOL_PRICE_ACCOUNT), new PublicKey(USDC_PRICE_ACCOUNT), SYSVAR_CLOCK_PUBKEY] : [])], 'confirmed'),
  ]);
  const [program, configInfo] = accounts;
  if (genesisHash !== SOLANA_DEVNET_GENESIS_HASH) throw new Error('The selected RPC endpoint is not Solana Devnet.');
  if (!program?.executable || !program.owner.equals(BPF_LOADER_UPGRADEABLE)) throw new Error('The configured Program ID is not an executable Devnet program.');
  const configAccount = accountBytes(configInfo, 'Config PDA');
  if (!configInfo!.owner.equals(programAddress)) throw new Error('Config PDA is owned by a different program.');
  const config = decodeSolanaConfig(configAccount);
  let feeReview: SolanaProtocolFeeReview | undefined;
  let chainTime: number | undefined;
  if (includeFee) {
    const policyInfo = accounts[2];
    if (!policyInfo) throw new Error('Solana publishing is awaiting fee activation on this network. Please try again later.');
    if (!policyInfo.owner.equals(programAddress) || policyInfo.executable) throw new Error('The fee policy is owned by a different program.');
    const clock = accounts[5];
    if (!clock || clock.data.length !== 40 || clock.owner.toBase58() !== 'Sysvar1111111111111111111111111111111111111') throw new Error('The on-chain clock could not be verified.');
    chainTime = Number(readSignedLE(clock.data, 32, 8));
    if (!Number.isSafeInteger(chainTime) || chainTime <= 0) throw new Error('The on-chain timestamp is invalid.');
    feeReview = createSolanaProtocolFeeReview({ policy: decodeSolanaFeePolicy(policyInfo.data),
      fixedLamports: config.protocolFeeLamports, feeRecipient: config.feeRecipient,
      solAccount: accounts[3], usdcAccount: accounts[4], now: chainTime, localNow: Math.floor(Date.now() / 1_000) });
  }
  return { genesisHash, programId, config, feeReview, chainTime };
}

/** Read during composition; no wallet request or oracle update transaction. */
export async function fetchSolanaProtocolFee(rpcUrl?: string): Promise<SolanaProtocolFeeReview> {
  const { feeReview } = await readProgramAndConfig(createSolanaConnection(rpcUrl), SOLANA_PROGRAM_ID, true);
  return feeReview!;
}

async function verifiedCapsuleFromAccount(
  connection: Connection,
  pda: PublicKey,
  config: SolanaConfigRecord,
  expected?: { owner?: string; capsuleId?: bigint | number | string },
  commitment: Commitment = 'confirmed',
): Promise<SolanaCapsuleRecord> {
  const info = await connection.getAccountInfo(pda, commitment);
  if (!info || !info.owner.equals(solanaPublicKey(SOLANA_PROGRAM_ID)) || info.executable) throw new Error('Capsule PDA is missing or has the wrong account owner.');
  const decoded = decodeSolanaCapsule(new Uint8Array(info.data));
  if (deriveSolanaCapsulePda(decoded.owner, decoded.capsuleId).toBase58() !== pda.toBase58()) throw new Error('Capsule PDA does not match its owner and ID seeds.');
  if (expected?.owner && solanaPublicKey(expected.owner).toBase58() !== decoded.owner) throw new Error('Capsule owner does not match the requested owner.');
  if (expected?.capsuleId !== undefined && BigInt(expected.capsuleId).toString() !== decoded.capsuleId) throw new Error('Capsule ID does not match the requested ID.');
  if (decoded.state !== 'final') throw new Error('This capsule upload is not finalized.');
  if (decoded.formatVersion !== 1 || decoded.createdAt >= decoded.unlockAt || decoded.finalizedAt < decoded.createdAt) throw new Error('Capsule timing or format metadata is invalid.');
  if (decoded.expectedPayloadLen !== decoded.payloadBytes.length || decoded.uploadedPayloadLen !== decoded.expectedPayloadLen || decoded.expectedPayloadLen > config.maxPayloadSize) {
    throw new Error('Capsule payload length does not match the configured capacity.');
  }
  validateCapsuleTitle(decoded);
  if ((await sha256Hex(decoded.payloadBytes)).toLowerCase() !== decoded.payloadHash.toLowerCase()) throw new Error('On-chain payload SHA-256 does not match the capsule commitment.');
  validateV1Header(decoded);
  return toSolanaRecord(pda.toBase58(), decoded);
}

export async function fetchSolanaCapsule(params: {
  capsulePda?: string;
  owner?: string;
  capsuleId?: string | number | bigint;
  card?: SolanaRecoveryCard;
  finalizeSignature?: string;
  finalizeObservation?: { slot: string; blockHash: string; eventPosition: number };
  rpcUrl?: string;
}): Promise<SolanaCapsuleRecord> {
  const owner = params.owner ?? params.card?.owner;
  const capsuleId = params.capsuleId ?? params.card?.capsuleId;
  const suppliedPda = params.capsulePda ?? params.card?.capsulePda;
  if (!suppliedPda && (!owner || capsuleId === undefined)) throw new Error('Enter a Capsule PDA, or both the owner address and capsule ID.');
  if (owner) solanaPublicKey(owner);
  if (capsuleId !== undefined) encodeU64LE(capsuleId);
  if (params.finalizeSignature !== undefined && !/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(params.finalizeSignature)) {
    throw new Error('Finalize transaction signature is invalid.');
  }
  if (params.finalizeObservation !== undefined &&
      (!/^(0|[1-9][0-9]{0,19})$/.test(params.finalizeObservation.slot) ||
       BigInt(params.finalizeObservation.slot) > BigInt(Number.MAX_SAFE_INTEGER) ||
       !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(params.finalizeObservation.blockHash) ||
       !Number.isSafeInteger(params.finalizeObservation.eventPosition) || params.finalizeObservation.eventPosition < 0)) {
    throw new Error('Indexed finalize observation is invalid.');
  }
  if (params.finalizeObservation && !params.finalizeSignature) {
    throw new Error('Indexed finalize observation requires its transaction signature.');
  }
  const derivedPda = owner && capsuleId !== undefined ? deriveSolanaCapsulePda(owner, capsuleId) : null;
  const pda = suppliedPda ? solanaPublicKey(suppliedPda) : derivedPda!;
  if (derivedPda && !derivedPda.equals(pda)) throw new Error('Capsule PDA does not match the provided owner and capsule ID.');
  const connection = createSolanaConnection(params.rpcUrl);
  const { genesisHash, config } = await readProgramAndConfig(connection);
  if (params.card) {
    validateRecoveryCard(params.card, { genesisHash, programId: SOLANA_PROGRAM_ID, capsulePda: pda.toBase58() });
  }
  const record = await verifiedCapsuleFromAccount(
    connection, pda, config, { owner, capsuleId }, params.finalizeObservation ? 'finalized' : 'confirmed',
  );
  if (params.card) {
    const card = params.card;
    if (card.owner !== record.owner || card.capsuleId !== record.capsuleId || card.createdAt !== record.createdAt || card.mode !== record.mode ||
        card.formatVersion !== record.formatVersion || card.unlockAt !== record.unlockAt ||
        card.payloadHash.toLowerCase() !== record.payloadHash.toLowerCase()) {
      throw new Error('Recovery Card metadata does not match the finalized Capsule PDA.');
    }
    await verifyFinalizeSignature(connection, card, record);
    record.finalizeSignature = card.finalizeSignature;
  }
  if (params.finalizeSignature) {
    const proof = makeRecoveryCard(record, genesisHash, params.finalizeSignature);
    await verifyFinalizeSignature(connection, proof, record, undefined, params.finalizeObservation);
    record.finalizeSignature = params.finalizeSignature;
  }
  return record;
}

function validateRecoveryCard(card: SolanaRecoveryCard, expected: { genesisHash: string; programId: string; capsulePda: string }): void {
  if (!card || card.version !== 2 || card.chainNamespace !== 'solana' || card.cluster !== 'devnet') throw new Error('This is not a Solana Devnet Recovery Card version 2.');
  if (card.genesisHash !== expected.genesisHash || card.programId !== expected.programId || card.capsulePda !== expected.capsulePda) {
    throw new Error('Recovery Card cluster, Program ID, or Capsule PDA does not match the selected chain.');
  }
  if (!/^\d+$/.test(card.capsuleId) || !Number.isSafeInteger(card.createdAt) || card.createdAt <= 0 ||
      !Number.isSafeInteger(card.unlockAt) || card.unlockAt <= card.createdAt ||
      (card.mode !== 'public' && card.mode !== 'private') || card.formatVersion !== 1 ||
      !/^0x[0-9a-f]{64}$/i.test(card.payloadHash)) {
    throw new Error('Recovery Card contains invalid capsule metadata.');
  }
  try {
    solanaPublicKey(card.owner);
    if (!/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(card.finalizeSignature)) throw new Error('signature encoding');
  } catch {
    throw new Error('Recovery Card owner or finalize signature is invalid.');
  }
}

async function readSolanaFinalizeReceipt(connection: Connection, signature: string) {
  // Kit understands v1 JSON receipts; web3.js 1.x only decodes legacy/v0.
  const receipt = await createSolanaRpc(connection.rpcEndpoint).getTransaction(signature as never, {
    commitment: 'confirmed', encoding: 'json', maxSupportedTransactionVersion: 1,
  }).send({ abortSignal: AbortSignal.timeout(8_000) });
  if (!receipt) return null;
  const slot = String(receipt.slot);
  return {
    signature: receipt.transaction.signatures[0], hasMeta: Boolean(receipt.meta), error: receipt.meta?.err,
    slot,
    accountKeys: [...receipt.transaction.message.accountKeys, ...(receipt.meta?.loadedAddresses?.writable ?? []), ...(receipt.meta?.loadedAddresses?.readonly ?? [])].map((key) => String(key)),
    instructions: receipt.transaction.message.instructions.map((instruction) => ({
      programIdIndex: instruction.programIdIndex, accountKeyIndexes: instruction.accounts, data: instruction.data,
    })),
    logs: receipt.meta?.logMessages ?? [],
  };
}

async function readFinalizedSolanaBlockSignatures(connection: Connection, slot: string | number | bigint) {
  // web3.js 1.x decodes getBlock as a full transaction response even when
  // transactionDetails='signatures'. Solana returns a `signatures` field in
  // that mode, so use Kit's schema-aware RPC client for this lightweight read.
  return createSolanaRpc(connection.rpcEndpoint).getBlock(BigInt(slot) as never, {
    commitment: 'finalized', transactionDetails: 'signatures', rewards: false,
  }).send({ abortSignal: AbortSignal.timeout(8_000) });
}

export function hasProgramInstructionForCapsule(
  accountKeys: readonly string[],
  instructions: readonly { programIdIndex: number; accountKeyIndexes: readonly number[]; data: string }[],
  capsulePda: string,
  expectedInstructionDiscriminator: Uint8Array,
  expectedInstructionIndex?: number,
): boolean {
  const matches = (index: number) => {
    const instruction = instructions[index];
    if (!instruction || accountKeys[instruction.programIdIndex] !== SOLANA_PROGRAM_ID) return false;
    if (!instruction.accountKeyIndexes.some((accountIndex) => accountKeys[accountIndex] === capsulePda)) return false;
    try {
      const instructionData = getBase58Encoder().encode(instruction.data);
      return instructionData.length >= expectedInstructionDiscriminator.length &&
        equalBytes(instructionData.subarray(0, expectedInstructionDiscriminator.length), expectedInstructionDiscriminator);
    } catch {
      return false;
    }
  };
  if (expectedInstructionIndex !== undefined) {
    return Number.isSafeInteger(expectedInstructionIndex) && expectedInstructionIndex >= 0 && matches(expectedInstructionIndex);
  }
  return instructions.some((_, index) => matches(index));
}

async function verifyFinalizeSignature(
  connection: Connection, card: SolanaRecoveryCard, record: SolanaCapsuleRecord,
  confirmedReceipt?: Awaited<ReturnType<typeof readSolanaFinalizeReceipt>>,
  expectedObservation?: { slot: string; blockHash: string; eventPosition: number },
): Promise<void> {
  // Indexed observations already carry the finalized slot and block hash. For
  // those reads, the canonical block and transaction receipt below provide a
  // stronger proof than the provider's signature-status cache, which may omit
  // older Devnet transactions even when their finalized receipts are available.
  if (!confirmedReceipt && !expectedObservation) {
    const statuses = await connection.getSignatureStatuses([card.finalizeSignature], { searchTransactionHistory: true });
    const status = statuses.value[0];
    if (!status || status.err || (status.confirmationStatus !== 'finalized' && status.confirmationStatus !== 'confirmed')) {
      throw new Error('Recovery Card finalize signature is not confirmed on Devnet.');
    }
  }
  const transaction = confirmedReceipt ?? await readSolanaFinalizeReceipt(connection, card.finalizeSignature);
  if (!transaction?.hasMeta || transaction.error !== null || transaction.signature !== card.finalizeSignature) throw new Error('Recovery Card finalize transaction is missing or failed.');
  if (expectedObservation) {
    if (transaction.slot !== expectedObservation.slot) throw new Error('Finalize transaction slot does not match the database observation.');
    const block = await readFinalizedSolanaBlockSignatures(connection, transaction.slot);
    if (!block || block.blockhash !== expectedObservation.blockHash ||
        !block.signatures.includes(card.finalizeSignature as never)) {
      throw new Error('Finalize transaction block does not match the finalized database observation.');
    }
  }
  const hasProgramInstruction = hasProgramInstructionForCapsule(
    transaction.accountKeys,
    transaction.instructions,
    record.capsulePda,
    await getAnchorDiscriminator('global', 'finalize_capsule'),
    expectedObservation?.eventPosition,
  );
  if (!hasProgramInstruction) throw new Error('Finalize transaction does not invoke the configured TimeCapsule program for this Capsule PDA.');
  const expectedDiscriminator = await getAnchorDiscriminator('event', 'CapsuleFinalized');
  let matched = false;
  const matchingEventPositions: number[] = [];
  const programStack: string[] = [];
  let topLevelInstructionIndex = -1;
  for (const log of transaction.logs) {
    const invoked = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[(\d+)\]$/.exec(log);
    if (invoked) {
      const depth = Number(invoked[2]);
      if (depth === 1) topLevelInstructionIndex += 1;
      programStack.length = depth - 1;
      programStack.push(invoked[1]);
      continue;
    }
    const ended = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:success|failed:.*)$/.exec(log);
    if (ended) {
      const depth = programStack.lastIndexOf(ended[1]);
      if (depth >= 0) programStack.length = depth;
      continue;
    }
    if (programStack.at(-1) !== SOLANA_PROGRAM_ID) continue;
    const dataMatch = /^Program data: ([A-Za-z0-9+/=]+)$/.exec(log);
    if (!dataMatch) continue;
    const event = base64Decode(dataMatch[1]);
    if (event.length !== 135 || !equalBytes(event.subarray(0, 8), expectedDiscriminator)) continue;
    let offset = 8;
    const capsulePda = new PublicKey(event.subarray(offset, offset + 32)).toBase58(); offset += 32;
    const capsuleId = readUnsignedLE(event, offset, 8).toString(); offset += 8;
    const owner = new PublicKey(event.subarray(offset, offset + 32)).toBase58(); offset += 32;
    const unlockAt = Number(readSignedLE(event, offset, 8)); offset += 8;
    const mode = event[offset++] === 0 ? 'public' : 'private';
    const formatVersion = Number(readUnsignedLE(event, offset, 2)); offset += 2;
    const payloadLen = Number(readUnsignedLE(event, offset, 4)); offset += 4;
    const payloadHash = `0x${hex(event.subarray(offset, offset + 32))}`;
    if (capsulePda === record.capsulePda && capsuleId === record.capsuleId && owner === record.owner &&
        unlockAt === record.unlockAt && mode === record.mode && formatVersion === record.formatVersion &&
        payloadLen === record.payloadBytes.length && payloadHash.toLowerCase() === record.payloadHash.toLowerCase()) {
      matched = true;
      matchingEventPositions.push(topLevelInstructionIndex);
    }
  }
  if (!matched) throw new Error('Finalize transaction does not contain the matching CapsuleFinalized event.');
  if (expectedObservation && (matchingEventPositions.length !== 1 || matchingEventPositions[0] !== expectedObservation.eventPosition)) {
    throw new Error('Finalize event position does not match the database observation.');
  }
}

async function completeConfirmedSolanaUpload(
  connection: Connection, capsule: PublicKey, config: SolanaConfigRecord, genesisHash: string, signature: string,
  feeReview?: SolanaProtocolFeeReview,
) {
  // The sender already observed confirmed status. Fetch the full account and
  // receipt together, rather than re-reading genesis/config/status in series.
  const [record, receipt] = await Promise.all([
    verifiedCapsuleFromAccount(connection, capsule, config),
    readSolanaFinalizeReceipt(connection, signature),
  ]);
  if (!receipt) throw new Error('The capsule transaction is confirmed; its receipt is still becoming available. Resume checks it without uploading again.');
  await verifyFinalizeSignature(connection, makeRecoveryCard(record, genesisHash, signature), record, receipt);
  let protocolFeePaidLamports: bigint | undefined;
  if (feeReview) {
    const discriminator = await getAnchorDiscriminator('event', 'ProtocolFeePaid');
    for (const log of receipt.logs) {
      const match = /^Program data: ([A-Za-z0-9+/=]+)$/.exec(log);
      if (!match) continue;
      const event = base64Decode(match[1]);
      if (event.length !== 128 || !equalBytes(event.subarray(0, 8), discriminator)) continue;
      if (new PublicKey(event.subarray(8, 40)).toBase58() !== record.capsulePda ||
          new PublicKey(event.subarray(40, 72)).toBase58() !== record.owner ||
          new PublicKey(event.subarray(72, 104)).toBase58() !== feeReview.feeRecipient ||
          readUnsignedLE(event, 112, 8) !== feeReview.policyRevision ||
          readUnsignedLE(event, 120, 8) !== feeReview.targetUsdcMicros) continue;
      const paid = readUnsignedLE(event, 104, 8);
      if (paid > feeReview.maxProtocolFeeLamports || (feeReview.mode === 'fixed-sol' && paid !== feeReview.protocolFeeLamports)) {
        throw new Error('The confirmed protocol fee differs from the signed fee review. Inspect the transaction before retrying.');
      }
      protocolFeePaidLamports = paid;
    }
    if (protocolFeePaidLamports === undefined) throw new Error('The capsule is confirmed, but its matching protocol fee receipt is unavailable. Check this transaction before retrying.');
  }
  record.finalizeSignature = signature;
  return { record, card: makeRecoveryCard(record, genesisHash, signature), protocolFeePaidLamports };
}

async function findFinalizeSignature(
  connection: Connection,
  record: SolanaCapsuleRecord,
  genesisHash: string,
  preferredSignature?: string,
): Promise<string | null> {
  const candidates = preferredSignature ? [preferredSignature] : [];
  try {
    const history = await connection.getSignaturesForAddress(solanaPublicKey(record.capsulePda), { limit: 100 }, 'confirmed');
    for (const entry of history) {
      if (!entry.err && !candidates.includes(entry.signature)) candidates.push(entry.signature);
    }
  } catch {
    // A locally recorded signature may still be sufficient when address history is rate limited.
  }
  for (const signature of candidates) {
    try {
      await verifyFinalizeSignature(connection, makeRecoveryCard(record, genesisHash, signature), record);
      return signature;
    } catch {
      // Only the transaction that emitted the matching CapsuleFinalized event is accepted.
    }
  }
  return null;
}

export async function fetchSolanaCapsulesByOwner(owner: string, rpcUrl?: string): Promise<SolanaCapsuleRecord[]> {
  const connection = createSolanaConnection(rpcUrl);
  const { config } = await readProgramAndConfig(connection);
  const ownerAddress = solanaPublicKey(owner);
  const accounts = await connection.getProgramAccounts(solanaPublicKey(SOLANA_PROGRAM_ID), {
    commitment: 'confirmed',
    filters: [
      { memcmp: { offset: 9, bytes: ownerAddress.toBase58() } },
      { memcmp: { offset: 68, bytes: '2' } },
    ],
    dataSlice: { offset: 0, length: 117 },
  });
  return loadVerifiedAccounts(connection, config, accounts.map(({ pubkey }) => pubkey));
}

export async function fetchSolanaPublicCapsules(rpcUrl?: string): Promise<SolanaCapsuleRecord[]> {
  const connection = createSolanaConnection(rpcUrl);
  const { config } = await readProgramAndConfig(connection);
  const accounts = await connection.getProgramAccounts(solanaPublicKey(SOLANA_PROGRAM_ID), {
    commitment: 'confirmed',
    filters: PUBLIC_FINAL_FILTERS,
    dataSlice: { offset: 0, length: 117 },
  });
  return loadVerifiedAccounts(connection, config, accounts.map(({ pubkey }) => pubkey));
}

async function loadVerifiedAccounts(connection: Connection, config: SolanaConfigRecord, addresses: PublicKey[]): Promise<SolanaCapsuleRecord[]> {
  const records: SolanaCapsuleRecord[] = [];
  const concurrency = 3;
  for (let offset = 0; offset < addresses.length; offset += concurrency) {
    const batch = addresses.slice(offset, offset + concurrency);
    const results = await Promise.all(batch.map(async (pda) => {
      try { return await verifiedCapsuleFromAccount(connection, pda, config); }
      catch (error) { return { error: error instanceof Error ? error : new Error(String(error)) }; }
    }));
    for (const result of results) {
      if ('error' in result) {
        // A partial upload or corrupt account is not shown as a finalized capsule.
        console.warn('A Solana capsule account was skipped during verified listing:', result.error.message);
      } else records.push(result);
    }
  }
  return records.sort((a, b) => {
    const timeOrder = b.finalizedAt - a.finalizedAt;
    if (timeOrder !== 0) return timeOrder;
    const aId = BigInt(a.capsuleId);
    const bId = BigInt(b.capsuleId);
    return aId === bId ? 0 : bId > aId ? 1 : -1;
  });
}

export async function decryptSolanaCapsule(record: SolanaCapsuleRecord, password?: string): Promise<string> {
  if (Math.floor(Date.now() / 1000) < record.unlockAt) throw new Error('This capsule has not reached its unlock time yet.');
  const { unsealCapsulePayload } = await import('../codec');
  const result = await unsealCapsulePayload({
    payloadBytesOrHex: record.payloadBytes,
    expectedPayloadHash: record.payloadHash,
    expectedMetadata: { unlockAt: record.unlockAt, mode: record.mode, formatVersion: record.formatVersion },
    password,
  });
  return result.message;
}

function randomCapsuleId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const id = new DataView(bytes.buffer).getBigUint64(0, true);
  return (id === 0n ? 1n : id).toString();
}

async function buildInstructionData(name: string, args: Uint8Array = new Uint8Array()): Promise<Uint8Array> {
  return concat(await getAnchorDiscriminator('global', name), args);
}

function buildBeginData(params: {
  capsuleId: string;
  unlockAt: number;
  mode: CapsuleMode;
  formatVersion?: 1 | 2;
  payloadBytes: Uint8Array;
  payloadHash: Uint8Array;
  titleBytes: Uint8Array;
}): Promise<Uint8Array> {
  return buildInstructionData('begin_capsule', concat(
    encodeU64LE(params.capsuleId),
    littleEndian(params.unlockAt, 8, true),
    littleEndian(params.mode === 'public' ? 0 : 1, 1),
    littleEndian(params.formatVersion ?? 1, 2),
    littleEndian(params.payloadBytes.length, 4),
    params.payloadHash,
    littleEndian(params.titleBytes.length, 2),
  ));
}

async function buildWriteData(name: 'write_chunk' | 'write_title_chunk', offset: number, chunk: Uint8Array): Promise<Uint8Array> {
  return buildInstructionData(name, concat(littleEndian(offset, name === 'write_chunk' ? 4 : 2), anchorVec(chunk)));
}

function makeInstruction(
  data: Uint8Array,
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
): TransactionInstruction {
  // TransactionInstruction stores bytes without mutating them; web3.js handles its Buffer conversion internally.
  return new TransactionInstruction({ programId: solanaPublicKey(SOLANA_PROGRAM_ID), keys, data: Buffer.from(data) });
}

function beginInstruction(owner: PublicKey, capsule: PublicKey, data: Uint8Array): TransactionInstruction {
  return makeInstruction(data, [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: deriveSolanaConfigPda(), isSigner: false, isWritable: false },
    { pubkey: capsule, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ]);
}

function writeInstruction(owner: PublicKey, capsule: PublicKey, data: Uint8Array): TransactionInstruction {
  return makeInstruction(data, [
    { pubkey: owner, isSigner: true, isWritable: false },
    { pubkey: capsule, isSigner: false, isWritable: true },
  ]);
}

function cancelInstruction(owner: PublicKey, capsule: PublicKey, data: Uint8Array): TransactionInstruction {
  return makeInstruction(data, [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: capsule, isSigner: false, isWritable: true },
  ]);
}

function finalizeInstruction(owner: PublicKey, capsule: PublicKey, feeRecipient: PublicKey, data: Uint8Array, feeReview?: SolanaProtocolFeeReview): TransactionInstruction {
  return makeInstruction(feeReview ? concat(data, encodeSolanaFinalizeFeeArgs(feeReview)) : data, [
    { pubkey: owner, isSigner: true, isWritable: true },
    { pubkey: deriveSolanaConfigPda(), isSigner: false, isWritable: false },
    { pubkey: capsule, isSigner: false, isWritable: true },
    { pubkey: feeRecipient, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...(feeReview ? [deriveSolanaFeePolicyPda(), new PublicKey(SOL_PRICE_ACCOUNT), new PublicKey(USDC_PRICE_ACCOUNT)]
      .map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })) : []),
  ]);
}

function legacyMessageSize(owner: PublicKey, ...instructions: TransactionInstruction[]): number {
  // Count the actual wire fields instead of repeatedly compiling and base58
  // encoding a transaction inside the planner's binary search.
  const compactLength = (value: number) => value < 128 ? 1 : value < 16_384 ? 2 : 3;
  const accounts = new Set<string>([cachedPublicKey(owner)]);
  const signers = new Set<string>([cachedPublicKey(owner)]);
  let instructionBytes = 0;
  for (const instruction of instructions) {
    accounts.add(cachedPublicKey(instruction.programId));
    for (const key of instruction.keys) {
      const address = cachedPublicKey(key.pubkey);
      accounts.add(address);
      if (key.isSigner) signers.add(address);
    }
    instructionBytes += 1 + compactLength(instruction.keys.length) + instruction.keys.length
      + compactLength(instruction.data.length) + instruction.data.length;
  }
  return compactLength(signers.size) + signers.size * 64 + 3
    + compactLength(accounts.size) + accounts.size * 32 + 32
    + compactLength(instructions.length) + instructionBytes;
}

const publicKeyStrings = new WeakMap<PublicKey, string>();
function cachedPublicKey(key: PublicKey): string {
  let value = publicKeyStrings.get(key);
  if (value === undefined) { value = key.toBase58(); publicKeyStrings.set(key, value); }
  return value;
}

function legacyComputeBudgetReservations(): TransactionInstruction[] {
  // Phantom may add these while preparing the wallet review. Reserve their full
  // wire size up front; live fee enforcement uses the wallet's requested limit.
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: LEGACY_MAX_COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(LEGACY_PLANNED_COMPUTE_UNIT_PRICE) }),
  ];
}

function cloneLegacyInstruction(instruction: TransactionInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: instruction.programId,
    keys: instruction.keys.map((key) => ({ pubkey: key.pubkey, isSigner: key.isSigner, isWritable: key.isWritable })),
    data: Buffer.from(instruction.data),
  });
}

function nonzeroOwnerSignature(transaction: Transaction, owner: PublicKey): boolean {
  const signature = transaction.signatures.find((entry) => entry.publicKey.equals(owner))?.signature;
  return Boolean(signature && signature.length === 64 && signature.some((byte) => byte !== 0));
}

function defaultLegacyComputeUnitLimit(instructions: readonly TransactionInstruction[]): bigint {
  let units = 0;
  for (const instruction of instructions) {
    // System Program transactions are the only built-in operations used by
    // this flow (nonce setup/advance). Treat Compute Budget as a built-in too;
    // all other reviewed instructions are the deployed Capsule program.
    units += instruction.programId.equals(SystemProgram.programId) || instruction.programId.equals(ComputeBudgetProgram.programId)
      ? LEGACY_DEFAULT_BUILTIN_COMPUTE_UNITS
      : LEGACY_DEFAULT_PROGRAM_COMPUTE_UNITS;
  }
  return BigInt(Math.min(units, LEGACY_MAX_COMPUTE_UNIT_LIMIT));
}

function normalizeSignedLegacyTransaction(result: unknown, submitted: Transaction, owner: PublicKey): Transaction {
  if (result instanceof Transaction) return result;
  if (result === undefined || result === null) {
    // Some injected providers sign the supplied object in place and resolve
    // without returning it. The independent snapshot and signature checks still
    // decide whether that object is safe to submit.
    if (nonzeroOwnerSignature(submitted, owner)) return submitted;
    throw new Error('Phantom did not return a signed Solana transaction. Nothing was broadcast.');
  }
  if (typeof result === 'object' && 'serialize' in result && typeof result.serialize === 'function') {
    try {
      const serialized = result.serialize({ requireAllSignatures: false, verifySignatures: false });
      if (!ArrayBuffer.isView(serialized)) throw new Error('Invalid transaction serialization.');
      const view = serialized as ArrayBufferView;
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      return Transaction.from(bytes);
    } catch {
      throw new Error('Phantom returned a transaction that could not be parsed safely. Nothing was broadcast.');
    }
  }
  throw new Error('Phantom did not return a serializable signed Solana transaction. Nothing was broadcast.');
}

function legacyMessageMismatchReason(
  actualMessage: Message,
  actualInstructions: readonly TransactionInstruction[],
  owner: PublicKey,
  reviewedInstructions: readonly TransactionInstruction[],
  checkInstructionAccountFlags = true,
  expectedNonceAdvance?: TransactionInstruction,
  enforcePriorityFeeCap = true,
  expectedPrefixInstructions: readonly TransactionInstruction[] = [],
): string | null {
  if (!actualMessage.accountKeys[0]?.equals(owner)) return 'fee payer changed';

  let sawComputeUnitLimit = false;
  let sawComputeUnitPrice = false;
  let requestedComputeUnitLimit: number | undefined;
  let requestedComputeUnitPrice: bigint | undefined;
  const actualComputeInstructions: TransactionInstruction[] = [];
  const nonComputeInstructions: TransactionInstruction[] = [];

  for (const instruction of actualInstructions) {
    if (!instruction.programId.equals(ComputeBudgetProgram.programId)) {
      nonComputeInstructions.push(instruction);
      continue;
    }
    actualComputeInstructions.push(instruction);
    if (instruction.keys.length !== 0 || instruction.data.length === 0) return 'unsupported Compute Budget instruction';
    const tag = instruction.data[0];
    if (tag === 2 && instruction.data.length === 5 && !sawComputeUnitLimit) {
      const units = new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength).getUint32(1, true);
      if (units < 1 || units > LEGACY_MAX_COMPUTE_UNIT_LIMIT) return 'Compute Unit limit exceeds the accepted cap';
      requestedComputeUnitLimit = units;
      sawComputeUnitLimit = true;
    } else if (tag === 3 && instruction.data.length === 9 && !sawComputeUnitPrice) {
      const microLamports = new DataView(instruction.data.buffer, instruction.data.byteOffset, instruction.data.byteLength).getBigUint64(1, true);
      requestedComputeUnitPrice = microLamports;
      sawComputeUnitPrice = true;
    } else {
      return 'unsupported or duplicate Compute Budget instruction';
    }
  }

  if (expectedNonceAdvance) {
    const actualAdvance = actualInstructions[0];
    if (!actualAdvance || !actualAdvance.programId.equals(expectedNonceAdvance.programId) ||
        !equalBytes(actualAdvance.data, expectedNonceAdvance.data) || actualAdvance.keys.length !== expectedNonceAdvance.keys.length ||
        !actualAdvance.keys.every((key, index) => {
          const expected = expectedNonceAdvance.keys[index];
          return key.pubkey.equals(expected.pubkey) && (!checkInstructionAccountFlags ||
            (key.isSigner === expected.isSigner && key.isWritable === expected.isWritable));
        })) return 'durable nonce advance instruction changed or moved';
  }

  const feeComputeUnitLimit = requestedComputeUnitLimit === undefined
    ? defaultLegacyComputeUnitLimit(actualInstructions)
    : BigInt(requestedComputeUnitLimit);
  if (enforcePriorityFeeCap && requestedComputeUnitPrice !== undefined &&
      (requestedComputeUnitPrice * feeComputeUnitLimit + 999_999n) / 1_000_000n > LEGACY_MAX_PRIORITY_FEE_LAMPORTS) {
    return 'Phantom priority fee exceeds the accepted cap';
  }

  const appInstructions = nonComputeInstructions.slice(expectedNonceAdvance ? 1 : 0);
  const actualPrefix = appInstructions.slice(0, expectedPrefixInstructions.length);
  const capsuleInstructions = appInstructions.slice(expectedPrefixInstructions.length);

  if (actualPrefix.length !== expectedPrefixInstructions.length ||
      !actualPrefix.every((actual, index) => {
        const expected = expectedPrefixInstructions[index];
        return actual.programId.equals(expected.programId) && equalBytes(actual.data, expected.data) &&
          actual.keys.length === expected.keys.length && actual.keys.every((key, keyIndex) => {
            const expectedKey = expected.keys[keyIndex];
            return key.pubkey.equals(expectedKey.pubkey) && (!checkInstructionAccountFlags ||
              (key.isSigner === expectedKey.isSigner && key.isWritable === expectedKey.isWritable));
          });
      }) || capsuleInstructions.length !== reviewedInstructions.length ||
      !capsuleInstructions.every((actual, index) => {
        const reviewed = reviewedInstructions[index];
        return Boolean(reviewed) && actual.programId.equals(reviewed.programId) && equalBytes(actual.data, reviewed.data) &&
          actual.keys.length === reviewed.keys.length && actual.keys.every((key, keyIndex) => {
            const expected = reviewed.keys[keyIndex];
            return key.pubkey.equals(expected.pubkey) && (!checkInstructionAccountFlags ||
              (key.isSigner === expected.isSigner && key.isWritable === expected.isWritable));
          });
      })) return 'application instruction changed, was added, or was omitted';

  const expectedMessage = new Transaction({ feePayer: owner, recentBlockhash: actualMessage.recentBlockhash })
    .add(
      ...(expectedNonceAdvance ? [expectedNonceAdvance] : []),
      ...actualComputeInstructions,
      ...expectedPrefixInstructions,
      ...reviewedInstructions,
    ).compileMessage();

  const expectedKeys = new Set(expectedMessage.accountKeys.map((key) => key.toBase58()));
  const extraKeys = actualMessage.accountKeys.filter((key) => !expectedKeys.has(key.toBase58()));
  if (!extraKeys.every((key) => key.equals(ComputeBudgetProgram.programId))) return 'unexpected account was added';
  const expectedPrivilegesMatch = expectedMessage.accountKeys.every((key, expectedIndex) => {
    const actualIndex = actualMessage.accountKeys.findIndex((actual) => actual.equals(key));
    return actualIndex >= 0 && expectedMessage.isAccountSigner(expectedIndex) === actualMessage.isAccountSigner(actualIndex) &&
      expectedMessage.isAccountWritable(expectedIndex) === actualMessage.isAccountWritable(actualIndex);
  }) && extraKeys.every((key) => {
    const actualIndex = actualMessage.accountKeys.findIndex((actual) => actual.equals(key));
    return actualIndex >= 0 && !actualMessage.isAccountSigner(actualIndex) && !actualMessage.isAccountWritable(actualIndex);
  });
  return expectedPrivilegesMatch ? null : 'account signer or writable privileges changed';
}

function toKitInstruction(instruction: TransactionInstruction) {
  return {
    programAddress: address(instruction.programId.toBase58()),
    accounts: instruction.keys.map((key) => ({
      address: address(key.pubkey.toBase58()),
      role: key.isSigner
        ? key.isWritable ? AccountRole.WRITABLE_SIGNER : AccountRole.READONLY_SIGNER
        : key.isWritable ? AccountRole.WRITABLE : AccountRole.READONLY,
    })),
    data: new Uint8Array(instruction.data),
  };
}

function buildV1Message(owner: PublicKey, instruction: TransactionInstruction | TransactionInstruction[], lifetime: { blockhash: string; lastValidBlockHeight: number }) {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (message) => setTransactionMessageFeePayer(address(owner.toBase58()), message),
    (message) => setTransactionMessageLifetimeUsingBlockhash({
      blockhash: lifetime.blockhash as never,
      lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight),
    }, message),
  );
  return appendTransactionMessageInstructions((Array.isArray(instruction) ? instruction : [instruction]).map(toKitInstruction), message);
}

async function prepareV1Transaction(params: {
  owner: PublicKey;
  instruction: TransactionInstruction | TransactionInstruction[];
  connection: Connection;
  rpcUrl?: string;
  reviewedBlockhash?: Awaited<ReturnType<Connection['getLatestBlockhashAndContext']>>;
  computeUnitLimit?: number;
  loadedAccountsDataSizeLimit?: number;
}) {
  const rpc = createSolanaRpc(resolveSolanaRpcUrl(params.rpcUrl));
  const lifetimeResult = params.reviewedBlockhash ?? await getFreshReviewBlockhash(params.connection);
  const lifetime = lifetimeResult.value;
  const baseMessage = buildV1Message(params.owner, params.instruction, lifetime);
  let computeUnitLimit = params.computeUnitLimit;
  let loadedAccountsDataSizeLimit = params.loadedAccountsDataSizeLimit;
  if (computeUnitLimit === undefined || loadedAccountsDataSizeLimit === undefined) {
    const estimate = await estimateResourceLimitsFactory({ rpc })(baseMessage, { commitment: 'confirmed' });
    computeUnitLimit = Math.min(1_400_000, Math.max(1, Math.ceil(estimate.computeUnitLimit * 1.15)));
    const estimatedLoadedBytes = estimate.loadedAccountsDataSizeLimit ?? V1_LOADED_ACCOUNT_PAGE_BYTES;
    loadedAccountsDataSizeLimit = Math.min(
      64 * 1024 * 1024,
      Math.max(V1_LOADED_ACCOUNT_PAGE_BYTES, Math.ceil(estimatedLoadedBytes / V1_LOADED_ACCOUNT_PAGE_BYTES) * V1_LOADED_ACCOUNT_PAGE_BYTES),
    );
  }
  const message = setTransactionMessageConfig({ computeUnitLimit, loadedAccountsDataSizeLimit, priorityFeeLamports: 1_000n }, baseMessage);
  const transaction = compileTransaction(message);
  const wireBytes = getTransactionEncoder().encode(transaction);
  if (wireBytes.length > V1_TRANSACTION_LIMIT) throw new Error(`The v1 transaction is ${wireBytes.length} bytes, above the ${V1_TRANSACTION_LIMIT}-byte limit.`);
  return {
    transaction, wireBytes: new Uint8Array(wireBytes), messageBytes: new Uint8Array(transaction.messageBytes),
    lifetime, minContextSlot: lifetimeResult.context.slot, computeUnitLimit, loadedAccountsDataSizeLimit,
  };
}

async function estimateV1Fee(rpcUrl: string | undefined, transaction: Awaited<ReturnType<typeof prepareV1Transaction>>['transaction']): Promise<bigint> {
  const rpc = createSolanaRpc(resolveSolanaRpcUrl(rpcUrl));
  const response = await rpc.getFeeForMessage(base64Encode(new Uint8Array(transaction.messageBytes)) as never, { commitment: 'confirmed' }).send();
  if (response.value === null) throw new Error('Devnet could not estimate the v1 transaction fee.');
  return BigInt(response.value);
}

interface SignedV1BatchItem {
  bytes: Uint8Array;
  signature: string;
  lifetime: { blockhash: string; lastValidBlockHeight: number };
}

/** One Phantom wallet-standard request signs a short ordered group of v1 writes. */
async function signV1TransactionBatch(
  connection: Connection,
  provider: PhantomSolanaProvider,
  walletSigner: PhantomWalletStandardSigner,
  owner: string,
  instructionSets: readonly (readonly TransactionInstruction[])[],
  onStatus: ((status: string) => void) | undefined,
  resourceLimits: { computeUnitLimit: number; loadedAccountsDataSizeLimit: number },
): Promise<{ signed: SignedV1BatchItem[]; minContextSlot: number }> {
  const activeAddress = provider.publicKey?.toBase58?.() ?? provider.publicKey?.toString?.();
  if (!activeAddress || solanaPublicKey(activeAddress).toBase58() !== owner || walletSigner.account.address !== owner) {
    throw new Error('Phantom account changed during the upload. Reconnect the original Solana account and resume.');
  }
  if (!instructionSets.length || instructionSets.length > V1_SIGNING_BATCH_SIZE) {
    throw new Error('Invalid v1 wallet signing batch size. Reopen the cost review before signing.');
  }

  const reviewedBlockhash = await getFreshReviewBlockhash(connection);
  const prepared = await Promise.all(instructionSets.map((instruction) => prepareV1Transaction({
    owner: solanaPublicKey(owner), instruction: [...instruction], connection,
    reviewedBlockhash, ...resourceLimits,
  })));
  onStatus?.(`Opening Phantom once to review ${prepared.length} Solana write transactions. Each still pays its own network fee.`);
  let outputs: readonly SolanaSignTransactionOutput[];
  try {
    outputs = await requestSolanaWallet(provider, () => walletSigner.signTransaction(...prepared.map((entry) => ({
      account: walletSigner.account,
      transaction: entry.wireBytes,
      chain: 'solana:devnet' as const,
    }))));
  } catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'number' ? cause.code : null;
    if (code === 4001) throw new Error('The Phantom batch review was rejected. No transaction in this batch was broadcast.');
    throw new Error(`Phantom could not approve the Solana write batch${code === null ? '' : ` (code ${code})`}: ${formatSolanaError(cause, 'Unexpected wallet error.')} No transaction in this batch was broadcast.`);
  }
  if (!Array.isArray(outputs) || outputs.length !== prepared.length) {
    throw new Error('Phantom did not sign the complete Solana write batch. No transaction in this batch was broadcast.');
  }

  const verificationKey = await crypto.subtle.importKey('raw', solanaPublicKey(owner).toBytes().slice().buffer as ArrayBuffer,
    { name: 'Ed25519' }, false, ['verify']);
  const signed = await Promise.all(prepared.map(async (entry, index) => {
    const bytes = new Uint8Array(outputs[index].signedTransaction);
    if (bytes.length !== entry.wireBytes.length || !equalBytes(bytes.subarray(0, entry.messageBytes.length), entry.messageBytes)) {
      throw new Error(`Phantom changed transaction ${index + 1} in the reviewed Solana write batch. Nothing from this batch was broadcast.`);
    }
    const signatureBytes = bytes.subarray(entry.messageBytes.length);
    if (signatureBytes.length !== 64 || signatureBytes.every((byte) => byte === 0) ||
        !await crypto.subtle.verify('Ed25519', verificationKey, signatureBytes.slice().buffer as ArrayBuffer,
          entry.messageBytes.slice().buffer as ArrayBuffer)) {
      throw new Error(`Phantom returned an invalid signature for transaction ${index + 1} in the Solana write batch. Nothing from this batch was broadcast.`);
    }
    return { bytes, signature: encodeBase58(signatureBytes), lifetime: entry.lifetime };
  }));
  return { signed, minContextSlot: reviewedBlockhash.context.slot };
}

function maxLegacyChunkBytes(owner: PublicKey, capsule: PublicKey, nonceInstruction?: TransactionInstruction): number {
  for (let size = 1_050; size >= 400; size -= 1) {
    const data = new Uint8Array(8 + 4 + 4 + size);
    const instruction = writeInstruction(owner, capsule, data);
    if (legacyMessageSize(owner, ...(nonceInstruction ? [nonceInstruction] : []), ...legacyComputeBudgetReservations(), instruction) <= LEGACY_TRANSACTION_LIMIT) return size;
  }
  throw new Error('Could not fit a Solana data chunk into a standard wallet transaction.');
}

interface LegacyUploadBatch {
  instructions: TransactionInstruction[];
  payloadEnd: number;
  titleEnd: number;
  phase: 'begin' | 'payload' | 'title' | 'finalize';
}

// Pack sequential program instructions by their serialized wire size. A failed
// batch changes no capsule offsets, so the same planner also works on resume.
export async function planLegacyUpload(params: {
  owner: PublicKey;
  capsule: PublicKey;
  feeRecipient: PublicKey;
  capsuleId: string;
  unlockAt: number;
  mode: CapsuleMode;
  formatVersion?: 1 | 2;
  payload: Uint8Array;
  payloadHash: Uint8Array;
  title: Uint8Array;
  includeBegin: boolean;
  payloadOffset: number;
  titleOffset: number;
  maxChunkBytes: number;
  nonceAdvanceInstruction?: TransactionInstruction;
  firstTransactionPrefixInstructions?: TransactionInstruction[];
  feeReview?: SolanaProtocolFeeReview;
}): Promise<LegacyUploadBatch[]> {
  if (params.formatVersion !== undefined && params.formatVersion !== 1 && params.formatVersion !== 2) {
    throw new Error('Unsupported Solana Capsule format version.');
  }
  if (params.formatVersion === 2 && params.mode !== 'private') {
    throw new Error('Solana Capsule V2 is restricted to private mode.');
  }
  const batches: LegacyUploadBatch[] = [];
  let instructions: TransactionInstruction[] = [];
  let payloadOffset = params.payloadOffset;
  let titleOffset = params.titleOffset;
  let phase: LegacyUploadBatch['phase'] = 'begin';
  const fits = (...candidate: TransactionInstruction[]) => {
    try {
      return legacyMessageSize(params.owner, ...(params.nonceAdvanceInstruction ? [params.nonceAdvanceInstruction] : []),
        ...(batches.length === 0 ? params.firstTransactionPrefixInstructions ?? [] : []),
        ...legacyComputeBudgetReservations(), ...candidate) <= LEGACY_TRANSACTION_LIMIT;
    }
    catch (cause) {
      // web3.js's legacy message encoder throws before returning oversized wires.
      if (cause instanceof RangeError) return false;
      throw cause;
    }
  };
  const flush = () => {
    if (instructions.length) batches.push({ instructions, payloadEnd: payloadOffset, titleEnd: titleOffset, phase });
    instructions = [];
  };
  const finalize = finalizeInstruction(
    params.owner, params.capsule, params.feeRecipient, await buildInstructionData('finalize_capsule'), params.feeReview,
  );

  // Fast single-transaction path:
  // If begin (if needed) + ALL payload + ALL title + finalize can fit together in 1 transaction,
  // execute atomically in one transaction with one wallet approval.
  if (params.includeBegin && payloadOffset === 0 && titleOffset === 0) {
    const beginData = await buildBeginData({
      capsuleId: params.capsuleId, unlockAt: params.unlockAt, mode: params.mode,
      formatVersion: params.formatVersion,
      payloadBytes: params.payload, payloadHash: params.payloadHash, titleBytes: params.title,
    });
    const candidateList = [
      beginInstruction(params.owner, params.capsule, beginData),
      ...(params.payload.length > 0 ? [writeInstruction(params.owner, params.capsule, await buildWriteData('write_chunk', 0, params.payload))] : []),
      ...(params.title.length > 0 ? [writeInstruction(params.owner, params.capsule, await buildWriteData('write_title_chunk', 0, params.title))] : []),
      finalize,
    ];
    if (fits(...candidateList)) {
      batches.push({
        instructions: candidateList,
        payloadEnd: params.payload.length,
        titleEnd: params.title.length,
        phase: 'finalize',
      });
      return batches;
    }
  }

  if (params.includeBegin) {
    const beginData = await buildBeginData({
      capsuleId: params.capsuleId, unlockAt: params.unlockAt, mode: params.mode,
      formatVersion: params.formatVersion,
      payloadBytes: params.payload, payloadHash: params.payloadHash, titleBytes: params.title,
    });
    instructions.push(beginInstruction(params.owner, params.capsule, beginData));
  }
  for (const part of [
    { bytes: params.payload, name: 'write_chunk' as const, phase: 'payload' as const },
    { bytes: params.title, name: 'write_title_chunk' as const, phase: 'title' as const },
  ]) {
    let offset = part.name === 'write_chunk' ? payloadOffset : titleOffset;
    while (offset < part.bytes.length) {
      const available = Math.min(part.bytes.length - offset, params.maxChunkBytes);
      const overhead = part.name === 'write_chunk' ? 16 : 14;
      let low = 0;
      let high = available;
      while (low < high) {
        const size = Math.ceil((low + high) / 2);
        const candidate = writeInstruction(params.owner, params.capsule, new Uint8Array(overhead + size));
        if (fits(...instructions, candidate)) low = size;
        else high = size - 1;
      }
      if (low === 0) {
        if (!instructions.length) throw new Error('A data chunk cannot fit in a standard Solana transaction.');
        flush();
        continue;
      }
      const chunk = part.bytes.subarray(offset, offset + low);
      const instruction = writeInstruction(params.owner, params.capsule, await buildWriteData(part.name, offset, chunk));
      instructions.push(instruction);
      offset += low;
      if (part.name === 'write_chunk') payloadOffset = offset;
      else titleOffset = offset;
      phase = part.phase;
    }
  }
  if (!fits(...instructions, finalize)) flush();
  if (!fits(...instructions, finalize)) throw new Error('Finalize cannot fit in a standard Solana transaction.');
  instructions.push(finalize);
  phase = 'finalize';
  flush();
  return batches;
}

export async function planAtomicV1Upload(params: {
  owner: PublicKey; capsule: PublicKey; feeRecipient: PublicKey; capsuleId: string;
  unlockAt: number; mode: CapsuleMode; payload: Uint8Array; payloadHash: Uint8Array; title: Uint8Array;
  feeReview?: SolanaProtocolFeeReview;
}): Promise<TransactionInstruction[] | null> {
  if (params.payload.length > V1_WRITE_CHUNK_BYTES || params.title.length > V1_WRITE_CHUNK_BYTES) return null;
  const instructions = [
    beginInstruction(params.owner, params.capsule, await buildBeginData({ ...params,
      payloadBytes: params.payload, titleBytes: params.title })),
    writeInstruction(params.owner, params.capsule, await buildWriteData('write_chunk', 0, params.payload)),
    ...(params.title.length ? [writeInstruction(params.owner, params.capsule, await buildWriteData('write_title_chunk', 0, params.title))] : []),
    finalizeInstruction(params.owner, params.capsule, params.feeRecipient, await buildInstructionData('finalize_capsule'), params.feeReview),
  ];
  const message = setTransactionMessageConfig({ computeUnitLimit: LEGACY_MAX_COMPUTE_UNIT_LIMIT, priorityFeeLamports: 1_000n,
    loadedAccountsDataSizeLimit: 64 * 1024 * 1024 }, buildV1Message(params.owner, instructions,
    { blockhash: SOLANA_PROGRAM_ID, lastValidBlockHeight: 1 }));
  return getTransactionEncoder().encode(compileTransaction(message)).length <= V1_TRANSACTION_LIMIT ? instructions : null;
}

async function estimateSingleSignatureFee(connection: Connection, owner: PublicKey, ...instructions: TransactionInstruction[]): Promise<bigint> {
  const blockhash = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: owner, recentBlockhash: blockhash.blockhash }).add(...instructions);
  const fee = await connection.getFeeForMessage(tx.compileMessage(), 'confirmed');
  if (fee.value === null) throw new Error('Devnet could not estimate the transaction fee. Retry the cost review when the RPC is available.');
  return BigInt(fee.value);
}

export async function sendSignedTransactionWithFreshContext(
  connection: Connection,
  signedBytes: Uint8Array,
  options: { maxRetries: number; preflightCommitment: Commitment; minContextSlot: number },
): Promise<string> {
  // Public Devnet RPCs may load-balance consecutive requests across validators.
  // Keep the transaction tied to the slot that supplied its blockhash, and retry
  // only a preflight BlockhashNotFound response with the exact same signed bytes.
  // A rejected preflight is not submitted, and reusing the same signature cannot
  // create a second charge if an RPC response was ambiguous.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await connection.sendRawTransaction(signedBytes, { ...options, skipPreflight: false });
    } catch (cause) {
      if (!isPreflightBlockhashNotFound(cause) || attempt >= 2) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
}

function encodeBase58(bytes: Uint8Array): string {
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

function clearPendingSignature(draft: SolanaUploadDraft): void {
  delete draft.pendingSignature;
  delete draft.pendingLastValidBlockHeight;
  delete draft.pendingPhase;
  delete draft.pendingNonce;
  delete draft.pendingBlockhash;
}

function pendingUploadCallbacks(
  draft: SolanaUploadDraft,
  phase: NonNullable<SolanaUploadDraft['pendingPhase']>,
): {
  onSigned: (signature: string, lastValidBlockHeight: number, nonce?: SolanaUploadDraft['pendingNonce'], refreshedBlockhash?: string) => void;
  onDefinitelyRejected: () => void;
} {
  return {
    onSigned: (signature, lastValidBlockHeight, nonce, refreshedBlockhash) => {
      draft.pendingSignature = signature;
      draft.pendingLastValidBlockHeight = lastValidBlockHeight;
      draft.pendingPhase = phase;
      draft.pendingNonce = nonce;
      draft.pendingBlockhash = refreshedBlockhash;
      savePendingDraft(draft);
    },
    onDefinitelyRejected: () => {
      clearPendingSignature(draft);
      savePendingDraft(draft);
    },
  };
}

export async function reconcilePendingSubmission(
  connection: Connection,
  draft: SolanaUploadDraft,
): Promise<'none' | 'confirmed' | 'failed' | 'expired'> {
  if (!draft.pendingSignature || !Number.isInteger(draft.pendingLastValidBlockHeight)) return 'none';
  const signature = draft.pendingSignature;
  const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
  let status = statuses.value[0];
  if (!status && draft.pendingBlockhash && !draft.pendingNonce) {
    const validity = await connection.isBlockhashValid(draft.pendingBlockhash, { commitment: 'confirmed' });
    if (validity.value) throw new Error('A previously signed transaction may still be processing. No new wallet request was sent. Resume checks its saved signature.');
    const reconciled = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    status = reconciled.value[0];
    if (!status) { clearPendingSignature(draft); return 'expired'; }
  }
  if (!status) {
    if (draft.pendingNonce || draft.pendingLastValidBlockHeight === 0 || draft.pendingLastValidBlockHeight === Number.MAX_SAFE_INTEGER) {
      throw new Error('Phantom may have submitted the previous transaction. No new wallet request was sent. Resume can continue only after its signature is found or the pending submission is independently checked.');
    }
    const blockHeight = await connection.getBlockHeight('confirmed');
    if (blockHeight <= draft.pendingLastValidBlockHeight!) {
      throw new Error('A previously signed transaction may still be processing. No new wallet request was sent. Wait for its blockhash to expire, then resume to check again.');
    }
    // A status read may lag the bank used for block height. Resolve that race
    // before dropping the only record of a transaction that could have landed.
    const finalRead = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    status = finalRead.value[0];
    if (!status) { clearPendingSignature(draft); return 'expired'; }
  }

  const confirmation = status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'
    ? { value: { err: status.err } }
    : await confirmSolanaTransaction(connection, signature);
  if (confirmation.value.err) {
    clearPendingSignature(draft);
    return 'failed';
  }
  draft.lastSignature = signature;
  if (draft.pendingPhase === 'begin') draft.beginSignature = signature;
  clearPendingSignature(draft);
  return 'confirmed';
}

export async function assertBlockhashHasSubmissionWindow(
  connection: Connection,
  lifetime: { lastValidBlockHeight: number },
  reviewStartedAt?: number,
): Promise<void> {
  // A wallet review can outlast a recent blockhash. The signed transaction is
  // still valid through lastValidBlockHeight, so do not discard it early based
  // on an arbitrary safety margin; the RPC preflight handles a just-expired hash.
  const currentHeight = await connection.getBlockHeight('confirmed');
  if (currentHeight > lifetime.lastValidBlockHeight) {
    const reviewSeconds = reviewStartedAt === undefined ? null : Math.max(0, Math.round((Date.now() - reviewStartedAt) / 1000));
    const duration = reviewSeconds === null ? '' : ` Wallet review and response took about ${reviewSeconds} seconds.`;
    throw new Error(`The Phantom review outlasted this Solana transaction.${duration} Devnet block height ${currentHeight} is past its last valid height ${lifetime.lastValidBlockHeight}; nothing was submitted. Select Resume to review a fresh transaction.`);
  }
}

export async function getFreshReviewBlockhash(
  connection: Connection,
  minimumRemainingBlocks = LEGACY_MIN_REVIEW_BLOCKHASH_WINDOW,
): Promise<Awaited<ReturnType<Connection['getLatestBlockhashAndContext']>>> {
  let minContextSlot: number | undefined;
  let remaining = -1;
  for (let attempt = 0; attempt < LEGACY_BLOCKHASH_REFRESH_ATTEMPTS; attempt += 1) {
    const [latest, currentHeight] = await Promise.all([
      connection.getLatestBlockhashAndContext({
        commitment: 'confirmed',
        ...(minContextSlot === undefined ? {} : { minContextSlot }),
      }),
      connection.getBlockHeight('confirmed'),
    ]);
    remaining = latest.value.lastValidBlockHeight - currentHeight;
    if (remaining >= minimumRemainingBlocks) return latest;
    minContextSlot = Math.max(minContextSlot ?? 0, latest.context.slot);
    if (attempt + 1 < LEGACY_BLOCKHASH_REFRESH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw new Error(`The configured Devnet RPC returned a stale blockhash with only ${remaining} blocks left for wallet review. No Phantom request was opened and no transaction was sent. Retry after the RPC catches up.`);
}

function isPreflightBlockhashNotFound(cause: unknown): boolean {
  const message = getSafeErrorMessage(cause) || (typeof cause === 'string' ? cause : '');
  return /simulation failed[\s\S]*blockhash not found/i.test(message);
}

function assertUploadWindow(unlockAt: number, minLockDuration: number, remainingTransactions: number): void {
  const requiredSeconds = minLockDuration + remainingTransactions * 15;
  if (unlockAt <= Math.floor(Date.now() / 1000) + requiredSeconds) {
    throw new Error(`The unlock target is too close to finish the remaining ${remainingTransactions} confirmations. Cancel this partial upload and choose a later target.`);
  }
}

export async function createSolanaSealQuote(params: {
  owner: string;
  payloadBytes: Uint8Array;
  mode: CapsuleMode;
  publicTitle?: string;
  capsuleId?: string;
  unlockAt: number;
  rpcUrl?: string;
  legacySubmissionPreference?: 'phantom' | 'app-signed' | 'app-batch' | 'durable-nonce';
}): Promise<SolanaSealQuote> {
  const payload = new Uint8Array(params.payloadBytes);
  if (payload.length === 0 || payload.length > SOLANA_MAX_PAYLOAD_SIZE) throw new Error('Encrypted payload must be between 1 and 65,536 bytes.');
  const titleBytes = params.mode === 'public' ? new TextEncoder().encode(params.publicTitle?.normalize('NFC').trim() ?? '') : new Uint8Array();
  if (params.mode === 'public' && (!titleBytes.length || titleBytes.length > SOLANA_MAX_TITLE_BYTES ||
      Array.from(new TextDecoder().decode(titleBytes)).length > SOLANA_MAX_TITLE_CHARACTERS)) {
    throw new Error('Public title must be 1–512 characters and no more than 2,048 UTF-8 bytes.');
  }
  assertSolanaSafeRecordSize(payload.length, titleBytes.length);
  const owner = solanaPublicKey(params.owner);
  const connection = createSolanaConnection(params.rpcUrl);
  const { config, feeReview: protocolFeeReview } = await readProgramAndConfig(connection, SOLANA_PROGRAM_ID, true);
  const feeReview = protocolFeeReview!;
  if (!Number.isSafeInteger(params.unlockAt) || params.unlockAt <= Math.floor(Date.now() / 1000) + config.minLockDuration) {
    throw new Error(`Choose an unlock time more than ${config.minLockDuration} seconds from the current Devnet time.`);
  }
  if (payload.length > config.maxPayloadSize) throw new Error(`Current Devnet Config allows ${config.maxPayloadSize.toLocaleString()} encrypted bytes; this capsule is ${payload.length.toLocaleString()} bytes.`);
  const payloadHashHex = await sha256Hex(payload);
  const payloadHash = Uint8Array.from(payloadHashHex.slice(2).match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  let capsuleId = params.capsuleId ?? randomCapsuleId();
  let capsule = deriveSolanaCapsulePda(owner.toBase58(), capsuleId);
  let existingCapsuleInfo = await connection.getAccountInfo(capsule, 'confirmed');
  if (!params.capsuleId) {
    for (let attempt = 0; attempt < 5 && existingCapsuleInfo; attempt += 1) {
      capsuleId = randomCapsuleId();
      capsule = deriveSolanaCapsulePda(owner.toBase58(), capsuleId);
      existingCapsuleInfo = await connection.getAccountInfo(capsule, 'confirmed');
    }
    if (existingCapsuleInfo) throw new Error('Could not reserve a fresh Capsule PDA. Please retry.');
  }
  let transactionVersion: SolanaSealQuote['transactionVersion'] = 'legacy';
  let fallbackReason: string | undefined;
  let chunkBytes = maxLegacyChunkBytes(owner, capsule);
  let transactionCount = 2 + Math.ceil(payload.length / chunkBytes) + Math.ceil(titleBytes.length / chunkBytes);
  let v1ComputeUnitLimit: number | undefined;
  let v1LoadedAccountsDataSizeLimit: number | undefined;
  let v1WriteFee: bigint | undefined;
  const v1Signer = getPhantomV1Signer(owner.toBase58());
  if (v1Signer) {
    try {
      // The Capsule PDA does not exist until the first wallet confirmation, so a
      // simulated write would fail before the user could see a usable quote.
      // Probe v1 support with a zero-value self-transfer, then simulate each real
      // write against the initialized PDA immediately before its signature.
      const probe = SystemProgram.transfer({ fromPubkey: owner, toPubkey: owner, lamports: 0 });
      const prepared = await prepareV1Transaction({
        owner,
        instruction: probe,
        connection,
        rpcUrl: params.rpcUrl,
        computeUnitLimit: 1_400_000,
        loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
      });
      v1WriteFee = await estimateV1Fee(params.rpcUrl, prepared.transaction);
      transactionVersion = 'v1';
      chunkBytes = V1_WRITE_CHUNK_BYTES;
      transactionCount = 2 + Math.ceil(payload.length / chunkBytes) + Math.ceil(titleBytes.length / chunkBytes);
      v1ComputeUnitLimit = prepared.computeUnitLimit;
      v1LoadedAccountsDataSizeLimit = prepared.loadedAccountsDataSizeLimit;
    } catch {
      fallbackReason = 'Phantom v1 signing or Devnet v1 simulation was unavailable; using standard transactions.';
    }
  } else {
    fallbackReason = 'This connected Phantom account does not advertise Solana v1 signing; using standard transactions.';
  }
  const injectedProvider = typeof window === 'undefined' ? null : getPhantomSolanaProvider(window as unknown as Parameters<typeof getPhantomSolanaProvider>[0]);
  const injectedAddress = injectedProvider?.publicKey?.toBase58?.() ?? injectedProvider?.publicKey?.toString?.();
  const defaultLegacySubmission = chooseDefaultLegacySubmission({
    ownerMatches: injectedAddress === owner.toBase58(),
    canSign: typeof injectedProvider?.signTransaction === 'function',
    canWalletSend: typeof injectedProvider?.signAndSendTransaction === 'function',
    canSignAll: typeof injectedProvider?.signAllTransactions === 'function',
  });
  const legacySubmission: SolanaSealQuote['legacySubmission'] = transactionVersion === 'legacy'
    ? params.legacySubmissionPreference ?? (defaultLegacySubmission === 'phantom' && typeof injectedProvider?.signTransaction === 'function'
      ? 'app-signed'
      : defaultLegacySubmission)
    : undefined;
  const nonceAddress = await deriveSolanaDevnetNonceAddress(owner);
  const nonceAdvance = nonceAdvanceInstruction(owner, nonceAddress);
  const nonceState = legacySubmission === 'durable-nonce' ? await readSolanaDevnetNonce(connection, owner) : null;
  const nonceSetupRequired = legacySubmission === 'durable-nonce' && !nonceState?.account;
  const nonceAccountRentLamports = nonceSetupRequired
    ? BigInt(await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH, 'confirmed'))
    : 0n;
  const nonceSetupInstructions = nonceSetupRequired ? SystemProgram.createNonceAccount({
    fromPubkey: owner, noncePubkey: nonceAddress, basePubkey: owner,
    seed: DEVNET_NONCE_SEED, lamports: Number(nonceAccountRentLamports), authorizedPubkey: owner,
  }).instructions : [];
  if (transactionVersion === 'legacy') chunkBytes = maxLegacyChunkBytes(owner, capsule, legacySubmission === 'durable-nonce' ? nonceAdvance : undefined);
  let beginTransactionCount = 1;
  let uploadedPayloadBytes = 0;
  let uploadedTitleBytes = 0;
  if (existingCapsuleInfo) {
    if (!existingCapsuleInfo.owner.equals(solanaPublicKey(SOLANA_PROGRAM_ID))) throw new Error('The selected Capsule PDA is owned by a different program.');
    const existing = decodeSolanaCapsule(new Uint8Array(existingCapsuleInfo.data));
    if (existing.owner !== owner.toBase58() || existing.capsuleId !== capsuleId ||
        existing.payloadHash.toLowerCase() !== payloadHashHex.toLowerCase() || existing.unlockAt !== params.unlockAt || existing.mode !== params.mode ||
        existing.expectedPayloadLen !== payload.length || existing.expectedTitleLen !== titleBytes.length) {
      throw new Error('The existing Capsule PDA does not match this encrypted upload draft.');
    }
    if (existing.state === 'final') throw new Error('This capsule is already finalized. Use Direct Recovery with its Capsule PDA.');
    if (existing.expiresAt < Math.floor(Date.now() / 1000)) throw new Error('This partial upload expired on chain. Cancel it before creating a replacement.');
    beginTransactionCount = 0;
    uploadedPayloadBytes = existing.uploadedPayloadLen;
    uploadedTitleBytes = existing.uploadedTitleLen;
  }
  const remainingPayloadChunks = Math.ceil((payload.length - uploadedPayloadBytes) / chunkBytes);
  const remainingTitleChunks = Math.ceil((titleBytes.length - uploadedTitleBytes) / chunkBytes);
  const legacyBatches = transactionVersion === 'legacy' ? await planLegacyUpload({
    feeReview,
    owner, capsule, feeRecipient: solanaPublicKey(config.feeRecipient), capsuleId,
    unlockAt: params.unlockAt, mode: params.mode, payload, payloadHash, title: titleBytes,
    includeBegin: beginTransactionCount === 1, payloadOffset: uploadedPayloadBytes,
    titleOffset: uploadedTitleBytes, maxChunkBytes: chunkBytes,
    nonceAdvanceInstruction: legacySubmission === 'durable-nonce' ? nonceAdvance : undefined,
    firstTransactionPrefixInstructions: [],
  }) : null;
  const atomicV1 = transactionVersion === 'v1' && beginTransactionCount === 1 && Boolean(await planAtomicV1Upload({
    feeReview,
    owner, capsule, feeRecipient: solanaPublicKey(config.feeRecipient), capsuleId, unlockAt: params.unlockAt,
    mode: params.mode, payload, payloadHash, title: titleBytes,
  }));
  const capsuleTransactionCount = atomicV1 ? 1 : legacyBatches?.length ?? beginTransactionCount + remainingPayloadChunks + remainingTitleChunks + 1;
  // Bootstrap the reusable nonce in a small standalone transaction. Combining
  // it with a Capsule write made the first Phantom review complex and exposed
  // the whole upload to a recent-blockhash deadline.
  const nonceSetupInFirstTransaction = false;
  transactionCount = capsuleTransactionCount + (nonceSetupRequired ? 1 : 0);
  if (transactionCount < 1) throw new Error('There are no remaining Solana upload transactions. Use Direct Recovery with its Capsule PDA.');
  const minimumUploadWindowSeconds = config.minLockDuration + transactionCount * 15;
  if (params.unlockAt <= Math.floor(Date.now() / 1000) + minimumUploadWindowSeconds) {
    throw new Error(`Choose an unlock time at least ${minimumUploadWindowSeconds} seconds from now so the reviewed upload can finish before the target time.`);
  }
  const networkFeePromise = legacyBatches ? (async () => {
    // Capsule writes and the optional one-time nonce bootstrap are separate
    // signatures. Estimate each using its actual reviewed instruction set.
    const capsuleInstructions = [
      ...(legacySubmission === 'durable-nonce' ? [nonceAdvance] : []),
      ...legacyBatches[0].instructions,
    ];
    const [capsuleFee, nonceSetupFee] = await Promise.all([
      estimateSingleSignatureFee(connection, owner, ...capsuleInstructions),
      nonceSetupRequired
        ? estimateSingleSignatureFee(connection, owner, ...nonceSetupInstructions)
        : Promise.resolve(0n),
    ]);
    return capsuleFee * BigInt(capsuleTransactionCount) + nonceSetupFee;
  })() : atomicV1 ? Promise.resolve(v1WriteFee!) : (async () => {
    const beginData = await buildBeginData({ capsuleId, unlockAt: params.unlockAt, mode: params.mode, payloadBytes: payload, payloadHash, titleBytes });
    const beginFee = beginTransactionCount ? await estimateSingleSignatureFee(connection, owner, beginInstruction(owner, capsule, beginData)) : 0n;
    const sampleChunk = new Uint8Array(Math.min(chunkBytes, payload.length));
    const remainingWriteTransactions = remainingPayloadChunks + remainingTitleChunks;
    const writeFee = remainingWriteTransactions === 0
      ? 0n
      : v1WriteFee ?? await estimateSingleSignatureFee(connection, owner, writeInstruction(owner, capsule, await buildWriteData('write_chunk', 0, sampleChunk)));
    const finalizeFee = await estimateSingleSignatureFee(connection, owner, finalizeInstruction(owner, capsule, solanaPublicKey(config.feeRecipient), await buildInstructionData('finalize_capsule'), feeReview));
    return beginFee + writeFee * BigInt(remainingWriteTransactions) + finalizeFee;
  })();
  const totalSpace = SOLANA_ACCOUNT_FIXED_SPACE + payload.length + titleBytes.length;
  const [networkFees, accountRentLamports, ownerBalanceLamports] = await Promise.all([
    networkFeePromise,
    beginTransactionCount ? connection.getMinimumBalanceForRentExemption(totalSpace, 'confirmed').then(BigInt) : Promise.resolve(0n),
    connection.getBalance(owner, 'confirmed').then(BigInt),
  ]);
  return {
    capsuleId, capsulePda: capsule.toBase58(), payloadBytes: payload.length,
    titleBytes: titleBytes.length, maxChunkBytes: chunkBytes, transactionCount, capsuleTransactionCount,
    walletApprovalCount: atomicV1 ? 1 : transactionVersion === 'v1'
      ? Number(beginTransactionCount > 0) + Math.ceil((remainingPayloadChunks + remainingTitleChunks) / V1_SIGNING_BATCH_SIZE) + 1
      : legacySubmission === 'app-batch'
        ? Math.ceil(capsuleTransactionCount / LEGACY_SIGNING_BATCH_SIZE) + Number(nonceSetupRequired)
        : transactionCount,
    nonceAccount: nonceAddress.toBase58(), nonceSetupRequired, nonceSetupInFirstTransaction, nonceAccountRentLamports,
    minimumUploadWindowSeconds, transactionVersion, atomicV1, legacySubmission, fallbackReason,
    computeUnitLimit: v1ComputeUnitLimit, loadedAccountsDataSizeLimit: v1LoadedAccountsDataSizeLimit,
    estimatedNetworkFeeLamports: networkFees,
    maximumPriorityFeeLamports: legacyBatches && legacySubmission !== 'phantom' ? BigInt(transactionCount) * LEGACY_MAX_PRIORITY_FEE_LAMPORTS : undefined,
    accountRentLamports,
    protocolFeeLamports: feeReview.protocolFeeLamports, feeReview, ownerBalanceLamports,
  };
}

function readPendingDraft(): SolanaUploadDraft | null {
  try {
    const raw = localStorage.getItem(SOLANA_UPLOAD_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as SolanaUploadDraft;
    if (draft.schemaVersion !== 1 || draft.cluster !== 'devnet' || draft.programId !== SOLANA_PROGRAM_ID ||
        !draft.owner || !draft.capsuleId || !draft.capsulePda || !draft.payloadBase64) return null;
    return draft;
  } catch {
    return null;
  }
}

export function getPendingSolanaUpload(owner?: string): SolanaUploadDraft | null {
  const draft = readPendingDraft();
  if (!draft || (owner && draft.owner !== owner)) return null;
  return draft;
}

export function decodeSolanaUploadDraftPayload(draft: SolanaUploadDraft): Uint8Array {
  return base64Decode(draft.payloadBase64);
}

function savePendingDraft(draft: SolanaUploadDraft): void {
  draft.updatedAt = Date.now();
  localStorage.setItem(SOLANA_UPLOAD_DRAFT_KEY, JSON.stringify(draft));
}

export function clearPendingSolanaUpload(expected?: Pick<SolanaUploadDraft, 'owner' | 'capsulePda'>): void {
  if (expected) {
    const current = readPendingDraft();
    if (current && (current.owner !== expected.owner || current.capsulePda !== expected.capsulePda)) return;
  }
  localStorage.removeItem(SOLANA_UPLOAD_DRAFT_KEY);
}

function makeDraft(params: {
  owner: string;
  quote: SolanaSealQuote;
  unlockAt: number;
  mode: CapsuleMode;
  payloadBytes: Uint8Array;
  payloadHash: string;
  publicTitle: string;
}): SolanaUploadDraft {
  return {
    schemaVersion: 1, cluster: 'devnet', programId: SOLANA_PROGRAM_ID,
    owner: solanaPublicKey(params.owner).toBase58(), capsuleId: params.quote.capsuleId,
    capsulePda: params.quote.capsulePda, unlockAt: params.unlockAt, mode: params.mode,
    formatVersion: 1, payloadHash: params.payloadHash, payloadBase64: base64Encode(params.payloadBytes),
    publicTitle: params.mode === 'public' ? params.publicTitle.normalize('NFC').trim() : '', updatedAt: Date.now(),
  };
}

/** Recover a sealed upload after a lost final response; no quote or wallet call. */
export async function reconcileCompletedSolanaUpload(draft: SolanaUploadDraft, options: { retainCompletedDraft?: boolean } = {}): Promise<
  Awaited<ReturnType<typeof completeConfirmedSolanaUpload>> | null
> {
  if (draft.programId !== SOLANA_PROGRAM_ID || draft.cluster !== 'devnet' ||
      deriveSolanaCapsulePda(draft.owner, draft.capsuleId).toBase58() !== draft.capsulePda) {
    throw new Error('The saved upload does not match this Solana program or its Capsule PDA.');
  }
  const connection = createSolanaConnection();
  const capsule = solanaPublicKey(draft.capsulePda);
  const info = await connection.getAccountInfo(capsule, 'confirmed');
  if (!info) return null;
  if (!info.owner.equals(solanaPublicKey(SOLANA_PROGRAM_ID)) || info.executable) throw new Error('The saved Capsule PDA has a different account owner.');
  const decoded = decodeSolanaCapsule(new Uint8Array(info.data));
  if (decoded.state !== 'final') return null;
  const payload = decodeSolanaUploadDraftPayload(draft);
  const title = draft.mode === 'public' ? draft.publicTitle : '';
  if (decoded.owner !== draft.owner || decoded.capsuleId !== draft.capsuleId || decoded.mode !== draft.mode ||
      decoded.formatVersion !== draft.formatVersion || decoded.unlockAt !== draft.unlockAt || decoded.publicTitle !== title ||
      decoded.payloadHash.toLowerCase() !== draft.payloadHash.toLowerCase() || !equalBytes(decoded.payloadBytes, payload)) {
    throw new Error('The sealed Capsule does not match the saved encrypted upload. No wallet request was sent.');
  }
  const { config, genesisHash } = await readProgramAndConfig(connection);
  const record = await verifiedCapsuleFromAccount(connection, capsule, config, { owner: draft.owner, capsuleId: draft.capsuleId });
  const signature = await findFinalizeSignature(connection, record, genesisHash,
    draft.pendingPhase === 'finalize' ? draft.pendingSignature ?? draft.lastSignature : draft.lastSignature);
  if (!signature) throw new Error('The upload is already sealed, but its matching receipt is not available yet. Retry this read without paying again.');
  const result = await completeConfirmedSolanaUpload(connection, capsule, config, genesisHash, signature);
  if (!options.retainCompletedDraft) clearPendingSolanaUpload(draft);
  return result;
}

export async function signAndSendLegacyTransaction(
  connection: Connection,
  provider: PhantomSolanaProvider,
  owner: string,
  instruction: TransactionInstruction | TransactionInstruction[],
  onStatus?: (status: string) => void,
  onSigned?: (signature: string, lastValidBlockHeight: number, nonce?: SolanaUploadDraft['pendingNonce'], refreshedBlockhash?: string) => void,
  onDefinitelyRejected?: () => void,
  durableNonce?: { account: PublicKey; value: string; contextSlot: number },
  expectedPrefixInstructions: readonly TransactionInstruction[] = [],
  skipPostSignBlockhashWindowCheck = false,
): Promise<string> {
  const activeAddress = provider.publicKey?.toBase58?.() ?? provider.publicKey?.toString?.();
  if (!activeAddress || solanaPublicKey(activeAddress).toBase58() !== owner) throw new Error('Phantom account changed during the upload. Reconnect the original Solana account and resume.');
  if (typeof provider.signTransaction !== 'function') throw new Error('This Phantom version cannot sign Solana transactions. Update Phantom and try again.');
  if (typeof provider.connect === 'function' && !provider.isConnected) {
    onStatus?.('Connecting to Phantom…');
    await provider.connect();
  }
  const instructions = (Array.isArray(instruction) ? instruction : [instruction]).map(cloneLegacyInstruction);
  const ownerKey = solanaPublicKey(owner);
  const advance = durableNonce ? nonceAdvanceInstruction(ownerKey, durableNonce.account) : undefined;

  // Open the wallet only with a usable review window. HTTP status polling below
  // does not depend on a WebSocket endpoint existing beside the HTTP proxy.
  let lifetime: { blockhash: string; lastValidBlockHeight: number } | null = null;
  let reviewedBlockhash = durableNonce?.value ?? ownerKey.toBase58();
  let blockhashContext: Awaited<ReturnType<Connection['getLatestBlockhashAndContext']>> | null = null;

  if (!durableNonce) {
    onStatus?.('Fetching Devnet blockhash before opening Phantom…');
    blockhashContext = await getFreshReviewBlockhash(connection);
    lifetime = blockhashContext.value;
    reviewedBlockhash = lifetime.blockhash;
  }

  const transaction = new Transaction({ feePayer: ownerKey, recentBlockhash: reviewedBlockhash })
    .add(...(advance ? [advance] : []), ...expectedPrefixInstructions.map(cloneLegacyInstruction), ...instructions.map(cloneLegacyInstruction));
  transaction.feePayer = ownerKey;
  transaction.recentBlockhash = reviewedBlockhash;
  if (transaction.serializeMessage().length + 65 > LEGACY_TRANSACTION_LIMIT) throw new Error('A data chunk exceeds the standard Solana wallet transaction limit.');

  let signedResult: unknown;
  try {
    onStatus?.('Opening Phantom for transaction review. Check the Devnet network, account, instructions, and amount before approving.');
    signedResult = await requestSolanaWallet(provider, () => provider.signTransaction!(transaction));
  } catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'number' ? cause.code : null;
    if (code === 4001) throw new Error('The Phantom signing request was rejected. No capsule step was submitted.');
    const detail = formatSolanaError(cause, 'Unexpected wallet error.');
    throw new Error(`Phantom could not sign the transaction${code === null ? '' : ` (code ${code})`}: ${detail} No transaction was broadcast.`);
  }
  const signedTransaction = normalizeSignedLegacyTransaction(signedResult, transaction, ownerKey);
  if (signedTransaction.recentBlockhash !== reviewedBlockhash) {
    if (durableNonce) throw new Error('Phantom changed the durable nonce. Nothing was broadcast.');
    // Wallets may refresh a recent hash immediately before signing. Preserve
    // instruction/privilege/fee/signature checks, and never attach the old
    // hash's expiry height to the newly signed hash.
    lifetime = null;
  }
  const signedMessage = signedTransaction.compileMessage();
  const walletMismatch = legacyMessageMismatchReason(signedMessage, signedTransaction.instructions, ownerKey, instructions, false, advance, true, expectedPrefixInstructions);
  if (walletMismatch || signedTransaction.serialize().length > LEGACY_TRANSACTION_LIMIT) {
    const reason = walletMismatch ?? 'serialized transaction exceeds the 1,232-byte packet limit';
    throw new Error(`Phantom returned an incompatible transaction (${reason}). Nothing was broadcast.`);
  }
  if (signedTransaction.signatures.length !== 1 || !signedTransaction.signatures[0].publicKey.equals(ownerKey)) {
    throw new Error('Phantom returned an unexpected signer set. Nothing was broadcast.');
  }
  const ownerSignature = signedTransaction.signatures.find((entry) => entry.publicKey.equals(ownerKey))?.signature;
  if (!ownerSignature || ownerSignature.length !== 64 || ownerSignature.every((byte) => byte === 0) || !signedTransaction.verifySignatures()) {
    throw new Error('Phantom did not return a valid signature for the reviewed transaction. The transaction was not broadcast.');
  }
  const signature = encodeBase58(ownerSignature);
  if (lifetime && !skipPostSignBlockhashWindowCheck) await assertBlockhashHasSubmissionWindow(connection, lifetime);
  onSigned?.(signature, lifetime?.lastValidBlockHeight ?? Number.MAX_SAFE_INTEGER,
    durableNonce ? { account: durableNonce.account.toBase58(), value: durableNonce.value } : undefined,
    !durableNonce ? signedTransaction.recentBlockhash : undefined);
  onStatus?.('Phantom signed the transaction. Sending it through the configured Devnet RPC and waiting for confirmation.');
  let submittedSignature: string;
  try {
    submittedSignature = await sendSignedTransactionWithFreshContext(connection, signedTransaction.serialize(), {
      maxRetries: 3,
      preflightCommitment: 'confirmed',
      minContextSlot: blockhashContext?.context.slot ?? durableNonce!.contextSlot,
    });
  } catch (cause) {
    if (isPreflightBlockhashNotFound(cause) || /\b429\b|too many requests/i.test(getSafeErrorMessage(cause))) onDefinitelyRejected?.();
    const detail = formatSolanaError(cause, 'Devnet transaction submission failed.');
    throw new Error(`The signed transaction was not confirmed by the Devnet RPC: ${detail} Resume checks its signature and on-chain offset before another wallet request.`);
  }
  if (submittedSignature !== signature) throw new Error(`The Devnet RPC returned a signature that does not match Phantom's signed transaction. Stop and inspect the chain.`);
  let confirmation;
  try {
      confirmation = await confirmSolanaTransaction(connection, signature, { lifetime: lifetime ?? undefined });
  } catch (cause) {
    const detail = formatSolanaError(cause, 'Devnet confirmation timed out or failed.');
    throw new Error(`Transaction ${signature} has a saved signature, but confirmation is pending: ${detail} Resume checks it before another wallet request.`);
  }
  if (confirmation.value.err) {
    onDefinitelyRejected?.();
    throw new Error(`Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  const receipt = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!receipt || receipt.version !== 'legacy' || !(receipt.transaction.message instanceof Message) || receipt.meta?.err) {
    throw new Error('The confirmed Phantom receipt could not be verified. Check the chain before resuming.');
  }
  const actualMessage = receipt.transaction.message;
  const actualInstructions = Transaction.populate(actualMessage, receipt.transaction.signatures).instructions;
  const receiptMismatch = legacyMessageMismatchReason(actualMessage, actualInstructions, ownerKey, instructions, false, advance, true, expectedPrefixInstructions);
  if (receiptMismatch || receipt.transaction.signatures[0] !== signature) {
    throw new Error('The confirmed Phantom transaction differs from the reviewed capsule instructions. Stop and inspect the chain before resuming.');
  }
  return signature;
}

/** One wallet review for a small ordered batch; only the app broadcasts. */
export async function signLegacyTransactionBatch(
  connection: Connection,
  provider: PhantomSolanaProvider,
  owner: string,
  instructionSets: readonly (readonly TransactionInstruction[])[],
  onStatus?: (status: string) => void,
) {
  const ownerKey = solanaPublicKey(owner);
  const activeAddress = provider.publicKey?.toBase58?.() ?? provider.publicKey?.toString?.();
  if (activeAddress !== owner || !provider.signAllTransactions) throw new Error('Phantom batch signing is unavailable for this account. Reopen the cost review.');
  if (!instructionSets.length || instructionSets.length > LEGACY_SIGNING_BATCH_SIZE) throw new Error('Invalid wallet signing batch size.');
  const reviewed = instructionSets.map((instructions) => instructions.map(cloneLegacyInstruction));
  const fresh = await getFreshReviewBlockhash(connection);
  const transactions = reviewed.map((instructions) => new Transaction({ feePayer: ownerKey, recentBlockhash: fresh.value.blockhash })
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: LEGACY_MAX_COMPUTE_UNIT_LIMIT }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ...instructions.map(cloneLegacyInstruction)));
  for (const transaction of transactions) {
    if (transaction.serializeMessage().length + 65 > LEGACY_TRANSACTION_LIMIT) throw new Error('The wallet signing batch exceeds the transaction packet limit.');
  }
  onStatus?.(`Opening Phantom for one review of ${transactions.length} transactions. Check Devnet, account, instructions, and fees before approving.`);
  const signedResults = await requestSolanaWallet(provider, () => provider.signAllTransactions!(transactions));
  if (!Array.isArray(signedResults) || signedResults.length !== transactions.length) throw new Error('Phantom did not sign the complete reviewed batch. Nothing was broadcast.');
  const signed = signedResults.map((result, index) => {
    const transaction = normalizeSignedLegacyTransaction(result, transactions[index], ownerKey);
    const mismatch = legacyMessageMismatchReason(transaction.compileMessage(), transaction.instructions, ownerKey, reviewed[index], false);
    if (mismatch || transaction.serialize().length > LEGACY_TRANSACTION_LIMIT || !transaction.verifySignatures() ||
        transaction.signatures.length !== 1 || !transaction.signatures[0].publicKey.equals(ownerKey) || !nonzeroOwnerSignature(transaction, ownerKey)) {
      throw new Error(`Phantom returned an incompatible signing batch${mismatch ? ` (${mismatch})` : ''}. Nothing was broadcast.`);
    }
    return { bytes: new Uint8Array(transaction.serialize()), signature: encodeBase58(transaction.signatures[0].signature!),
      lifetime: transaction.recentBlockhash === fresh.value.blockhash ? fresh.value : undefined,
      refreshedBlockhash: transaction.recentBlockhash === fresh.value.blockhash ? undefined : transaction.recentBlockhash };
  });
  // sendTransaction's preflight checks the signed hash against the current
  // bank. An extra height read here adds a full RTT after every wallet review.
  return { signed, lifetime: fresh.value, minContextSlot: fresh.context.slot, signedAt: Date.now() };
}

export async function signAndSendLegacyWithPhantom(
  connection: Connection,
  provider: PhantomSolanaProvider,
  owner: string,
  instruction: TransactionInstruction | TransactionInstruction[],
  onStatus?: (status: string) => void,
  onSigned?: (signature: string, lastValidBlockHeight: number) => void,
  onDefinitelyRejected?: () => void,
): Promise<string> {
  const activeAddress = provider.publicKey?.toBase58?.() ?? provider.publicKey?.toString?.();
  if (!activeAddress || solanaPublicKey(activeAddress).toBase58() !== owner) throw new Error('Phantom account changed during the upload. Reconnect the original Solana account and resume.');
  if (typeof provider.signAndSendTransaction !== 'function') throw new Error('Phantom can no longer send this transaction. Reopen the cost review.');
  const ownerKey = solanaPublicKey(owner);
  const reviewed = (Array.isArray(instruction) ? instruction : [instruction]).map(cloneLegacyInstruction);
  if (legacyMessageSize(ownerKey, ...reviewed) > LEGACY_TRANSACTION_LIMIT) throw new Error('A data chunk exceeds the standard Solana wallet transaction limit.');
  // Fetch a fresh review window without an extra pre-signature simulation.
  const fresh = await getFreshReviewBlockhash(connection);
  const lifetime = fresh.value;
  const transaction = new Transaction({ feePayer: ownerKey, recentBlockhash: lifetime.blockhash })
    .add(...reviewed.map(cloneLegacyInstruction));
  onStatus?.('Opening Phantom for transaction review. Check Devnet, account, instructions, and fee before approving.');
  let signature: string;
  try {
    // Phantom submits through its own RPC path. A minContextSlot observed from
    // the app's Helius connection can be ahead of that provider and provoke a
    // generic wallet error, so only pass standard fee/retry settings here.
    const response = await requestSolanaWallet(provider, () =>
      provider.signAndSendTransaction!(transaction, {
        preflightCommitment: 'confirmed',
        maxRetries: 3,
      }));
    signature = response?.signature;
  } catch (cause) {
    const code = cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'number' ? cause.code : null;
    if (code === 4001) {
      onDefinitelyRejected?.();
      throw new Error('The Phantom request was rejected. No capsule step was submitted.');
    }
    throw new Error(`Phantom could not confirm submission${code === null ? '' : ` (code ${code})`}: ${formatSolanaError(cause, 'Unexpected wallet error.')} Resume checks the chain before another wallet request.`);
  }
  if (typeof signature !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) {
    throw new Error('Phantom did not return a valid Solana signature. Resume checks the chain before another wallet request.');
  }
  // Keep the signature pending while the chain settles, including across a
  // page reload, so a retry cannot request a duplicate wallet transaction.
  onSigned?.(signature, Number.MAX_SAFE_INTEGER);
  onStatus?.('Phantom submitted the transaction. Waiting for Devnet confirmation.');
  let confirmation;
  try {
    confirmation = await confirmSolanaTransaction(connection, signature);
  } catch (cause) {
    throw new Error(`Transaction ${signature} may still be processing: ${formatSolanaError(cause, 'Confirmation timed out.')} Resume checks it before another wallet request.`);
  }
  if (confirmation.value.err) {
    onDefinitelyRejected?.();
    throw new Error(`Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  }
  const receipt = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
  if (!receipt || receipt.version !== 'legacy' || !(receipt.transaction.message instanceof Message) || receipt.meta?.err) {
    throw new Error('The confirmed Phantom receipt could not be verified. Check the chain before resuming.');
  }
  const actualMessage = receipt.transaction.message;
  const actualInstructions = Transaction.populate(actualMessage, receipt.transaction.signatures).instructions;
  const mismatch = legacyMessageMismatchReason(actualMessage, actualInstructions, ownerKey, reviewed, false, undefined, false);
  if (mismatch || receipt.transaction.signatures[0] !== signature) {
    throw new Error(`The confirmed Phantom transaction differs from the reviewed instructions${mismatch ? ` (${mismatch})` : ''}. Stop and inspect the chain before resuming.`);
  }
  return signature;
}

async function signAndSendV1Transaction(
  connection: Connection,
  provider: PhantomSolanaProvider,
  walletSigner: PhantomWalletStandardSigner,
  owner: string,
  instruction: TransactionInstruction | TransactionInstruction[],
  onStatus?: (status: string) => void,
  onSigned?: (signature: string, lastValidBlockHeight: number) => void,
  onDefinitelyRejected?: () => void,
  resourceLimits?: { computeUnitLimit: number; loadedAccountsDataSizeLimit: number },
): Promise<string> {
  const activeAddress = provider.publicKey?.toBase58?.() ?? provider.publicKey?.toString?.();
  if (!activeAddress || solanaPublicKey(activeAddress).toBase58() !== owner || walletSigner.account.address !== owner) {
    throw new Error('Phantom account changed during the upload. Reconnect the original Solana account and resume.');
  }
  {
    onStatus?.('Preparing a fresh Devnet v1 transaction. Phantom has not been opened and nothing has been sent yet.');
    const prepared = await prepareV1Transaction({
      owner: solanaPublicKey(owner), instruction, connection,
      ...resourceLimits,
    });
    onStatus?.('Opening Phantom for transaction review. Check the Devnet network, account, instructions, and amount before approving.');
    const signed = await requestSolanaWallet(provider, () => walletSigner.signTransaction({
      account: walletSigner.account,
      transaction: prepared.wireBytes,
      chain: 'solana:devnet',
    }));
    if (signed.length !== 1) throw new Error('Phantom returned an unexpected number of signed transactions.');
    const signedBytes = new Uint8Array(signed[0].signedTransaction);
    if (signedBytes.length !== prepared.wireBytes.length || !equalBytes(signedBytes.subarray(0, prepared.messageBytes.length), prepared.messageBytes)) {
      throw new Error('Phantom changed the reviewed v1 transaction message. The transaction was not submitted.');
    }
    const signatureBytes = signedBytes.subarray(prepared.messageBytes.length);
    if (signatureBytes.length !== 64 || signatureBytes.every((byte) => byte === 0)) throw new Error('Phantom did not return a valid v1 owner signature.');
    const verificationKey = await crypto.subtle.importKey('raw', solanaPublicKey(owner).toBytes().slice().buffer as ArrayBuffer,
      { name: 'Ed25519' }, false, ['verify']);
    if (!await crypto.subtle.verify('Ed25519', verificationKey, signatureBytes.slice().buffer as ArrayBuffer,
      prepared.messageBytes.slice().buffer as ArrayBuffer)) {
      throw new Error('Phantom returned an invalid v1 owner signature. Nothing was broadcast.');
    }
    const expectedSignature = encodeBase58(signatureBytes);
    onSigned?.(expectedSignature, prepared.lifetime.lastValidBlockHeight);
    onStatus?.('Phantom signed the transaction. Sending it through the configured Devnet RPC and waiting for confirmation.');
    let signature: string;
    try {
      signature = await sendSignedTransactionWithFreshContext(connection, signedBytes, {
        maxRetries: 3, preflightCommitment: 'confirmed', minContextSlot: prepared.minContextSlot,
      });
    } catch (cause) {
      if (isPreflightBlockhashNotFound(cause) || /\b429\b|too many requests/i.test(getSafeErrorMessage(cause))) onDefinitelyRejected?.();
      const detail = formatSolanaError(cause, 'Devnet transaction submission failed.');
      throw new Error(`The signed transaction was not confirmed by the Devnet RPC: ${detail} Resume checks its signature and on-chain offset before another wallet request.`);
    }
    if (signature !== expectedSignature) throw new Error('The Devnet RPC returned a signature that does not match Phantom’s signed v1 transaction. Stop and inspect the chain.');
    const confirmation = await confirmSolanaTransaction(connection, signature, { lifetime: prepared.lifetime });
    if (confirmation.value.err) {
      onDefinitelyRejected?.();
      throw new Error(`Solana v1 transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    }
    return signature;
  }
}

export async function submitSolanaCapsule(params: {
  owner: string;
  provider: PhantomSolanaProvider;
  quote: SolanaSealQuote;
  unlockAt: number;
  mode: CapsuleMode;
  payloadBytes: Uint8Array;
  payloadHash: string;
  publicTitle: string;
  resumeDraft?: SolanaUploadDraft | null;
  /** The UI acknowledges its memory record before removing the encrypted draft. */
  retainCompletedDraft?: boolean;
} & SolanaUploadCallbacks): Promise<{ record: SolanaCapsuleRecord; card: SolanaRecoveryCard; protocolFeePaidLamports?: bigint }> {
  const ownerAddress = solanaPublicKey(params.owner).toBase58();
  if (deriveSolanaCapsulePda(ownerAddress, params.quote.capsuleId).toBase58() !== params.quote.capsulePda) {
    throw new Error('The wallet changed after review. Reconnect the original account or reopen the cost review before signing.');
  }
  const payload = new Uint8Array(params.payloadBytes);
  if ((await sha256Hex(payload)).toLowerCase() !== params.payloadHash.toLowerCase()) throw new Error('Encrypted payload changed after the fee review. Restart the review.');
  assertSolanaSafeRecordSize(payload.length, params.quote.titleBytes);
  params.onStatus?.('Preparing the Devnet upload and checking account state. No wallet request has been sent yet.');
  const connection = createSolanaConnection();
  const { genesisHash, config, feeReview: currentFeeReview, chainTime } = await readProgramAndConfig(connection, SOLANA_PROGRAM_ID, true);
  if (payload.length > config.maxPayloadSize) throw new Error('The current Config payload limit changed. Review the seal again.');
  if (!params.quote.feeReview) throw new Error('The fee review is missing. Reopen the cost review before signing.');
  assertSolanaFeeReview(currentFeeReview!, params.quote.feeReview, chainTime!);
  const feeReview = params.quote.feeReview;
  let draft = params.resumeDraft ?? makeDraft({
    owner: ownerAddress, quote: params.quote, unlockAt: params.unlockAt, mode: params.mode,
    payloadBytes: payload, payloadHash: params.payloadHash, publicTitle: params.publicTitle,
  });
  if (draft.owner !== ownerAddress || draft.capsulePda !== params.quote.capsulePda || draft.payloadHash.toLowerCase() !== params.payloadHash.toLowerCase()) {
    throw new Error('The saved upload belongs to a different wallet or encrypted capsule.');
  }
  const v1Signer = params.quote.transactionVersion === 'v1' ? getPhantomV1Signer(ownerAddress) : null;
  const withoutDurableNonce = params.quote.transactionVersion === 'legacy' && params.quote.legacySubmission !== 'durable-nonce';
  const walletManagedLegacy = params.quote.legacySubmission === 'phantom';
  if (walletManagedLegacy && typeof params.provider.signAndSendTransaction !== 'function') {
    throw new Error('Phantom can no longer send transactions directly. Reopen the cost review.');
  }
  if ((params.quote.legacySubmission === 'app-signed' || params.quote.legacySubmission === 'durable-nonce') &&
      typeof params.provider.signTransaction !== 'function') {
    throw new Error('Phantom can no longer sign the reviewed Solana transaction. Reopen the cost review.');
  }
  if (params.quote.legacySubmission === 'app-batch' && !params.provider.signAllTransactions) throw new Error('Phantom batch signing is unavailable. Reopen the cost review.');
  if (params.quote.transactionVersion === 'v1' && !v1Signer) {
    throw new Error('Phantom no longer advertises v1 signing for this account. Reopen the cost review to use the supported transaction path.');
  }
  savePendingDraft(draft);
  const capsule = solanaPublicKey(draft.capsulePda);
  const reconciliation = await reconcilePendingSubmission(connection, draft);
  if (reconciliation !== 'none') savePendingDraft(draft);
  const titleBytes = draft.mode === 'public' ? new TextEncoder().encode(draft.publicTitle) : new Uint8Array();
  const hashBytes = Uint8Array.from(draft.payloadHash.slice(2).match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
  const chunkBytes = params.quote.maxChunkBytes;
  const maximumChunkBytes = params.quote.transactionVersion === 'v1'
    ? V1_WRITE_CHUNK_BYTES
    : maxLegacyChunkBytes(solanaPublicKey(ownerAddress), capsule,
      withoutDurableNonce ? undefined : nonceAdvanceInstruction(solanaPublicKey(ownerAddress), solanaPublicKey(params.quote.nonceAccount)));
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > maximumChunkBytes) {
    throw new Error('The reviewed write size is invalid. Reopen the cost review before signing.');
  }
  const total = params.quote.transactionCount;
  let completed = 0;
  const ownerKey = solanaPublicKey(ownerAddress);
  const [initialCapsuleInfo, initialNonceInfo] = await Promise.all([
    connection.getAccountInfo(capsule, 'confirmed'),
    v1Signer || withoutDurableNonce ? Promise.resolve(null) : readSolanaDevnetNonce(connection, ownerKey),
  ]);
  let capsuleInfo = initialCapsuleInfo;
  if (v1Signer && params.quote.atomicV1 && !capsuleInfo) {
    const instructions = await planAtomicV1Upload({ owner: ownerKey, capsule,
      feeReview,
      feeRecipient: solanaPublicKey(config.feeRecipient), capsuleId: draft.capsuleId,
      unlockAt: draft.unlockAt, mode: draft.mode, payload, payloadHash: hashBytes, title: titleBytes });
    if (!instructions || total !== 1) throw new Error('The atomic transaction plan changed. Reopen the cost review.');
    assertUploadWindow(draft.unlockAt, config.minLockDuration, 1);
    const callbacks = pendingUploadCallbacks(draft, 'finalize');
    const signature = await signAndSendV1Transaction(connection, params.provider, v1Signer, ownerAddress,
      instructions, params.onStatus, callbacks.onSigned, callbacks.onDefinitelyRejected,
      { computeUnitLimit: LEGACY_MAX_COMPUTE_UNIT_LIMIT, loadedAccountsDataSizeLimit: 64 * 1024 * 1024 });
    draft.lastSignature = signature;
    clearPendingSignature(draft);
    savePendingDraft(draft);
    params.onProgress?.({ completed: 1, total: 1, phase: 'finalize' });
    params.onStatus?.('Verifying the complete on-chain capsule and receipt.');
    const result = await completeConfirmedSolanaUpload(connection, capsule, config, genesisHash, signature, feeReview);
    if (!params.retainCompletedDraft) clearPendingSolanaUpload(draft);
    return result;
  }
  if (!v1Signer) {
    const nonceInfo = initialNonceInfo;
    if (!withoutDurableNonce && !nonceInfo) throw new Error('The Devnet transaction nonce could not be checked. Reopen the cost review and retry.');
    if (!withoutDurableNonce && nonceInfo && (nonceInfo.address.toBase58() !== params.quote.nonceAccount || Boolean(!nonceInfo.account) !== params.quote.nonceSetupRequired)) {
      throw new Error('The Devnet transaction nonce changed after the fee review. Reopen the review to refresh costs and confirmation count.');
    }
    if (!withoutDurableNonce && nonceInfo && !nonceInfo.account && params.quote.nonceAccountRentLamports <= 0n) {
      throw new Error('The Devnet nonce rent quote is missing. Reopen the cost review before signing.');
    }
    if (!withoutDurableNonce && Boolean(nonceInfo && !nonceInfo.account) !== params.quote.nonceSetupRequired) {
      throw new Error('The reviewed nonce setup plan changed. Reopen the cost review before signing.');
    }
    const nonceAdvance = withoutDurableNonce ? undefined : nonceAdvanceInstruction(ownerKey, nonceInfo!.address);
    const nonceSetupInstructions = !withoutDurableNonce && nonceInfo && !nonceInfo.account
      ? SystemProgram.createNonceAccount({
        fromPubkey: ownerKey, noncePubkey: nonceInfo.address, basePubkey: ownerKey,
        seed: DEVNET_NONCE_SEED, lamports: Number(params.quote.nonceAccountRentLamports), authorizedPubkey: ownerKey,
      }).instructions
      : [];
    let existing = capsuleInfo ? decodeSolanaCapsule(new Uint8Array(capsuleInfo.data)) : null;
    if (capsuleInfo && !capsuleInfo.owner.equals(solanaPublicKey(SOLANA_PROGRAM_ID))) throw new Error('The saved Capsule PDA is owned by a different program.');
    if (existing && (existing.owner !== ownerAddress || existing.capsuleId !== draft.capsuleId ||
        existing.payloadHash.toLowerCase() !== draft.payloadHash.toLowerCase() || existing.unlockAt !== draft.unlockAt ||
        existing.mode !== draft.mode || existing.expectedPayloadLen !== payload.length || existing.expectedTitleLen !== titleBytes.length)) {
      throw new Error('The saved upload identity does not match the on-chain Capsule PDA.');
    }
    if (existing?.state === 'final') {
      const record = await verifiedCapsuleFromAccount(connection, capsule, config);
      if (record.payloadHash.toLowerCase() !== draft.payloadHash.toLowerCase()) throw new Error('The finalized payload does not match this upload draft.');
      const signature = await findFinalizeSignature(connection, record, genesisHash, draft.lastSignature);
      if (!signature) throw new Error('The capsule is finalized, but its finalize receipt is unavailable. Use Direct Recovery with its Capsule PDA.');
      if (!params.retainCompletedDraft) clearPendingSolanaUpload(draft);
      return { record, card: makeRecoveryCard(record, genesisHash, signature) };
    }
    if (existing && existing.expiresAt < Math.floor(Date.now() / 1000)) throw new Error('This upload expired on chain. Cancel or reclaim it, then start a new capsule.');
    if (nonceSetupInstructions.length) {
      params.onStatus?.('Review the one-time reusable nonce setup in Phantom. Its rent is recoverable; Capsule data is sent only after this setup confirms.');
      const nonceCallbacks = pendingUploadCallbacks(draft, 'nonce-setup');
      const nonceSignature = await signAndSendLegacyTransaction(
        connection, params.provider, ownerAddress, nonceSetupInstructions, params.onStatus,
        nonceCallbacks.onSigned, nonceCallbacks.onDefinitelyRejected,
      );
      draft.lastSignature = nonceSignature;
      clearPendingSignature(draft);
      savePendingDraft(draft);
      const createdNonce = await readSolanaDevnetNonce(connection, ownerKey);
      if (!createdNonce?.account || createdNonce.address.toBase58() !== params.quote.nonceAccount) {
        throw new Error('The reusable nonce setup confirmed, but its account did not verify. No Capsule transaction was requested.');
      }
      completed += 1;
      params.onProgress?.({ completed, total, phase: 'nonce' });
    }
    const batches = await planLegacyUpload({
      feeReview,
      owner: ownerKey, capsule, feeRecipient: solanaPublicKey(config.feeRecipient), capsuleId: draft.capsuleId,
      unlockAt: draft.unlockAt, mode: draft.mode, payload, payloadHash: hashBytes, title: titleBytes,
      includeBegin: !existing, payloadOffset: existing?.uploadedPayloadLen ?? 0,
      titleOffset: existing?.uploadedTitleLen ?? 0, maxChunkBytes: chunkBytes,
      nonceAdvanceInstruction: nonceAdvance,
      firstTransactionPrefixInstructions: [],
    });
    if (batches.length !== params.quote.capsuleTransactionCount) throw new Error('The on-chain upload offset or reviewed transaction count changed. Reopen the cost review before signing.');
    assertUploadWindow(draft.unlockAt, config.minLockDuration, batches.length);
    let signingGroup: Awaited<ReturnType<typeof signLegacyTransactionBatch>> | null = null;
    for (const [index, batch] of batches.entries()) {
      assertUploadWindow(draft.unlockAt, config.minLockDuration, batches.length - index);
      params.onStatus?.(`Confirm Capsule transaction ${index + 1} of ${batches.length} in Phantom.`);
      const pendingCallbacks = pendingUploadCallbacks(draft, batch.phase);
      const signature = params.quote.legacySubmission === 'app-batch'
        ? await (async () => {
          if (index % LEGACY_SIGNING_BATCH_SIZE === 0) {
            signingGroup = await signLegacyTransactionBatch(connection, params.provider, ownerAddress,
              batches.slice(index, index + LEGACY_SIGNING_BATCH_SIZE).map((entry) => entry.instructions), params.onStatus);
          }
          const group = signingGroup!;
          const signed = group.signed[index % LEGACY_SIGNING_BATCH_SIZE];
          pendingCallbacks.onSigned(signed.signature, signed.lifetime?.lastValidBlockHeight ?? Number.MAX_SAFE_INTEGER,
            undefined, signed.refreshedBlockhash);
          params.onStatus?.(`Phantom approved the batch. Confirming transaction ${index + 1} of ${batches.length} on Devnet…`);
          const submitted = await sendSignedTransactionWithFreshContext(connection, signed.bytes, {
            maxRetries: 3, preflightCommitment: 'confirmed', minContextSlot: group.minContextSlot,
          });
          if (submitted !== signed.signature) throw new Error('The RPC returned a signature different from the signed batch. Stop and inspect the chain.');
          const confirmation = await confirmSolanaTransaction(connection, submitted, { lifetime: signed.lifetime });
          if (confirmation.value.err) {
            pendingCallbacks.onDefinitelyRejected();
            throw new Error(`Solana transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }
          return submitted;
        })()
        : walletManagedLegacy
        ? await signAndSendLegacyWithPhantom(connection, params.provider, ownerAddress, batch.instructions, params.onStatus,
          pendingCallbacks.onSigned, pendingCallbacks.onDefinitelyRejected)
        : withoutDurableNonce
        ? await signAndSendLegacyTransaction(connection, params.provider, ownerAddress, batch.instructions, params.onStatus,
          pendingCallbacks.onSigned, pendingCallbacks.onDefinitelyRejected)
        : await (async () => {
          const transactionNonce = await readSolanaDevnetNonce(connection, ownerKey);
          if (!transactionNonce.account) throw new Error('The Devnet transaction nonce account disappeared. Stop and inspect the chain before signing.');
          return signAndSendLegacyTransaction(
            connection, params.provider, ownerAddress, batch.instructions, params.onStatus,
            pendingCallbacks.onSigned, pendingCallbacks.onDefinitelyRejected,
            { account: transactionNonce.address, value: transactionNonce.account.state.nonce, contextSlot: transactionNonce.contextSlot },
          );
        })();
      if (!existing && index === 0) draft.beginSignature = signature;
      draft.lastSignature = signature;
      clearPendingSignature(draft);
      savePendingDraft(draft);
      if (params.quote.legacySubmission !== 'app-batch') {
        const nextInfo = await connection.getAccountInfo(capsule, 'confirmed');
        if (!nextInfo || !nextInfo.owner.equals(solanaPublicKey(SOLANA_PROGRAM_ID))) throw new Error('Capsule PDA was not confirmed after its transaction. Resume to check the chain before signing again.');
        existing = decodeSolanaCapsule(new Uint8Array(nextInfo.data));
        if (existing.uploadedPayloadLen !== batch.payloadEnd || existing.uploadedTitleLen !== batch.titleEnd ||
            existing.owner !== ownerAddress || existing.payloadHash.toLowerCase() !== draft.payloadHash.toLowerCase()) {
          throw new Error('Confirmed on-chain offsets differ from the reviewed upload plan. Stop and review the capsule before retrying.');
        }
      }
      completed += 1;
      params.onProgress?.({ completed, total, phase: batch.phase });
    }
    params.onStatus?.('Verifying the capsule account and event from Devnet.');
    const finalizeSignature = draft.lastSignature;
    if (!finalizeSignature) throw new Error('The finalize transaction signature was not recorded.');
    const result = await completeConfirmedSolanaUpload(connection, capsule, config, genesisHash, finalizeSignature, feeReview);
    if (!params.retainCompletedDraft) clearPendingSolanaUpload(draft);
    return result;
  }
  if (!capsuleInfo) {
    const expectedRemainingTransactions = 2 + Math.ceil(payload.length / chunkBytes) + Math.ceil(titleBytes.length / chunkBytes);
    if (total !== expectedRemainingTransactions) throw new Error('The reviewed transaction count changed. Reopen the cost review before signing.');
    assertUploadWindow(draft.unlockAt, config.minLockDuration, total);
  }
  if (!capsuleInfo) {
    params.onStatus?.('Confirm the capsule start transaction in Phantom.');
    const beginData = await buildBeginData({ capsuleId: draft.capsuleId, unlockAt: draft.unlockAt, mode: draft.mode, payloadBytes: payload, payloadHash: hashBytes, titleBytes });
    const pendingCallbacks = pendingUploadCallbacks(draft, 'begin');
    const beginSignature = await signAndSendLegacyTransaction(
      connection, params.provider, ownerAddress, beginInstruction(solanaPublicKey(ownerAddress), capsule, beginData),
      params.onStatus, pendingCallbacks.onSigned, pendingCallbacks.onDefinitelyRejected,
    );
    draft.beginSignature = beginSignature;
    draft.lastSignature = beginSignature;
    clearPendingSignature(draft);
    savePendingDraft(draft);
    completed += 1;
    params.onProgress?.({ completed, total, phase: 'begin' });
  } else {
    const existing = decodeSolanaCapsule(new Uint8Array(capsuleInfo.data));
    if (existing.owner !== ownerAddress || existing.capsuleId !== draft.capsuleId || existing.payloadHash.toLowerCase() !== draft.payloadHash.toLowerCase() || existing.unlockAt !== draft.unlockAt || existing.mode !== draft.mode) {
      throw new Error('The saved upload identity does not match the on-chain Capsule PDA.');
    }
    if (existing.state === 'final') {
      if (existing.uploadedPayloadLen !== payload.length || (await sha256Hex(existing.payloadBytes)).toLowerCase() !== params.payloadHash.toLowerCase()) throw new Error('The finalized capsule payload does not match this local upload draft.');
      const record = await verifiedCapsuleFromAccount(connection, capsule, config);
      const signature = await findFinalizeSignature(connection, record, genesisHash, draft.lastSignature);
      if (!params.retainCompletedDraft) clearPendingSolanaUpload(draft);
      if (!signature) throw new Error('This capsule is finalized and its full ciphertext is verified, but the finalize receipt is not available in recent RPC history. Use Direct Recovery with its Capsule PDA.');
      const card = makeRecoveryCard(record, genesisHash, signature);
      return { record, card };
    }
    if (existing.expiresAt < Math.floor(Date.now() / 1000)) throw new Error('This upload expired on chain. Cancel or reclaim it, then start a new capsule.');
    if (existing.unlockAt <= Math.floor(Date.now() / 1000) + config.minLockDuration) {
      throw new Error('The unlock time has arrived or is too close to finish this upload. Cancel this partial account and start a new capsule with more time.');
    }
    const expectedRemainingTransactions = Math.ceil((payload.length - existing.uploadedPayloadLen) / chunkBytes) +
      Math.ceil((titleBytes.length - existing.uploadedTitleLen) / chunkBytes) + 1;
    if (total !== expectedRemainingTransactions) throw new Error('The on-chain upload offset changed after the review. Reopen the cost review before signing.');
    const payloadOffset = existing.uploadedPayloadLen;
    const titleOffset = existing.uploadedTitleLen;
    params.onStatus?.(`Resuming at payload byte ${payloadOffset.toLocaleString()} and title byte ${titleOffset.toLocaleString()}.`);
  }

  const refreshed = await connection.getAccountInfo(capsule, 'confirmed');
  if (!refreshed) throw new Error('Capsule PDA was not confirmed after the begin transaction.');
  let current = decodeSolanaCapsule(new Uint8Array(refreshed.data));
  const v1Writes: Array<{ instruction: TransactionInstruction; phase: 'payload' | 'title'; end: number }> = [];
  for (let offset = current.uploadedPayloadLen; offset < payload.length; offset += chunkBytes) {
    const chunk = payload.subarray(offset, Math.min(offset + chunkBytes, payload.length));
    v1Writes.push({
      instruction: writeInstruction(solanaPublicKey(ownerAddress), capsule, await buildWriteData('write_chunk', offset, chunk)),
      phase: 'payload', end: offset + chunk.length,
    });
  }
  for (let offset = current.uploadedTitleLen; offset < titleBytes.length; offset += chunkBytes) {
    const chunk = titleBytes.subarray(offset, Math.min(offset + chunkBytes, titleBytes.length));
    v1Writes.push({
      instruction: writeInstruction(solanaPublicKey(ownerAddress), capsule, await buildWriteData('write_title_chunk', offset, chunk)),
      phase: 'title', end: offset + chunk.length,
    });
  }
  if (v1Writes.length + completed + 1 !== total) {
    throw new Error('The reviewed Solana write count changed. Reopen the cost review before signing.');
  }
  for (let batchStart = 0; batchStart < v1Writes.length; batchStart += V1_SIGNING_BATCH_SIZE) {
    const batch = v1Writes.slice(batchStart, batchStart + V1_SIGNING_BATCH_SIZE);
    assertUploadWindow(draft.unlockAt, config.minLockDuration, v1Writes.length - batchStart + 1);
    const batchIndex = Math.floor(batchStart / V1_SIGNING_BATCH_SIZE) + 1;
    const batchCount = Math.ceil(v1Writes.length / V1_SIGNING_BATCH_SIZE);
    params.onStatus?.(`Reviewing upload batch ${batchIndex} of ${batchCount} in Phantom (${batch.length} writes).`);
    const group = await signV1TransactionBatch(connection, params.provider, v1Signer!, ownerAddress,
      batch.map((entry) => [entry.instruction]), params.onStatus, {
        computeUnitLimit: params.quote.computeUnitLimit ?? LEGACY_MAX_COMPUTE_UNIT_LIMIT,
        loadedAccountsDataSizeLimit: params.quote.loadedAccountsDataSizeLimit ?? 64 * 1024 * 1024,
      });
    for (const [batchOffset, entry] of batch.entries()) {
      const signed = group.signed[batchOffset];
      const pendingCallbacks = pendingUploadCallbacks(draft, entry.phase);
      pendingCallbacks.onSigned(signed.signature, signed.lifetime.lastValidBlockHeight, undefined, signed.lifetime.blockhash);
      params.onStatus?.(`Phantom approved the batch. Confirming write ${batchStart + batchOffset + 1} of ${v1Writes.length} on Devnet…`);
      let submitted: string;
      try {
        submitted = await sendSignedTransactionWithFreshContext(connection, signed.bytes, {
          maxRetries: 3, preflightCommitment: 'confirmed', minContextSlot: group.minContextSlot,
        });
      } catch (cause) {
        if (isPreflightBlockhashNotFound(cause) || /\b429\b|too many requests/i.test(getSafeErrorMessage(cause))) pendingCallbacks.onDefinitelyRejected();
        const detail = formatSolanaError(cause, 'Devnet transaction submission failed.');
        throw new Error(`The signed Solana write was not confirmed by the Devnet RPC: ${detail} Resume checks its signature and on-chain offset before another wallet request.`);
      }
      if (submitted !== signed.signature) throw new Error('The Devnet RPC returned a signature that does not match Phantom’s signed write. Stop and inspect the chain.');
      const confirmation = await confirmSolanaTransaction(connection, signed.signature, { lifetime: signed.lifetime });
      if (confirmation.value.err) {
        pendingCallbacks.onDefinitelyRejected();
        throw new Error(`Solana v1 transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      draft.lastSignature = signed.signature;
      clearPendingSignature(draft);
      savePendingDraft(draft);
      completed += 1;
      params.onProgress?.({ completed, total, phase: entry.phase });
      const progressBytes = entry.phase === 'payload' ? entry.end : payload.length + entry.end;
      params.onStatus?.(`Confirmed ${progressBytes.toLocaleString()} / ${(payload.length + titleBytes.length).toLocaleString()} upload bytes.`);
    }
  }

  assertUploadWindow(draft.unlockAt, config.minLockDuration, 1);
  params.onStatus?.('Confirm finalization in Phantom. The program will verify the full payload hash.');
  const finalizeCallbacks = pendingUploadCallbacks(draft, 'finalize');
  const finalizeSignature = await signAndSendLegacyTransaction(
    connection,
    params.provider,
    ownerAddress,
    finalizeInstruction(solanaPublicKey(ownerAddress), capsule, solanaPublicKey(config.feeRecipient), await buildInstructionData('finalize_capsule'), feeReview),
    params.onStatus,
    finalizeCallbacks.onSigned,
    finalizeCallbacks.onDefinitelyRejected,
  );
  draft.lastSignature = finalizeSignature;
  clearPendingSignature(draft);
  savePendingDraft(draft);
  completed += 1;
  params.onProgress?.({ completed, total, phase: 'finalize' });
  params.onStatus?.('Verifying the capsule account and event from Devnet.');
  const result = await completeConfirmedSolanaUpload(connection, capsule, config, genesisHash, finalizeSignature, feeReview);
  if (!params.retainCompletedDraft) clearPendingSolanaUpload(draft);
  return result;
}

export async function cancelSolanaUpload(
  owner: string,
  capsulePda: string,
  provider: PhantomSolanaProvider,
  onStatus?: (status: string) => void,
): Promise<string | null> {
  const connection = createSolanaConnection();
  const ownerAddress = solanaPublicKey(owner).toBase58();
  const pda = solanaPublicKey(capsulePda);
  const pending = readPendingDraft();
  if (pending && (pending.owner !== ownerAddress || pending.capsulePda !== pda.toBase58())) {
    throw new Error('The saved upload belongs to a different wallet or capsule. It was left untouched.');
  }
  if (pending?.pendingSignature) {
    onStatus?.('Checking the saved transaction before cancellation. No new wallet request has been sent.');
    await reconcilePendingSubmission(connection, pending);
    savePendingDraft(pending);
  }
  const info = await connection.getAccountInfo(pda, 'confirmed');
  if (!info) {
    clearPendingSolanaUpload(pending ?? undefined);
    return null;
  }
  if (!info.owner.equals(solanaPublicKey(SOLANA_PROGRAM_ID))) throw new Error('The saved Capsule PDA is owned by a different program.');
  if (decodeSolanaCapsule(new Uint8Array(info.data)).state === 'final') throw new Error('This capsule is already finalized and cannot be canceled. Use Direct Recovery with its PDA.');
  const instruction = cancelInstruction(
    solanaPublicKey(ownerAddress), pda, await buildInstructionData('cancel_upload'),
  );
  const nonce = await readSolanaDevnetNonce(connection, solanaPublicKey(ownerAddress));
  if (!nonce.account) {
    const rentLamports = await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH, 'confirmed');
    onStatus?.(`Phantom will first ask you to create a reusable Devnet transaction nonce. ${formatLamports(BigInt(rentLamports), 9)} SOL is temporarily locked as recoverable account rent. After it confirms, approve the cancellation request.`);
    const setupInstructions = SystemProgram.createNonceAccount({
      fromPubkey: solanaPublicKey(ownerAddress),
      noncePubkey: nonce.address,
      basePubkey: solanaPublicKey(ownerAddress),
      seed: DEVNET_NONCE_SEED,
      lamports: rentLamports,
      authorizedPubkey: solanaPublicKey(ownerAddress),
    }).instructions;
    await signAndSendLegacyTransaction(
      connection, provider, ownerAddress, setupInstructions,
      onStatus, undefined, undefined, undefined, [], true,
    );
  }
  const readyNonce = await readSolanaDevnetNonce(connection, solanaPublicKey(ownerAddress));
  if (!readyNonce.account) throw new Error('The reusable Devnet nonce setup did not confirm. The capsule upload remains unchanged.');
  onStatus?.('The reusable nonce is ready. Approve the partial-upload cancellation in Phantom; this transaction will not expire while it is under review.');
  const signature = await signAndSendLegacyTransaction(
    connection, provider, ownerAddress, instruction,
    onStatus, undefined, undefined,
    { account: readyNonce.address, value: readyNonce.account.state.nonce, contextSlot: readyNonce.contextSlot },
  );
  clearPendingSolanaUpload(pending ?? undefined);
  return signature;
}

export function makeRecoveryCard(record: SolanaCapsuleRecord, genesisHash: string, finalizeSignature: string): SolanaRecoveryCard {
  return {
    appName: 'TimeCapsule', version: 2, chainNamespace: 'solana', cluster: 'devnet',
    genesisHash, programId: SOLANA_PROGRAM_ID, capsulePda: record.capsulePda,
    capsuleId: record.capsuleId, owner: record.owner, createdAt: record.createdAt,
    unlockAt: record.unlockAt, mode: record.mode, formatVersion: 1,
    payloadHash: record.payloadHash, finalizeSignature,
  };
}

export async function readSolanaRecoveryCard(card: SolanaRecoveryCard): Promise<SolanaCapsuleRecord> {
  return fetchSolanaCapsule({ capsulePda: card.capsulePda, card });
}

/** Export only after reconciling the current account and its matching finalize event. */
export async function exportSolanaRecoveryCard(capsulePda: string): Promise<SolanaRecoveryCard> {
  const connection = createSolanaConnection();
  const { genesisHash, config } = await readProgramAndConfig(connection);
  const record = await verifiedCapsuleFromAccount(connection, solanaPublicKey(capsulePda), config);
  const signature = await findFinalizeSignature(connection, record, genesisHash);
  if (!signature) throw new Error('The capsule is verified, but its finalize receipt is unavailable. Retry or recover directly with its account address.');
  return makeRecoveryCard(record, genesisHash, signature);
}

export function formatLamports(lamports: bigint, maximumFractionDigits = 6): string {
  const whole = lamports / 1_000_000_000n;
  const remainder = (lamports % 1_000_000_000n).toString().padStart(9, '0');
  const fraction = remainder.slice(0, maximumFractionDigits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
