export const APP_ROUTES = ['home', 'create', 'my', 'explore', 'recover'] as const;
export type AppRoute = typeof APP_ROUTES[number];
export function parseAppHash(hash: string) {
  const [path, search = ''] = hash.replace(/^#\/?/, '').split('?');
  return { route: APP_ROUTES.includes(path as AppRoute) ? path as AppRoute : 'home' as AppRoute, search: search ? `?${search}` : '' };
}
export function buildRouteHash(route: string, params?: Record<string, string | number | undefined>) {
  const search = new URLSearchParams(Object.entries(params ?? {}).filter(([,v]) => v !== undefined).map(([k,v]) => [k, String(v)]));
  return `#/${route}${search.size ? `?${search}` : ''}`;
}
export const JUDGE_SAMPLE_RECOVERY = { capsulePda: '5At5wn2mR2SPbexvJtJPHjsmuEBGd4k664dtJzggz6YH' };
export const buildJudgeRecoveryUrl = (origin: string) => `${origin.replace(/\/$/, '')}/${buildRouteHash('recover', JUDGE_SAMPLE_RECOVERY)}`;
