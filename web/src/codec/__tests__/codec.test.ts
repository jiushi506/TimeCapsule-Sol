import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { sealCapsulePayload, unsealCapsulePayload, verifyCapsuleHash } from '../codec';
import { sha256Hex } from '../crypto';
import {
  CapsuleError,
  InvalidPasswordError,
  PayloadHashMismatchError,
  TimelockNotReleasedError,
  TimelockUnavailableError,
} from '../types';
import { expectedQuicknetRound, openQuicknetCiphertext, QUICKNET } from '../timelock';

let passed = 0;
let failed = 0;

function assert(condition: boolean, description: string): void {
  if (!condition) {
    failed++;
    throw new Error(`FAILED: ${description}`);
  }
  passed++;
}

async function expectFailure<T extends Error>(
  action: () => Promise<unknown>,
  type: new (...args: any[]) => T,
  description: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assert(error instanceof type, description);
    return;
  }
  assert(false, description);
}

function expectedMetadata(sealed: { unlockAt: number; modeNumber: 0 | 1 }) {
  return {
    unlockAt: sealed.unlockAt,
    mode: sealed.modeNumber === 0 ? 'public' as const : 'private' as const,
    formatVersion: 1,
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const boundary = QUICKNET.genesisTime + QUICKNET.period * 123;
  assert(expectedQuicknetRound(boundary) === 124, 'Exact round boundary maps to its scheduled round');
  assert(expectedQuicknetRound(boundary + 1) === 125, 'Non-round timestamp maps to the next scheduled round');

  // A short-lived live vector gives the independent Go CLI time to decrypt a real quicknet round.
  const unlockAt = Math.floor(Date.now() / 1000) + 64;
  const publicMessage = 'time-lock-validation-v1-public';
  const privateMessage = 'time-lock-validation-v1-private';
  const privatePassword = 'stage-one-live-test-password-2026';

  const publicCapsule = await sealCapsulePayload({ message: publicMessage, unlockAt, mode: 'public' });
  const privateCapsule = await sealCapsulePayload({
    message: privateMessage,
    unlockAt,
    mode: 'private',
    password: privatePassword,
  });
  const publicExpected = expectedMetadata(publicCapsule);
  const privateExpected = expectedMetadata(privateCapsule);

  assert(publicCapsule.payloadHash.startsWith('0x'), 'Public payload has a SHA-256 hash');
  assert(!publicCapsule.payloadJson.includes(publicMessage), 'Public payload does not contain the message');
  assert(!privateCapsule.payloadJson.includes(privateMessage), 'Private payload does not contain the message');
  assert(!privateCapsule.payloadJson.includes(privatePassword), 'Private payload does not contain the password');
  assert(Object.keys(JSON.parse(publicCapsule.payloadJson)).length === 10, 'Public payload contains only the frozen V1 fields, with no raw CEK field');
  assert(!Object.keys(JSON.parse(privateCapsule.payloadJson)).some((key) => /^(?:cek|contentKey|privateKey|password|localLabel)$/i.test(key)),
    'Private payload does not add a raw CEK, passphrase, private key, or browser-only label field');
  assert(await verifyCapsuleHash(publicCapsule.payloadBytes, publicCapsule.payloadHash), 'Public payload SHA-256 matches raw bytes');
  assert(publicCapsule.timelockRound === privateCapsule.timelockRound, 'Both modes target the same live signal round');

  // Tampering tests recompute the hash where needed to exercise the format checks beyond the hash gate.
  const mutate = async (field: string, value: unknown): Promise<Uint8Array> => {
    const object = JSON.parse(publicCapsule.payloadJson);
    object[field] = value;
    return new TextEncoder().encode(JSON.stringify(object));
  };
  const expectMutatedFailure = async (field: string, value: unknown, description: string) => {
    const bytes = await mutate(field, value);
    const hash = await sha256Hex(bytes);
    await expectFailure(
      () => unsealCapsulePayload({
        payloadBytesOrHex: bytes,
        expectedPayloadHash: hash,
        expectedMetadata: publicExpected,
      }),
      CapsuleError,
      description,
    );
  };
  const changedByte = new Uint8Array(publicCapsule.payloadBytes);
  changedByte[changedByte.length - 1] ^= 1;
  await expectFailure(
    () => unsealCapsulePayload({
      payloadBytesOrHex: changedByte,
      expectedPayloadHash: publicCapsule.payloadHash,
      expectedMetadata: publicExpected,
    }),
    PayloadHashMismatchError,
    'A changed payload byte fails the on-chain hash check',
  );
  await expectMutatedFailure('timelockChainHash', '0'.repeat(64), 'A changed quicknet chain hash fails closed');
  await expectMutatedFailure('timelockRound', publicCapsule.timelockRound + 1, 'A changed round fails closed');
  await expectMutatedFailure('mode', 'private', 'A changed mode fails closed');
  const changedKdf = JSON.parse(privateCapsule.payloadJson);
  changedKdf.passwordKdfParams.iterations++;
  const changedKdfBytes = new TextEncoder().encode(JSON.stringify(changedKdf));
  await expectFailure(
    async () => {
      const hash = await sha256Hex(changedKdfBytes);
      return unsealCapsulePayload({
        payloadBytesOrHex: changedKdfBytes,
        expectedPayloadHash: hash,
        expectedMetadata: privateExpected,
      });
    },
    CapsuleError,
    'A changed Argon2id parameter fails closed',
  );
  await expectFailure(
    () => unsealCapsulePayload({
      payloadBytesOrHex: publicCapsule.payloadBytes,
      expectedPayloadHash: publicCapsule.payloadHash,
      expectedMetadata: { ...publicExpected, unlockAt: publicExpected.unlockAt + 1 },
    }),
    CapsuleError,
    'A mismatch with the chain metadata fails closed',
  );

  await expectFailure(
    () => unsealCapsulePayload({
      payloadBytesOrHex: publicCapsule.payloadBytes,
      expectedPayloadHash: publicCapsule.payloadHash,
      expectedMetadata: publicExpected,
    }),
    TimelockNotReleasedError,
    'A capsule reports that its scheduled release time has not arrived',
  );

  // Advance only the JavaScript clock: no wall-clock value is an input to the decryption API.
  const realDateNow = Date.now;
  Date.now = () => (unlockAt + 3600) * 1000;
  try {
    await expectFailure(
      () => unsealCapsulePayload({
        payloadBytesOrHex: publicCapsule.payloadBytes,
        expectedPayloadHash: publicCapsule.payloadHash,
        expectedMetadata: publicExpected,
      }),
      TimelockUnavailableError,
      'A future system clock cannot open a capsule before its drand round',
    );
    await expectFailure(
      () => unsealCapsulePayload({
        payloadBytesOrHex: privateCapsule.payloadBytes,
        expectedPayloadHash: privateCapsule.payloadHash,
        expectedMetadata: privateExpected,
        password: privatePassword,
      }),
      TimelockUnavailableError,
      'A correct private password and future system clock still cannot open before drand releases the round',
    );
  } finally {
    Date.now = realDateNow;
  }

  const targetTimeMs = (QUICKNET.genesisTime + (publicCapsule.timelockRound - 1) * QUICKNET.period) * 1000;
  while (Date.now() < targetTimeMs + 1000) {
    await sleep(Math.min(targetTimeMs + 1000 - Date.now(), 1000));
  }

  let publicResult: Awaited<ReturnType<typeof unsealCapsulePayload>> | undefined;
  let signalPublishedAt: number | undefined;
  const retryDeadline = Date.now() + 25000;
  while (!publicResult && Date.now() <= retryDeadline) {
    try {
      publicResult = await unsealCapsulePayload({
        payloadBytesOrHex: publicCapsule.payloadBytes,
        expectedPayloadHash: publicCapsule.payloadHash,
        expectedMetadata: publicExpected,
      });
      signalPublishedAt = Math.floor(Date.now() / 1000);
    } catch (error) {
      if (!(error instanceof TimelockNotReleasedError || error instanceof TimelockUnavailableError)) throw error;
      await sleep(1000);
    }
  }
  assert(publicResult?.message === publicMessage, 'Public message opens after the verified quicknet round is available');

  const tamperedBeacon = JSON.parse(publicCapsule.payloadJson) as Record<string, unknown>;
  const armor = tamperedBeacon.timelockCiphertext as string;
  const encodedBody = armor.split(/\r?\n/).filter((line) => line && !line.startsWith('-----')).join('');
  const binary = atob(encodedBody);
  const corrupted = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  corrupted[corrupted.length - 1] ^= 1;
  let corruptedBinary = '';
  for (const byte of corrupted) corruptedBinary += String.fromCharCode(byte);
  const corruptedBody = btoa(corruptedBinary).match(/.{1,64}/g)?.join('\n') ?? '';
  tamperedBeacon.timelockCiphertext = `-----BEGIN AGE ENCRYPTED FILE-----\n${corruptedBody}\n-----END AGE ENCRYPTED FILE-----\n`;
  const tamperedBeaconBytes = new TextEncoder().encode(JSON.stringify(tamperedBeacon));
  const tamperedBeaconHash = await sha256Hex(tamperedBeaconBytes);
  await expectFailure(
    () => unsealCapsulePayload({
      payloadBytesOrHex: tamperedBeaconBytes,
      expectedPayloadHash: tamperedBeaconHash,
      expectedMetadata: publicExpected,
    }),
    TimelockUnavailableError,
    'A tlock payload with a tampered beacon ciphertext is rejected after the real round is available',
  );

  await expectFailure(
    () => unsealCapsulePayload({
      payloadBytesOrHex: privateCapsule.payloadBytes,
      expectedPayloadHash: privateCapsule.payloadHash,
      expectedMetadata: privateExpected,
      password: 'wrong-password',
    }),
    InvalidPasswordError,
    'Wrong private password fails after the actual signal is available',
  );
  const privateResult = await unsealCapsulePayload({
    payloadBytesOrHex: privateCapsule.payloadBytes,
    expectedPayloadHash: privateCapsule.payloadHash,
    expectedMetadata: privateExpected,
    password: privatePassword,
  });
  assert(privateResult.message === privateMessage, 'Private message opens after the signal with the correct password');

  const rawReleasedKey = await openQuicknetCiphertext(
    JSON.parse(publicCapsule.payloadJson).timelockCiphertext as string,
  );
  const releasedKeyHash = await sha256Hex(rawReleasedKey);
  rawReleasedKey.fill(0);
  const vectorPath = resolve(process.cwd(), '../target/tlock-live-vector.json');
  await mkdir(dirname(vectorPath), { recursive: true });
  await writeFile(
    vectorPath,
    `${JSON.stringify({
      format: 'Capsule Open Format V1 drand tlock interoperability vector',
      generatedAt: now,
      unlockAt,
      chainHash: QUICKNET.chainHash,
      round: publicCapsule.timelockRound,
      scheduledRoundTime: Math.floor(targetTimeMs / 1000),
      signalPublishedAt,
      payloadHash: publicCapsule.payloadHash,
      releasedCekSha256: releasedKeyHash,
      timelockCiphertext: JSON.parse(publicCapsule.payloadJson).timelockCiphertext,
    }, null, 2)}\n`,
    'utf8',
  );

  console.log(JSON.stringify({
    stage: 1,
    quicknetChainHash: QUICKNET.chainHash,
    round: publicCapsule.timelockRound,
    scheduledRoundTime: Math.floor(targetTimeMs / 1000),
    signalPublishedAt,
    preSignalClockBypassRejected: true,
    publicAfterSignal: true,
    privateCorrectPasswordBeforeSignalRejected: true,
    privateWrongPasswordAfterSignalRejected: true,
    privateCorrectPasswordAfterSignal: true,
    vectorPath,
    passed,
    failed,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Codec test failed.');
  process.exitCode = 1;
});
