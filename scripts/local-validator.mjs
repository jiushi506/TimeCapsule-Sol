import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  lamports,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const programSo = parseSoPath(process.argv.slice(2));
const idl = JSON.parse(await readFile(path.join(root, 'idl/time_capsule.json'), 'utf8'));
const programId = address(idl.address);
const systemProgram = address('11111111111111111111111111111111');
const loader = address('BPFLoaderUpgradeab1e11111111111111111111111');
const solPriceAccount = address('7AviUf9nL62mcxNbQGKm4nKDQnPjswo6c5MX4D57HmyE');
const usdcPriceAccount = address('6HAuqASbHEh4w4REJEUUUCginTLfj1kwCh215ZLtMkrT');
const encoder = getAddressEncoder();
const utf8 = (value) => new TextEncoder().encode(value);
const programData = await pda(loader, encoder.encode(programId));
const config = await pda(programId, utf8('config-v1'));
const feePolicy = await pda(programId, utf8('fee-policy-v1'));
const directory = await mkdtemp('/tmp/timecapsule-solana-test-');
const rpcPort = 19_489;
const gossipPort = 19_499;
const faucetPort = 19_498;
const dynamicPorts = '19500-19540';
const rpcUrl = `http://127.0.0.1:${rpcPort}`;
const checks = [];
let validator;
let validatorLog = '';

