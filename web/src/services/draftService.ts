export interface LocalDraft {
  id: string;
  message: string;
  mode: "public" | "private";
  publicTitle: string;
  localLabel: string;
  unlockDate: string;
  timeZone?: "UTC" | "local";
  updatedAt: number;
}
type Scope = string | { key: string };
const storageKey = (scope?: Scope) =>
  `timecapsule-public-drafts:${(typeof scope === "object" ? scope.key : scope) ?? "public-solana:drafts"}`;
export function getLocalDrafts(scope?: Scope): LocalDraft[] {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(scope)) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (item) =>
            item &&
            typeof item.id === "string" &&
            typeof item.message === "string" &&
            (item.mode === "private" || item.mode === "public") &&
            typeof item.unlockDate === "string" &&
            Number.isFinite(item.updatedAt),
        )
      : [];
  } catch {
    return [];
  }
}
export function saveLocalDraft(
  draft: Omit<LocalDraft, "id" | "updatedAt"> & { id?: string },
  scope?: Scope,
): LocalDraft {
  const next = {
    message: draft.message,
    mode: draft.mode,
    publicTitle: draft.publicTitle,
    localLabel: draft.localLabel,
    unlockDate: draft.unlockDate,
    timeZone: draft.timeZone ?? ("UTC" as const),
    id: draft.id ?? crypto.randomUUID(),
    updatedAt: Date.now(),
  };
  localStorage.setItem(
    storageKey(scope),
    JSON.stringify([
      next,
      ...getLocalDrafts(scope).filter((item) => item.id !== next.id),
    ]),
  );
  return next;
}
export function deleteLocalDraft(id: string, scope?: Scope): void {
  localStorage.setItem(
    storageKey(scope),
    JSON.stringify(getLocalDrafts(scope).filter((item) => item.id !== id)),
  );
  if (getActiveLocalDraftId(scope) === id)
    sessionStorage.removeItem(`${storageKey(scope)}:active`);
}
export function setActiveLocalDraftId(id: string, scope?: Scope) {
  sessionStorage.setItem(`${storageKey(scope)}:active`, id);
}
export function getActiveLocalDraftId(scope?: Scope) {
  return sessionStorage.getItem(`${storageKey(scope)}:active`);
}
