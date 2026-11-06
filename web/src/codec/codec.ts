import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  base64ToUint8Array,
  bytesToHex,
  DEFAULT_ARGON2_PARAMS,
  deriveKeyArgon2id,
  getRandomBytes,
  hexToBytes,
  sha256Hex,
  uint8ArrayToBase64,
} from './crypto';
import {
  CapsuleError,
  InvalidPasswordError,
  PayloadHashMismatchError,
  TimelockNotReleasedError,
  TimelockUnavailableError,
} from './types';
import type {
  CapsuleFormatV1,
  CapsuleMode,
  DecryptCapsuleParams,
  DecryptedCapsuleResult,
  EncryptedCapsuleResult,
  SealCapsuleParams,
} from './types';
import {
  expectedQuicknetRound,
  openQuicknetCiphertext,
  QUICKNET,
  sealForQuicknetRound,
  validateQuicknetArmor,
} from './timelock';

const CEK_LEN = 32;
const GCM_IV_LEN = 12;
const PASSWORD_SALT_LEN = 16;
const PASSWORD_WRAPPED_CEK_LEN = GCM_IV_LEN + CEK_LEN + 16;
const V1_BASE_KEYS = [
  'formatVersion',
  'cipherSuite',
  'ciphertext',
  'cipherNonce',
  'unlockAt',
  'timelockNetwork',
  'timelockChainHash',
  'timelockRound',
  'timelockCiphertext',
  'mode',
];
const V1_PRIVATE_KEYS = [...V1_BASE_KEYS, 'passwordKdf', 'passwordSalt', 'passwordKdfParams'];

function assertMode(mode: unknown): asserts mode is CapsuleMode {
  if (mode !== 'public' && mode !== 'private') {
    throw new CapsuleError('Unknown capsule mode.', 'UNKNOWN_MODE');
  }
}

function assertExpectedMetadata(capsule: CapsuleFormatV1, expected: DecryptCapsuleParams['expectedMetadata']) {
  if (
    !expected ||
    !Number.isSafeInteger(expected.unlockAt) ||
    (expected.mode !== 'public' && expected.mode !== 'private') ||
    expected.formatVersion !== 1
  ) {
    throw new CapsuleError('Trusted on-chain capsule metadata is required.', 'INVALID_EXPECTED_METADATA');
  }
  if (
    capsule.unlockAt !== expected.unlockAt ||
    capsule.mode !== expected.mode ||
    capsule.formatVersion !== expected.formatVersion
  ) {
    throw new CapsuleError('Payload does not match the expected on-chain capsule metadata.', 'METADATA_MISMATCH');
  }
}

function validatePrivateParams(capsule: CapsuleFormatV1): void {
  const params = capsule.passwordKdfParams;
  if (
    capsule.passwordKdf !== 'argon2id' ||
    !params ||
    params.iterations !== DEFAULT_ARGON2_PARAMS.iterations ||
    params.memorySize !== DEFAULT_ARGON2_PARAMS.memorySize ||
    params.parallelism !== DEFAULT_ARGON2_PARAMS.parallelism ||
    params.hashLength !== DEFAULT_ARGON2_PARAMS.hashLength ||
    Object.keys(params).length !== 4 ||
    base64ToUint8Array(capsule.passwordSalt ?? '').length !== PASSWORD_SALT_LEN
  ) {
    throw new CapsuleError('Invalid or unsupported Argon2id parameters.', 'INVALID_KDF');
  }
}

function parseAndValidatePayload(payloadBytes: Uint8Array): CapsuleFormatV1 {
  let serialized: string;
  let parsed: unknown;
  try {
    serialized = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
    parsed = JSON.parse(serialized);
  } catch {
    throw new CapsuleError('Malformed capsule payload format.', 'MALFORMED_PAYLOAD');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CapsuleError('Malformed capsule payload structure.', 'MALFORMED_PAYLOAD');
  }
  const capsule = parsed as CapsuleFormatV1;
  assertMode(capsule.mode);
  const expectedKeys = capsule.mode === 'private' ? V1_PRIVATE_KEYS : V1_BASE_KEYS;
  const actualKeys = Object.keys(capsule);
  if (actualKeys.length !== expectedKeys.length || expectedKeys.some((key) => !actualKeys.includes(key))) {
    throw new CapsuleError('Capsule has unknown or missing fields.', 'INVALID_FIELDS');
  }

  if (JSON.stringify(capsule) !== serialized) {
    throw new CapsuleError('Capsule JSON is not in canonical V1 form.', 'NON_CANONICAL_PAYLOAD');
  }
  if (capsule.formatVersion !== 1) {
    throw new CapsuleError(`Unsupported format version: ${String(capsule.formatVersion)}`, 'UNSUPPORTED_VERSION');
  }
  if (capsule.cipherSuite !== 'AES-256-GCM') {
    throw new CapsuleError('Unsupported body cipher suite.', 'UNSUPPORTED_CIPHER');
  }
  if (capsule.timelockNetwork !== QUICKNET.name || capsule.timelockChainHash !== QUICKNET.chainHash) {
    throw new CapsuleError('Unsupported drand network or chain hash.', 'UNSUPPORTED_TIMELOCK_NETWORK');
  }
  if (
    !Number.isSafeInteger(capsule.unlockAt) ||
    !Number.isSafeInteger(capsule.timelockRound) ||
    capsule.timelockRound !== expectedQuicknetRound(capsule.unlockAt)
  ) {
    throw new CapsuleError('Invalid unlock time or drand quicknet round.', 'INVALID_TIMELOCK_ROUND');
  }

  const ciphertext = base64ToUint8Array(capsule.ciphertext);
  const nonce = base64ToUint8Array(capsule.cipherNonce);
  if (ciphertext.length < 16 || nonce.length !== GCM_IV_LEN) {
    throw new CapsuleError('Invalid AES-GCM body encoding.', 'CORRUPTED_PAYLOAD');
  }
  validateQuicknetArmor(capsule.timelockCiphertext, capsule.timelockRound, capsule.timelockChainHash);

  if (capsule.mode === 'private') {
    validatePrivateParams(capsule);
  }
  return capsule;
}

