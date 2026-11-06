import assert from "node:assert/strict";
import test from "node:test";
import { getActiveLocalDraftId, getLocalDrafts, saveLocalDraft, setActiveLocalDraftId } from "../draftService";
import { getCapsuleLabel } from "../localCapsuleLabelService";
import { finishLocalSolanaPublication } from "../localSolanaPublication";

function withStorage(check: (local: Map<string, string>) => void) {
  const previous = ["localStorage", "sessionStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const local = new Map<string, string>();
  for (const key of ["localStorage", "sessionStorage"]) {
    const values = key === "localStorage" ? local : new Map<string, string>();
    Object.defineProperty(globalThis, key, { configurable: true, value: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem: (name: string) => values.delete(name),
    } });
  }
  try { check(local); } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}
const record = { owner: "synthetic-owner-a", capsulePda: "synthetic-pda", payloadHash: `0x${"ab".repeat(32)}`, mode: "private" as const };
const context = { owner: record.owner, payloadHash: record.payloadHash, localLabel: "  My local memory  ", draftId: "same-id" };
const draft = { id: "same-id", message: "Synthetic plaintext draft", mode: "private" as const, publicTitle: "", localLabel: "My local memory", unlockDate: "2027-01-01T00:00" };

test("confirmed publication saves its local name and removes only the publishing wallet's text draft", () => withStorage(() => {
  saveLocalDraft(draft, `public-solana:${record.owner}`);
  saveLocalDraft(draft, "public-solana:synthetic-owner-b");
  setActiveLocalDraftId(draft.id, `public-solana:${record.owner}`);
  const result = finishLocalSolanaPublication(record, context);
  assert.equal(result.localLabelSaved, true);
  assert.equal(getCapsuleLabel(record.owner, record.capsulePda), "My local memory");
  assert.equal(getLocalDrafts(`public-solana:${record.owner}`).length, 0);
  assert.equal(getActiveLocalDraftId(`public-solana:${record.owner}`), null);
  assert.equal(getLocalDrafts("public-solana:synthetic-owner-b").length, 1);
}));

test("a different owner or payload cannot consume the reviewed draft or local name", () => withStorage((local) => {
  saveLocalDraft(draft, `public-solana:${record.owner}`);
  const before = [...local];
  assert.throws(() => finishLocalSolanaPublication({ ...record, owner: "synthetic-owner-b" }, context), /does not match/);
  assert.throws(() => finishLocalSolanaPublication({ ...record, payloadHash: `0x${"cd".repeat(32)}` }, context), /does not match/);
  assert.deepEqual([...local], before);
}));

test("browser storage failures report housekeeping warnings without failing a confirmed publication", () => withStorage(() => {
  localStorage.setItem = () => { throw new Error("Synthetic quota failure"); };
  const result = finishLocalSolanaPublication(record, context);
  assert.equal(result.localLabelSaved, undefined);
  assert.match(result.localLabelSaveError!, /capsule is confirmed/);
  assert.match(result.draftCleanupError!, /capsule is confirmed/);
}));

test("public publication never turns an unrelated private label into the public capsule's name", () => withStorage(() => {
  const result = finishLocalSolanaPublication({ ...record, mode: "public" }, { ...context, draftId: null });
  assert.equal(result.localLabelSaved, undefined);
  assert.equal(getCapsuleLabel(record.owner, record.capsulePda), "");
}));
