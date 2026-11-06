export const MAX_LOCAL_LABEL_CHARACTERS = 512;
const key = (owner: string, pda: string) => `timecapsule-public-label:${owner}:${pda}`;
export function getCapsuleLabel(owner: string, pda: string): string { try { return localStorage.getItem(key(owner, pda)) ?? ''; } catch { return ''; } }
export function saveCapsuleLabel(owner: string, pda: string, value: string): void { localStorage.setItem(key(owner, pda), Array.from(value).slice(0, MAX_LOCAL_LABEL_CHARACTERS).join('')); }