/** Seal a message using the frozen Capsule Open Format V1. */
export async function sealCapsulePayload(params: SealCapsuleParams): Promise<EncryptedCapsuleResult> {
  const { message, unlockAt, mode, password } = params;
  assertMode(mode);
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new CapsuleError('Capsule message cannot be empty.', 'EMPTY_MESSAGE');
  }
  if (!Number.isSafeInteger(unlockAt) || unlockAt <= Math.floor(Date.now() / 1000)) {
    throw new CapsuleError('Unlock time must be a future Unix timestamp in seconds.', 'INVALID_UNLOCK_TIME');
  }
  if (mode === 'private' && (!password || password.length === 0)) {
    throw new CapsuleError('Private capsule requires a non-empty password.', 'PASSWORD_REQUIRED');
  }

  let plaintextBytes: Uint8Array | undefined;
  let cek: Uint8Array | undefined;
  let passwordKey: Uint8Array | undefined;
  let wrappedCekContainer: Uint8Array | undefined;
  let ciphertextBytes: Uint8Array | undefined;
  try {
    const timelockRound = expectedQuicknetRound(unlockAt);
    plaintextBytes = new TextEncoder().encode(message);
    cek = getRandomBytes(CEK_LEN);
    const cipherNonce = getRandomBytes(GCM_IV_LEN);
    ciphertextBytes = await aesGcmEncrypt(plaintextBytes, cek, cipherNonce);

    let timelockPlaintext = cek;
    let passwordSalt: string | undefined;
    let passwordKdf: 'argon2id' | undefined;
    let passwordKdfParams: typeof DEFAULT_ARGON2_PARAMS | undefined;

    if (mode === 'private') {
      const saltBytes = getRandomBytes(PASSWORD_SALT_LEN);
      passwordSalt = uint8ArrayToBase64(saltBytes);
      passwordKdf = 'argon2id';
      passwordKdfParams = DEFAULT_ARGON2_PARAMS;
      try {
        passwordKey = await deriveKeyArgon2id(password!, saltBytes, passwordKdfParams);
        const wrapNonce = getRandomBytes(GCM_IV_LEN);
        const wrappedCek = await aesGcmEncrypt(cek, passwordKey, wrapNonce);
        try {
          wrappedCekContainer = new Uint8Array(wrapNonce.length + wrappedCek.length);
          wrappedCekContainer.set(wrapNonce);
          wrappedCekContainer.set(wrappedCek, wrapNonce.length);
        } finally {
          wrappedCek.fill(0);
        }
        timelockPlaintext = wrappedCekContainer;
      } finally {
        saltBytes.fill(0);
      }
    }

    const timelockCiphertext = await sealForQuicknetRound(timelockRound, timelockPlaintext);
    const capsulePayload: CapsuleFormatV1 = {
      formatVersion: 1,
      cipherSuite: 'AES-256-GCM',
      ciphertext: uint8ArrayToBase64(ciphertextBytes),
      cipherNonce: uint8ArrayToBase64(cipherNonce),
      unlockAt,
      timelockNetwork: QUICKNET.name,
      timelockChainHash: QUICKNET.chainHash,
      timelockRound,
      timelockCiphertext,
      mode,
      ...(mode === 'private' && { passwordKdf, passwordSalt, passwordKdfParams }),
    };

    const payloadJson = JSON.stringify(capsulePayload);
    const payloadBytes = new TextEncoder().encode(payloadJson);
    return {
      payloadJson,
      payloadBytes,
      payloadHex: bytesToHex(payloadBytes),
      payloadHash: await sha256Hex(payloadBytes),
      formatVersion: 1,
      unlockAt,
      modeNumber: mode === 'public' ? 0 : 1,
      timelockChainHash: QUICKNET.chainHash,
      timelockRound,
    };
  } catch (error) {
    if (error instanceof CapsuleError) throw error;
    throw new CapsuleError(
      error instanceof Error ? error.message : 'Capsule encryption failed.',
      'SEAL_FAILED',
    );
  } finally {
    plaintextBytes?.fill(0);
    cek?.fill(0);
    passwordKey?.fill(0);
    wrappedCekContainer?.fill(0);
    ciphertextBytes?.fill(0);
  }
}

