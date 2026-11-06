import { HttpCachingChain, HttpChainClient, defaultChainOptions, fetchBeacon, roundTime } from 'drand-client';
import { timelockDecrypt, timelockEncrypt, Buffer } from 'tlock-js';
import type { ChainInfo, ChainClient } from 'drand-client';
import { bytesToHex, hexToBytes } from './crypto';
import { TimelockNotReleasedError } from './types';

export const QUICKNET = Object.freeze({
  name: 'drand-quicknet-v1',
  chainHash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  publicKey:
    '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a',
  genesisTime: 1692803367,
  period: 3,
  schemeId: 'bls-unchained-g1-rfc9380',
});

const QUICKNET_RELAYS = Object.freeze([
  'https://api.drand.sh',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
  'https://drand.cloudflare.com',
]);

function validateQuicknetInfo(info: ChainInfo): void {
  if (
    info.hash !== QUICKNET.chainHash ||
    info.public_key !== QUICKNET.publicKey ||
    info.genesis_time !== QUICKNET.genesisTime ||
    info.period !== QUICKNET.period ||
    info.schemeID !== QUICKNET.schemeId
  ) {
    throw new Error('The drand quicknet chain information does not match the pinned V1 network.');
  }
}

export function expectedQuicknetRound(unlockAt: number): number {
  if (!Number.isSafeInteger(unlockAt) || unlockAt <= 0 || unlockAt < QUICKNET.genesisTime) {
    throw new Error('Unlock time must be a positive Unix timestamp after quicknet genesis.');
  }

  const round = Math.ceil((unlockAt - QUICKNET.genesisTime) / QUICKNET.period) + 1;
  if (!Number.isSafeInteger(round) || round < 1) {
    throw new Error('Unlock time cannot be represented as a drand quicknet round.');
  }

  const timestamp = roundTime(
    {
      hash: QUICKNET.chainHash,
      public_key: QUICKNET.publicKey,
      genesis_time: QUICKNET.genesisTime,
      period: QUICKNET.period,
      schemeID: QUICKNET.schemeId,
      groupHash: '',
      metadata: { beaconID: 'quicknet' },
    },
    round,
  ) / 1000;

  if (timestamp < unlockAt || (round > 1 && timestamp - QUICKNET.period >= unlockAt)) {
    throw new Error('The selected drand round does not meet the V1 unlock-time rule.');
  }

  return round;
}

function createV1Client(endpoint: string): ChainClient {
  const options = {
    ...defaultChainOptions,
    chainVerificationParams: { chainHash: QUICKNET.chainHash, publicKey: QUICKNET.publicKey },
  };
  const chain = new HttpCachingChain(`${endpoint}/${QUICKNET.chainHash}`, options);
  const client = new HttpChainClient(chain, options);
  const originalGet = client.get.bind(client);
  const cache = new Map<number, Promise<Awaited<ReturnType<ChainClient['get']>>>>();
  client.get = (round: number) => {
    if (!cache.has(round)) cache.set(round, originalGet(round));
    return cache.get(round)!;
  };
  return client;
}

function normalizeV2Info(raw: any): ChainInfo {
  return {
    ...raw,
    hash: raw.hash ?? raw.chain_hash,
    public_key: raw.public_key ?? raw.publicKey,
    genesis_time: Number(raw.genesis_time ?? raw.genesisTime),
    period: Number(raw.period),
    schemeID: raw.schemeID ?? raw.scheme_id ?? raw.scheme,
    groupHash: raw.groupHash ?? raw.genesis_seed,
    metadata: raw.metadata ?? { beaconID: raw.beacon_id ?? 'quicknet' },
  } as ChainInfo;
}

async function readDrandV2Beacon(endpoint: string, path: string, expectedRound?: number) {
  const response = await fetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`drand v2 returned HTTP ${response.status}.`);
  const raw = await response.json() as { round?: unknown; signature?: unknown; randomness?: unknown };
  const round = Number(raw.round);
  if (!Number.isSafeInteger(round) || (expectedRound !== undefined && round !== expectedRound)) {
    throw new Error('drand v2 returned a different round than requested.');
  }
  if (typeof raw.signature !== 'string' || !/^[0-9a-f]{96}$/i.test(raw.signature)) {
    throw new Error('drand v2 returned an invalid BLS signature encoding.');
  }
  let randomness: string;
  if (typeof raw.randomness === 'string') {
    randomness = raw.randomness;
  } else {
    const signatureBytes = hexToBytes(`0x${raw.signature}`);
    const signatureBuffer = new ArrayBuffer(signatureBytes.length);
    new Uint8Array(signatureBuffer).set(signatureBytes);
    randomness = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', signatureBuffer))).slice(2);
  }
  return { round, signature: raw.signature, randomness };
}

