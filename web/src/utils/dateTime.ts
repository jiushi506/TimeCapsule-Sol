/** Product dates use UTC everywhere; browser locale must never change the moment. */
export const TIME_ZONE_LABEL = 'UTC';

export function parseUtcInput(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return new Date(NaN);
  const date = new Date(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`);
  // Reject invalid calendar days that Date would silently roll into next month.
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, value.length) !== value) return new Date(NaN);
  return date;
}

export function toUtcInput(value: Date | number | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 19) : '';
}

export function formatUtcDateTime(value: Date | number | string): string {
  const input = toUtcInput(value);
  return input ? `${input.replace('T', ' ')} UTC` : '—';
}

/** Pre-UTC drafts contained browser-local wall time. Preserve its old meaning. */
export function draftUnlockInput(value: string, timeZone?: string): string {
  return toUtcInput(timeZone === 'UTC' ? parseUtcInput(value) : new Date(value));
}