/**
 * Open only after the actual quicknet tlock round can be retrieved and verified.
 * Callers must supply chain-derived metadata and the chain's payload hash.
 */
export async function unsealCapsulePayload(
  params: DecryptCapsuleParams,
): Promise<DecryptedCapsuleResult> {
  const { payloadBytesOrHex, expectedPayloadHash, expectedMetadata, password } = params;
  let payloadBytes: Uint8Array;
  try {
    payloadBytes = typeof payloadBytesOrHex === 'string'
      ? hexToBytes(payloadBytesOrHex)
      : new Uint8Array(payloadBytesOrHex);
  } catch {
    throw new CapsuleError('Invalid raw payload byte encoding.', 'MALFORMED_PAYLOAD');
  }

  const computedHash = await sha256Hex(payloadBytes);
  if (computedHash.toLowerCase() !== expectedPayloadHash.toLowerCase()) {
    throw new PayloadHashMismatchError(expectedPayloadHash, computedHash);
  }

  const capsule = parseAndValidatePayload(payloadBytes);
  assertExpectedMetadata(capsule, expectedMetadata);

  let timelockPlaintext: Uint8Array;
  try {
    timelockPlaintext = await openQuicknetCiphertext(capsule.timelockCiphertext);
  } catch (error) {
    if (error instanceof TimelockNotReleasedError) throw error;
    throw new TimelockUnavailableError();
  }

  let cek: Uint8Array | undefined;
  let passwordKey: Uint8Array | undefined;
  let messageBytes: Uint8Array | undefined;
  try {
    if (capsule.mode === 'public') {
      if (timelockPlaintext.length !== CEK_LEN) {
        throw new CapsuleError('Invalid time-lock CEK length.', 'CORRUPTED_PAYLOAD');
      }
      cek = timelockPlaintext;
    } else {
      if (!password) {
        throw new CapsuleError('Password required to decrypt private capsule.', 'PASSWORD_REQUIRED');
      }
      if (timelockPlaintext.length !== PASSWORD_WRAPPED_CEK_LEN) {
        throw new CapsuleError('Invalid time-lock password envelope.', 'CORRUPTED_PAYLOAD');
      }
      const saltBytes = base64ToUint8Array(capsule.passwordSalt!);
      try {
        passwordKey = await deriveKeyArgon2id(password, saltBytes, capsule.passwordKdfParams);
      } finally {
        saltBytes.fill(0);
      }
      const wrapNonce = timelockPlaintext.slice(0, GCM_IV_LEN);
      const wrappedCek = timelockPlaintext.slice(GCM_IV_LEN);
      try {
        cek = await aesGcmDecrypt(wrappedCek, passwordKey, wrapNonce);
      } catch {
        throw new InvalidPasswordError();
      } finally {
        wrapNonce.fill(0);
        wrappedCek.fill(0);
      }
      if (cek.length !== CEK_LEN) {
        cek.fill(0);
        throw new CapsuleError('Invalid unwrapped CEK length.', 'CORRUPTED_PAYLOAD');
      }
    }

    const cipherTextBytes = base64ToUint8Array(capsule.ciphertext);
    const cipherNonceBytes = base64ToUint8Array(capsule.cipherNonce);
    try {
      messageBytes = await aesGcmDecrypt(cipherTextBytes, cek, cipherNonceBytes);
      return {
        message: new TextDecoder('utf-8', { fatal: true }).decode(messageBytes),
        unlockAt: capsule.unlockAt,
        mode: capsule.mode,
      };
    } catch (error) {
      if (error instanceof CapsuleError) throw error;
      throw new CapsuleError('Failed to decrypt message body.', 'DECRYPTION_FAILED');
    } finally {
      cipherTextBytes.fill(0);
      cipherNonceBytes.fill(0);
    }
  } finally {
    if (cek !== timelockPlaintext) cek?.fill(0);
    passwordKey?.fill(0);
    timelockPlaintext.fill(0);
    messageBytes?.fill(0);
    payloadBytes.fill(0);
  }
}

export async function verifyCapsuleHash(
  payloadBytesOrHex: Uint8Array | string,
  expectedHash: string,
): Promise<boolean> {
  const payloadBytes = typeof payloadBytesOrHex === 'string'
    ? hexToBytes(payloadBytesOrHex)
    : new Uint8Array(payloadBytesOrHex);
  const computedHash = await sha256Hex(payloadBytes);
  return computedHash.toLowerCase() === expectedHash.toLowerCase();
}
