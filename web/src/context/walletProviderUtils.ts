export function parseWalletChainId(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
export const getWalletNetworkErrorKey = (_error: unknown) => 'nav.networkSwitchError';
export const getWalletNetworkSwitchAttemptKey = (_options: unknown): string | null => null;
export const shouldShowWalletNetworkNotice = (_options: unknown) => false;
