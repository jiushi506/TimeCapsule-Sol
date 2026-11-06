import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteLocalDraft,
  getActiveLocalDraftId,
  getLocalDrafts,
  saveLocalDraft,
  setActiveLocalDraftId,
} from "../draftService";

test("explicit browser drafts never persist extra passphrase/key fields and remain wallet-scoped", () => {
  const previousLocal = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const previousSession = Object.getOwnPropertyDescriptor(
    globalThis,
    "sessionStorage",
  );
  const storage = () => {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      values,
    };
  };
  const local = storage();
  const session = storage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: local,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: session,
  });
  try {
    const draft = saveLocalDraft(
      {
        message: "Synthetic test draft",
        mode: "private",
        publicTitle: "",
        localLabel: "Test",
        unlockDate: "2027-01-01T00:00",
        password: "NEVER-PERSIST-THIS",
        contentKey: "NEVER-PERSIST-KEY",
      } as any,
      { key: "wallet-a" },
    );
    assert.equal(getLocalDrafts("wallet-a").length, 1);
    assert.equal(getLocalDrafts("wallet-b").length, 0);
    assert.equal(draft.timeZone, "UTC");
    assert.doesNotMatch(
      [...local.values.values()].join(""),
      /NEVER-PERSIST|password|contentKey/,
    );
    setActiveLocalDraftId(draft.id, "wallet-a");
    deleteLocalDraft(draft.id, "wallet-b");
    assert.equal(getLocalDrafts("wallet-a").length, 1);
    deleteLocalDraft(draft.id, "wallet-a");
    assert.equal(getLocalDrafts("wallet-a").length, 0);
    assert.equal(getActiveLocalDraftId("wallet-a"), null);
  } finally {
    for (const [key, previous] of [
      ["localStorage", previousLocal],
      ["sessionStorage", previousSession],
    ] as const) {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else delete (globalThis as any)[key];
    }
  }
});