function createV2Client(endpoint: string): ChainClient {
  const options = {
    ...defaultChainOptions,
    chainVerificationParams: { chainHash: QUICKNET.chainHash, publicKey: QUICKNET.publicKey },
  };
  let cachedInfo: Promise<ChainInfo> | undefined;
  const chain = {
    baseUrl: endpoint,
    info: () => {
      cachedInfo ??= fetch(`${endpoint}/v2/beacons/quicknet/info`, { signal: AbortSignal.timeout(8_000) })
        .then(async (response) => {
          if (!response.ok) throw new Error(`drand v2 returned HTTP ${response.status}.`);
          return normalizeV2Info(await response.json());
        });
      return cachedInfo;
    },
  };
  const cache = new Map<number, Promise<Awaited<ReturnType<ChainClient['get']>>>>();
  const client = {
    options,
    chain: () => chain,
    get: (round: number) => {
      if (!cache.has(round)) cache.set(round, readDrandV2Beacon(endpoint, `/v2/beacons/quicknet/rounds/${round}`, round));
      return cache.get(round)!;
    },
    latest: () => readDrandV2Beacon(endpoint, '/v2/beacons/quicknet/rounds/latest'),
  };
  return client as ChainClient;
}

export function createQuicknetClients(endpoints: readonly string[] = QUICKNET_RELAYS): ChainClient[] {
  const unique = [...new Set(endpoints.map((endpoint) => endpoint.replace(/\/$/, '')))];
  return unique.flatMap((endpoint) => [createV1Client(endpoint), createV2Client(endpoint)]);
}

async function assertQuicknetInfo(client: ChainClient): Promise<ChainInfo> {
  const info = await client.chain().info();
  validateQuicknetInfo(info);
  return info;
}

function roundFromArmor(ciphertext: string): number {
  const body = ciphertext.split(/\r?\n/).filter((line) => line && !line.startsWith('-----')).join('');
  const decoded = atob(body);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const header = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  const match = /^age-encryption\.org\/v1\n-> tlock ([0-9]+) ([0-9a-f]{64})\n/.exec(header);
  if (!match || match[2] !== QUICKNET.chainHash) throw new Error('The tlock header does not target pinned drand quicknet.');
  const round = Number(match[1]);
  if (!Number.isSafeInteger(round) || round < 1) throw new Error('The tlock header contains an invalid round.');
  return round;
}

export async function sealForQuicknetRound(round: number, plaintext: Uint8Array): Promise<string> {
  const failures: string[] = [];
  for (const client of createQuicknetClients()) {
    try {
      await assertQuicknetInfo(client);
      const latest = await client.latest();
      if (!Number.isSafeInteger(latest.round) || latest.round < 1) throw new Error('drand returned an invalid latest round.');
      await fetchBeacon(client, latest.round);
      if (!Number.isSafeInteger(round) || round <= latest.round) {
        throw new Error('The requested drand quicknet round has already been published.');
      }
      return await timelockEncrypt(round, Buffer.from(plaintext), client);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.includes('already been published')) throw error;
      failures.push(detail);
    }
  }
  throw new Error(`No drand relay returned pinned quicknet metadata and a verified latest beacon. ${failures.join(' | ')}`);
}

export async function openQuicknetCiphertext(ciphertext: string): Promise<Uint8Array> {
  const round = roundFromArmor(ciphertext);
  const failures: string[] = [];
  for (const client of createQuicknetClients()) {
    try {
      const info = await assertQuicknetInfo(client);
      if (roundTime(info, round) > Date.now()) throw new TimelockNotReleasedError();
      await fetchBeacon(client, round);
      return new Uint8Array(await timelockDecrypt(ciphertext, client));
    } catch (error) {
      if (error instanceof TimelockNotReleasedError) throw error;
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No drand relay returned pinned quicknet metadata and a valid signature for round ${round}. ${failures.join(' | ')}`);
}

export function validateQuicknetArmor(ciphertext: string, round: number, chainHash: string): void {
  if (
    !ciphertext.startsWith('-----BEGIN AGE ENCRYPTED FILE-----\n') ||
    !ciphertext.endsWith('-----END AGE ENCRYPTED FILE-----\n')
  ) {
    throw new Error('Invalid tlock AGE armor.');
  }

  const body = ciphertext
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('-----'))
    .join('');
  let decodedHeader: string;
  try {
    const encoded = atob(body);
    const bytes = Uint8Array.from(encoded, (character) => character.charCodeAt(0));
    // The AGE body after its stanza header is binary, so inspect only the UTF-8 prefix.
    decodedHeader = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  } catch {
    throw new Error('Invalid tlock AGE payload encoding.');
  }

  const header = /^age-encryption\.org\/v1\n-> tlock ([0-9]+) ([0-9a-f]{64})\n/.exec(decodedHeader);
  if (!header || Number(header[1]) !== round || header[2] !== chainHash) {
    throw new Error('The tlock ciphertext header does not match its declared round and chain.');
  }
}
