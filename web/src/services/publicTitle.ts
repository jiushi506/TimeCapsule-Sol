export const MAX_PUBLIC_TITLE_CHARACTERS = 512;
export const MAX_PUBLIC_TITLE_BYTES = MAX_PUBLIC_TITLE_CHARACTERS * 4;

/** Count Unicode code points after the caller applies its chosen normalization. */
export function countPublicTitleCharacters(value: string): number {
  return Array.from(value).length;
}

/** Keep both ends of a long title so the identifying words remain visible. */
export function middleEllipsis(value: string, visibleCharacters: number): string {
  const characters = Array.from(value);
  if (characters.length <= visibleCharacters) return value;
  if (visibleCharacters <= 1) return '…';
  const retained = visibleCharacters - 1;
  const start = Math.ceil(retained / 2);
  const end = Math.floor(retained / 2);
  return `${characters.slice(0, start).join('')}…${end ? characters.slice(-end).join('') : ''}`;
}