try {
  await assertPortsFree([rpcPort, gossipPort, faucetPort, ...Array.from({ length: 41 }, (_, i) => 19_500 + i)]);
  const admin = await generateKeyPairSigner();
  const feeRecipient = await generateKeyPairSigner();
  const rpc = createSolanaRpc(rpcUrl);
  validator = spawn('solana-test-validator', [
    '--ledger', path.join(directory, 'ledger'), '--reset', '--quiet', '--bind-address', '127.0.0.1',
    '--rpc-port', String(rpcPort), '--dynamic-port-range', dynamicPorts,
    '--gossip-port', String(gossipPort), '--faucet-port', String(faucetPort), '--ticks-per-slot', '8',
    '--upgradeable-program', programId, programSo, admin.address,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  validator.stdout?.on('data', (chunk) => { validatorLog = (validatorLog + chunk).slice(-6_000); });
  validator.stderr?.on('data', (chunk) => { validatorLog = (validatorLog + chunk).slice(-6_000); });
  await waitForValidator(rpc, validator, () => validatorLog);

  const airdrop = await rpc.requestAirdrop(admin.address, lamports(5_000_000_000n), { commitment: 'confirmed' }).send();
  await confirm(rpc, airdrop);
  const recipientAirdrop = await rpc.requestAirdrop(feeRecipient.address, lamports(1_000_000_000n), { commitment: 'confirmed' }).send();
  await confirm(rpc, recipientAirdrop);
  const recipientStartingBalance = await rpc.getBalance(feeRecipient.address, { commitment: 'confirmed' }).send().then((x) => x.value);
  const initialized = await submit(rpc, admin, instruction('initialize_config', [
    account(admin.address, AccountRole.WRITABLE_SIGNER, admin),
    account(config, AccountRole.WRITABLE),
    account(programData, AccountRole.READONLY),
    account(systemProgram, AccountRole.READONLY),
  ], Buffer.concat([
    encoder.encode(feeRecipient.address),
    u64(1_234n),
    u32(65_536),
    i64(30n),
  ])));
  assert.equal(initialized.err, null);
  const initializedPolicy = await submit(rpc, admin, instruction('initialize_fee_policy', [
    account(admin.address, AccountRole.WRITABLE_SIGNER, admin),
    account(config, AccountRole.READONLY),
    account(feePolicy, AccountRole.WRITABLE),
    account(systemProgram, AccountRole.READONLY),
  ], Buffer.concat([
    u8(0), // FixedSol
    u64(0n),
    u32(120),
    u16(100),
    u32(120),
  ])));
  assert.equal(initializedPolicy.err, null);
  checks.push('local upgradeable program initialized with a fixed 1,234 lamport fee and unchanged account schemas');

  const v2Payload = Buffer.from('{"formatVersion":2,"fixture":"synthetic local test container"}', 'utf8');
  const v2Hash = createHash('sha256').update(v2Payload).digest();
  const v2Pda = await capsulePda(admin.address, 1n);
  const v2UnlockAt = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
  const beginV2 = beginCapsule({
    owner: admin,
    config,
    capsule: v2Pda,
    id: 1n,
    unlockAt: v2UnlockAt,
    mode: 1,
    version: 2,
    payloadLength: v2Payload.length,
    payloadHash: v2Hash,
  });
  assert.equal((await submit(rpc, admin, beginV2)).err, null);
  assert.equal((await submit(rpc, admin, writeChunk(admin, v2Pda, 0, v2Payload))).err, null);
  const v2Finalize = finalizeCapsule(admin, config, v2Pda, feeRecipient.address, feePolicy, v2UnlockAt);
  assert.equal((await submit(rpc, admin, v2Finalize)).err, null);
  await assertCapsule(rpc, v2Pda, { version: 2, mode: 1, payload: v2Payload, payloadHash: v2Hash });
  assert.equal(await rpc.getBalance(feeRecipient.address, { commitment: 'confirmed' }).send().then((x) => x.value), recipientStartingBalance + 1_234n);
  checks.push('private V2 begin/write/finalize, exact SHA-256 and account readback, fixed fee settlement');

  const v1Payload = Buffer.alloc(4_000, 0x31);
  const v1Hash = createHash('sha256').update(v1Payload).digest();
  const v1Pda = await capsulePda(admin.address, 2n);
  const v1UnlockAt = BigInt(Math.floor(Date.now() / 1_000) + 3_600);
  assert.equal((await submit(rpc, admin, beginCapsule({
    owner: admin, config, capsule: v1Pda, id: 2n, unlockAt: v1UnlockAt,
    mode: 1, version: 1, payloadLength: v1Payload.length, payloadHash: v1Hash,
  }))).err, null);
  const chunks = Array.from({ length: Math.ceil(v1Payload.length / 800) }, (_, i) => v1Payload.subarray(i * 800, Math.min(v1Payload.length, (i + 1) * 800)));
  assert.equal((await submit(rpc, admin, writeChunk(admin, v1Pda, 0, chunks[0]))).err, null);
  const wrongOffset = await submit(rpc, admin, writeChunk(admin, v1Pda, 799, chunks[1]), true);
  assert.match(json(wrongOffset.err), /6015/);
  for (let index = 1; index < chunks.length; index += 1) {
    const offset = chunks.slice(0, index).reduce((total, chunk) => total + chunk.length, 0);
    assert.equal((await submit(rpc, admin, writeChunk(admin, v1Pda, offset, chunks[index]))).err, null);
  }
  assert.equal((await submit(rpc, admin, finalizeCapsule(admin, config, v1Pda, feeRecipient.address, feePolicy, v1UnlockAt))).err, null);
  await assertCapsule(rpc, v1Pda, { version: 1, mode: 1, payload: v1Payload, payloadHash: v1Hash });
  assert.equal(await rpc.getBalance(feeRecipient.address, { commitment: 'confirmed' }).send().then((x) => x.value), recipientStartingBalance + 2_468n);
  checks.push('V1 upload resumes at the exact byte offset; rejected offset leaves the payload intact and finalizes successfully');

  const maxPda = await capsulePda(admin.address, 3n);
  const maxHash = createHash('sha256').update(Buffer.alloc(65_536)).digest();
  const maxBegin = await submit(rpc, admin, beginCapsule({
    owner: admin, config, capsule: maxPda, id: 3n,
    unlockAt: BigInt(Math.floor(Date.now() / 1_000) + 3_600), mode: 1, version: 2,
    payloadLength: 65_536, payloadHash: maxHash,
  }));
  assert.equal(maxBegin.err, null, '65,536-byte V2 upload reservation is admitted');
  assert.equal((await submit(rpc, admin, cancelUpload(admin, maxPda))).err, null);
  const oversized = await submit(rpc, admin, beginCapsule({
    owner: admin, config, capsule: await capsulePda(admin.address, 4n), id: 4n,
    unlockAt: BigInt(Math.floor(Date.now() / 1_000) + 3_600), mode: 1, version: 2,
    payloadLength: 65_537, payloadHash: maxHash,
  }), true);
  assert.match(json(oversized.err), /6006/);
  checks.push('65,536-byte reservation only (not a full upload) is admitted; 65,537 bytes is rejected; reservation is canceled');

  for (const [id, mode, version, expectedCode] of [[5n, 1, 3, 6007], [6n, 0, 2, 6043]]) {
    const rejected = await submit(rpc, admin, beginCapsule({
      owner: admin, config, capsule: await capsulePda(admin.address, id), id,
      unlockAt: BigInt(Math.floor(Date.now() / 1_000) + 3_600), mode, version,
      payloadLength: 1, payloadHash: createHash('sha256').update(Buffer.from([1])).digest(),
    }), true);
    assert.match(json(rejected.err), new RegExp(String(expectedCode)));
    assert.equal((await rpc.getAccountInfo(await capsulePda(admin.address, id), { encoding: 'base64' }).send()).value, null);
  }
  checks.push('unknown format and public V2 fail closed with stable Anchor errors and no Capsule PDA');

  console.log(JSON.stringify({ localSolanaProgram: programId, validator: '127.0.0.1 local only', checks }));
} finally {
  if (validator && validator.exitCode === null && validator.signalCode === null) {
    validator.kill('SIGTERM');
    await Promise.race([onceClose(validator), delay(5_000)]);
  }
  await rm(directory, { recursive: true, force: true });
}

function parseSoPath(argv) {
  const index = argv.indexOf('--so');
  if (index === -1 || !argv[index + 1] || argv[index + 1].startsWith('--')) {
    throw new Error('Provide the locally built candidate program with --so <path>.');
  }
  return path.resolve(argv[index + 1]);
}

async function assertPortsFree(ports) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', () => reject(new Error(`Local Solana test port ${port} is already in use; no validator was started.`)));
      server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()));
    });
  }
}

