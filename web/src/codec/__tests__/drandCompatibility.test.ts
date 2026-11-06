import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fetchBeacon } from 'drand-client';
import type { ChainClient } from 'drand-client';
import { mainnetClient, timelockDecrypt } from 'tlock-js';
import { sha256Hex } from '../crypto';
import { QUICKNET, createQuicknetClients } from '../timelock';

async function main(): Promise<void> {
  const vectorPath = resolve(process.cwd(), '../target/tlock-live-vector.json');
  const vector = JSON.parse(await readFile(vectorPath, 'utf8')) as {
    chainHash: string;
    round: number;
    releasedCekSha256: string;
    timelockCiphertext: string;
  };
  assert.equal(vector.chainHash, QUICKNET.chainHash, 'fixture belongs to the pinned V1 quicknet chain');

  const legacyClient = mainnetClient();
  const legacyBeacon = await fetchBeacon(legacyClient, vector.round);
  const clients = createQuicknetClients(['https://api.drand.sh']);
  const v2Client = clients[1];
  const info = await v2Client.chain().info();
  assert.equal(info.hash, QUICKNET.chainHash);
  assert.equal(info.public_key, QUICKNET.publicKey);
  assert.equal(info.schemeID, QUICKNET.schemeId, 'v2 scheme maps to the frozen V1 tlock scheme');
  const v2Beacon = await fetchBeacon(v2Client, vector.round);
  assert.equal(v2Beacon.round, legacyBeacon.round);
  assert.equal(v2Beacon.signature, legacyBeacon.signature, 'v1 and v2 APIs return the same authentic signed beacon');
  assert.equal(v2Beacon.randomness, legacyBeacon.randomness, 'v2 signature-only responses derive the v1 randomness field');

  const forgedSignature = `${v2Beacon.signature[0] === '0' ? '1' : '0'}${v2Beacon.signature.slice(1)}`;
  const forgedRandomness = createHash('sha256').update(Buffer.from(forgedSignature, 'hex')).digest('hex');
  const forgedClient = {
    options: v2Client.options,
    chain: () => v2Client.chain(),
    get: async () => ({ ...v2Beacon, signature: forgedSignature, randomness: forgedRandomness }),
    latest: async () => v2Beacon,
  } as ChainClient;
  await assert.rejects(
    fetchBeacon(forgedClient, vector.round),
    undefined,
    'a forged signature with a matching derived randomness is rejected by BLS verification',
  );

  const released = new Uint8Array(await timelockDecrypt(vector.timelockCiphertext, v2Client));
  assert.equal(await sha256Hex(released), vector.releasedCekSha256, 'v2 API beacon decrypts the frozen V1 AGE/tlock ciphertext');
  released.fill(0);
  console.log(`PASS real drand v1/v2 compatibility and signature verification for quicknet round ${vector.round}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
