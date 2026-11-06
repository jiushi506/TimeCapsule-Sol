import { argon2id } from 'hash-wasm';
import type { Argon2idParams } from './types';

// Convert Uint8Array to Base64
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Convert Base64 to Uint8Array
export function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error('Invalid Base64 encoding.');
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  if (uint8ArrayToBase64(bytes) !== base64) throw new Error('Non-canonical Base64 encoding.');
  return bytes;
}

// Convert Uint8Array to Hex string prefixed with 0x
export function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return `0x${hex}`;
}

// Convert Hex string to Uint8Array
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(cleanHex)) {
    throw new Error('Invalid hex encoding.');
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// SHA-256 calculation matching Solidity sha256()
export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as any);
  return new Uint8Array(hashBuffer);
}

export async function sha256Hex(data: Uint8Array): Promise<`0x${string}`> {
  const hash = await sha256Bytes(data);
  return bytesToHex(hash);
}

// Generate secure random bytes
export function getRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// AES-256-GCM Encrypt
export async function aesGcmEncrypt(
  plaintextBytes: Uint8Array,
  keyBytes: Uint8Array,
  ivBytes: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes as any },
    cryptoKey,
    plaintextBytes as any
  );

  return new Uint8Array(ciphertextBuffer);
}

// AES-256-GCM Decrypt
export async function aesGcmDecrypt(
  ciphertextBytes: Uint8Array,
  keyBytes: Uint8Array,
  ivBytes: Uint8Array
): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes as any },
    cryptoKey,
    ciphertextBytes as any
  );

  return new Uint8Array(decryptedBuffer);
}

// Default Argon2id parameters
export const DEFAULT_ARGON2_PARAMS: Argon2idParams = Object.freeze({
  iterations: 3,
  memorySize: 32768, // 32MB in KB
  parallelism: 1,
  hashLength: 32, // 256 bits for AES-256 key
});

// Derive key using Argon2id
export async function deriveKeyArgon2id(
  password: string,
  saltBytes: Uint8Array,
  params: Argon2idParams = DEFAULT_ARGON2_PARAMS
): Promise<Uint8Array> {
  try {
    const rawHash = await argon2id({
      password,
      salt: saltBytes,
      iterations: params.iterations,
      memorySize: params.memorySize,
      parallelism: params.parallelism,
      hashLength: params.hashLength,
      outputType: 'binary',
    });
    return rawHash;
  } catch (err) {
    throw new Error('Argon2id is unavailable; capsule operation aborted.', { cause: err });
  }
}
