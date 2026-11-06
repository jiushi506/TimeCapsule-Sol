export type UnlockTimePreset = '90s' | '1h' | '1m' | '1y' | '5y' | '10y' | '20y';

/** Short presets are elapsed time; month/year presets follow the UTC calendar. */
export function getPresetUnlockDate(now: Date, preset: UnlockTimePreset): Date {
  if (preset === '90s' || preset === '1h') {
    return new Date(now.getTime() + (preset === '90s' ? 90 : 3600) * 1000);
  }
  const months = preset === '1m' ? 1 : Number(preset.slice(0, -1)) * 12;
  const targetMonth = now.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(now.getUTCFullYear(), targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(now.getUTCFullYear(), targetMonth, Math.min(now.getUTCDate(), lastDay),
    now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
}
