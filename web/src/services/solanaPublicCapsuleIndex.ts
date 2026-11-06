import {
  fetchSolanaCapsulesByOwner,
  fetchSolanaPublicCapsules,
  fetchSolanaCapsule,
  type SolanaCapsuleRecord,
} from "./solanaCapsuleService";
// Presentation compatibility for the original views. Every record here comes
// from public RPC; no private index API, database schema or server is included.
export type IndexedSolanaCapsuleMetadata = SolanaCapsuleRecord;
export async function fetchIndexedSolanaCapsules(
  options: { ownerAddress?: string; signal?: AbortSignal } = {},
) {
  options.signal?.throwIfAborted();
  const records = options.ownerAddress
    ? await fetchSolanaCapsulesByOwner(options.ownerAddress)
    : await fetchSolanaPublicCapsules();
  options.signal?.throwIfAborted();
  return {
    capsules: records.filter((record) => record.formatVersion === 1),
    status: "available" as const,
    coverage: "direct Solana RPC",
  };
}
export async function fetchVerifiedIndexedSolanaCapsule(
  record: SolanaCapsuleRecord,
) {
  const verified = await fetchSolanaCapsule({ capsulePda: record.capsulePda });
  if (
    verified.owner !== record.owner ||
    verified.payloadHash !== record.payloadHash ||
    verified.unlockAt !== record.unlockAt
  )
    throw new Error("The account no longer matches the selected capsule.");
  return verified;
}
