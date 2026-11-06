import { deleteLocalDraft } from "./draftService";
import { saveCapsuleLabel } from "./localCapsuleLabelService";

export interface LocalPublicationContext {
  owner: string;
  payloadHash: string;
  draftId: string | null;
  localLabel: string;
}

export interface LocalPublicationResult {
  localLabelSaved?: boolean;
  localLabelSaveError?: string;
  draftCleanupError?: string;
}

/** Browser housekeeping runs only after the matching chain record is verified. */
export function finishLocalSolanaPublication(
  record: {
    owner: string;
    capsulePda: string;
    payloadHash: string;
    mode: "public" | "private";
  },
  context: LocalPublicationContext,
): LocalPublicationResult {
  if (
    record.owner !== context.owner ||
    record.payloadHash !== context.payloadHash
  ) {
    throw new Error(
      "The confirmed capsule does not match the local publication review.",
    );
  }
  const result: LocalPublicationResult = {};
  if (record.mode === "private" && context.localLabel.trim()) {
    try {
      saveCapsuleLabel(
        record.owner,
        record.capsulePda,
        context.localLabel.normalize("NFC").trim(),
      );
      result.localLabelSaved = true;
    } catch {
      result.localLabelSaveError = "The capsule is confirmed, but this browser could not save its local name.";
    }
  }
  if (context.draftId) {
    try {
      deleteLocalDraft(context.draftId, `public-solana:${record.owner}`);
    } catch {
      result.draftCleanupError = "The capsule is confirmed, but its local text draft could not be removed. Delete it from My capsules when browser storage is available.";
    }
  }
  return result;
}