async function waitForValidator(rpc, child, readLog) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Local validator exited: ${readLog()}`);
    try {
      await rpc.getHealth().send({ abortSignal: AbortSignal.timeout(1_000) });
      return;
    } catch {
      await delay(500);
    }
  }
  throw new Error(`Local validator did not start: ${readLog()}`);
}

async function confirm(rpc, signature) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    const response = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send();
    const status = response.value[0];
    if (status?.err) throw new Error(`Local Solana transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return status;
    await delay(250);
  }
  throw new Error('Timed out waiting for a local Solana transaction.');
}

async function submit(rpc, signer, instruction, skipPreflight = false) {
  const lifetime = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
  const message = appendTransactionMessageInstruction(
    instruction,
    setTransactionMessageLifetimeUsingBlockhash(
      lifetime.value,
      setTransactionMessageFeePayerSigner(signer, createTransactionMessage({ version: 0 })),
    ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), {
    encoding: 'base64', preflightCommitment: 'confirmed', skipPreflight, maxRetries: 3n,
  }).send();
  let lastStatus = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()).value[0];
  if (lastStatus?.err || lastStatus?.confirmationStatus === 'confirmed' || lastStatus?.confirmationStatus === 'finalized') {
    return { signature, err: lastStatus?.err ?? null };
  }
  for (let attempt = 0; attempt < 180; attempt += 1) {
    lastStatus = (await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true }).send()).value[0];
    if (lastStatus?.err || lastStatus?.confirmationStatus === 'confirmed' || lastStatus?.confirmationStatus === 'finalized') {
      return { signature, err: lastStatus.err ?? null };
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for a local Solana transaction (${JSON.stringify(lastStatus)}); validator=${validatorLog}`);
}

function instruction(name, accounts, args = Buffer.alloc(0)) {
  const item = idl.instructions.find((candidate) => candidate.name === name);
  if (!item?.discriminator || item.discriminator.length !== 8) throw new Error(`IDL is missing ${name}.`);
  return { programAddress: programId, accounts, data: Buffer.concat([Buffer.from(item.discriminator), args]) };
}

function beginCapsule({ owner, config: configPda, capsule, id, unlockAt, mode, version, payloadLength, payloadHash }) {
  return instruction('begin_capsule', [
    account(owner.address, AccountRole.WRITABLE_SIGNER, owner),
    account(configPda, AccountRole.READONLY),
    account(capsule, AccountRole.WRITABLE),
    account(systemProgram, AccountRole.READONLY),
  ], Buffer.concat([
    u64(id), i64(unlockAt), u8(mode), u16(version), u32(payloadLength), payloadHash, u16(0),
  ]));
}

function writeChunk(owner, capsule, offset, chunk) {
  return instruction('write_chunk', [
    account(owner.address, AccountRole.READONLY_SIGNER, owner),
    account(capsule, AccountRole.WRITABLE),
  ], Buffer.concat([u32(offset), u32(chunk.length), chunk]));
}

function finalizeCapsule(owner, configPda, capsule, recipient, policy, unlockAt, validUntil = unlockAt - 3_300n) {
  return instruction('finalize_capsule', [
    account(owner.address, AccountRole.WRITABLE_SIGNER, owner),
    account(configPda, AccountRole.READONLY),
    account(capsule, AccountRole.WRITABLE),
    account(recipient, AccountRole.WRITABLE),
    account(systemProgram, AccountRole.READONLY),
    account(policy, AccountRole.READONLY),
    account(solPriceAccount, AccountRole.READONLY),
    account(usdcPriceAccount, AccountRole.READONLY),
  ], Buffer.concat([u64(1_234n), u64(1n), i64(validUntil)]));
}

function cancelUpload(owner, capsule) {
  return instruction('cancel_upload', [
    account(owner.address, AccountRole.WRITABLE_SIGNER, owner),
    account(capsule, AccountRole.WRITABLE),
  ]);
}

function account(value, role, signer) {
  return { address: address(value), role, ...(signer ? { signer } : {}) };
}

async function capsulePda(owner, id) {
  return pda(programId, utf8('capsule-v1'), encoder.encode(address(owner)), u64(id));
}

async function pda(programAddress, ...seeds) {
  const [value] = await getProgramDerivedAddress({ programAddress, seeds });
  return value;
}

async function assertCapsule(rpc, capsule, expected) {
  const response = await rpc.getAccountInfo(address(capsule), { encoding: 'base64', commitment: 'confirmed' }).send();
  assert.ok(response.value, 'finalized Capsule account is readable from local validator');
  assert.equal(response.value.owner, programId);
  const data = Buffer.from(response.value.data[0], 'base64');
  assert.equal(data.readUInt8(65), expected.mode);
  assert.equal(data.readUInt16LE(66), expected.version);
  assert.equal(data.readUInt8(68), 1, 'CapsuleState::Final');
  assert.equal(data.readUInt32LE(69), expected.payload.length);
  assert.equal(data.readUInt32LE(73), expected.payload.length);
  assert.deepEqual(data.subarray(77, 109), expected.payloadHash);
  assert.equal(data.readUInt32LE(133), expected.payload.length);
  assert.deepEqual(data.subarray(137, 137 + expected.payload.length), expected.payload);
}

function u8(value) { return Buffer.from([value]); }
function u16(value) { const out = Buffer.alloc(2); out.writeUInt16LE(value); return out; }
function u32(value) { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; }
function u64(value) { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
function i64(value) { const out = Buffer.alloc(8); out.writeBigInt64LE(BigInt(value)); return out; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function onceClose(child) { return new Promise((resolve) => child.once('close', resolve)); }
function json(value) { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item); }
