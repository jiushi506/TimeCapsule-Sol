export type CapsuleMode = 'public' | 'private';

export interface Argon2idParams {
  iterations: number;
  memorySize: number;
  parallelism: number;
  hashLength: number;
}

export interface CapsuleFormatV1 {
  formatVersion: 1;
  cipherSuite: 'AES-256-GCM';
  ciphertext: string;
  cipherNonce: string;
  unlockAt: number;
  timelockNetwork: 'drand-quicknet-v1';
  timelockChainHash: string;
  timelockRound: number;
  timelockCiphertext: string;
  mode: CapsuleMode;
  passwordKdf?: 'argon2id';
  passwordSalt?: string;
  passwordKdfParams?: Argon2idParams;
}

export interface SealCapsuleParams {
  message: string;
  unlockAt: number;
  mode: CapsuleMode;
  password?: string;
}

export interface EncryptedCapsuleResult {
  payloadJson: string;
  payloadBytes: Uint8Array;
  payloadHex: `0x${string}`;
  payloadHash: `0x${string}`;
  formatVersion: 1;
  unlockAt: number;
  modeNumber: 0 | 1;
  timelockChainHash: string;
  timelockRound: number;
}

export interface ExpectedCapsuleMetadata {
  unlockAt: number;
  mode: CapsuleMode;
  formatVersion: number;
}

export interface DecryptCapsuleParams {
  payloadBytesOrHex: Uint8Array | string;
  expectedPayloadHash: string;
  expectedMetadata: ExpectedCapsuleMetadata;
  password?: string;
}

export interface DecryptedCapsuleResult {
  message: string;
  unlockAt: number;
  mode: CapsuleMode;
}

export class CapsuleError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'CapsuleError';
  }
}

export class InvalidPasswordError extends CapsuleError {
  constructor() {
    super('Incorrect decryption passphrase for private capsule.', 'INVALID_PASSWORD');
  }
}

export class TimelockNotReleasedError extends CapsuleError {
  constructor() {
    super('The scheduled unlock time has not arrived yet.', 'TIMELOCK_NOT_RELEASED');
  }
}

export class PayloadHashMismatchError extends CapsuleError {
  constructor(expected: string, actual: string) {
    super(
      `Payload hash mismatch! Expected ${expected}, got ${actual}. Data may have been tampered with.`,
      'PAYLOAD_HASH_MISMATCH',
    );
  }
}

export class TimelockUnavailableError extends CapsuleError {
  constructor() {
    super('Unable to verify the required drand beacon. Check your connection and try again.', 'TIMELOCK_UNAVAILABLE');
  }
}
