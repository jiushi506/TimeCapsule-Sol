const COMMON_PASSWORD_FRAGMENTS = [
  'password',
  'qwerty',
  'asdf',
  'zxcv',
  'letmein',
  'welcome',
  'admin',
  'abcdef',
  '123456',
  'qazwsx',
];

function hasObviousSequence(value: string): boolean {
  let direction = 0;
  let runLength = 1;

  for (let index = 1; index < value.length; index += 1) {
    const delta = value.charCodeAt(index) - value.charCodeAt(index - 1);
    const nextDirection = delta === 1 ? 1 : delta === -1 ? -1 : 0;
    if (nextDirection !== 0 && nextDirection === direction) {
      runLength += 1;
    } else {
      direction = nextDirection;
      runLength = nextDirection === 0 ? 1 : 2;
    }
    if (runLength >= 6) return true;
  }

  return false;
}

function hasObviousRepeatedPattern(value: string): boolean {
  for (let patternLength = 1; patternLength <= Math.min(6, Math.floor(value.length / 2)); patternLength += 1) {
    if (value.length % patternLength !== 0) continue;
    const pattern = value.slice(0, patternLength);
    if (pattern.repeat(value.length / patternLength) === value) return true;
  }
  return false;
}

/** Returns the UI strength score from 0 (too weak) to 4 (very strong). */
export function getPasswordStrength(password: string): number {
  if (!password || password.length < 12) return 0;

  const normalized = password.normalize('NFKC').toLowerCase();
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  if (
    hasObviousRepeatedPattern(normalized) ||
    hasObviousSequence(compact) ||
    COMMON_PASSWORD_FRAGMENTS.some((fragment) => compact.includes(fragment))
  ) return 0;

  const uniqueCharacters = new Set(Array.from(normalized)).size;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  const characterClasses = [hasLower, hasUpper, hasNumber, hasSymbol].filter(Boolean).length;

  let score = password.length >= 12 ? 1 : 0;
  if (password.length >= 12 && uniqueCharacters >= 8) score += 1;
  if (characterClasses >= 2 && uniqueCharacters >= 6) score += 1;
  if (characterClasses >= 3 && uniqueCharacters >= 8) score += 1;

  return Math.min(4, score);
}
