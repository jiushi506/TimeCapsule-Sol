import { KeyRound, ShieldCheck, Wallet } from 'lucide-react';
import { useAuthSession } from '../context/useAuthSession';
import { useLanguage } from '../context/LanguageContext';

export function WalletSignInActions({ returnTo, compact = false }: { returnTo: string; compact?: boolean }) {
  const auth = useAuthSession();
  const { t } = useLanguage();
  const waiting = auth.loginPhase === 'waiting' || auth.loginPhase === 'checking';
  if (auth.status === 'authenticated') return <div className="wallet-sign-in-actions">
    {!compact && <span className="wallet-sign-in-confirmed"><ShieldCheck size={16} />{t('auth.signedIn')}</span>}
    <button type="button" className="btn-secondary" onClick={() => void auth.logout()}>{t('auth.signOut')}</button>
  </div>;
  if (auth.status === 'loading') return <span role="status" className="wallet-sign-in-note">{t('auth.checking')}</span>;
  if (auth.status !== 'anonymous' && !auth.walletMismatch && !waiting) return <div className="wallet-sign-in-actions">
    <button type="button" className="btn-secondary" onClick={() => void auth.refresh()}>{t('auth.retry')}</button>
    {!compact && <span role="status">{t(auth.status === 'forbidden' ? 'auth.accessUnavailable' : 'auth.sessionUnavailable')}</span>}
  </div>;
  const feedback = ['blocked', 'cancelled', 'unavailable', 'expired'].includes(auth.loginPhase)
    ? t(`auth.login.${auth.loginPhase}`) : '';
  return <div className={`wallet-sign-in-actions${compact ? ' is-compact' : ''}`}>
    <button type="button" className="btn-primary" onClick={() => auth.login(returnTo)}>
      <KeyRound size={16} aria-hidden="true" />{t(waiting ? 'auth.login.continueWindow' : 'auth.walletSignIn')}
    </button>
    {waiting && <button type="button" className="wallet-sign-in-link" onClick={auth.cancelLogin}>{t('auth.login.cancel')}</button>}
    {!compact && feedback && <p role="status" className="wallet-sign-in-note">{feedback}</p>}
    {!compact && auth.loginPhase === 'blocked' && <button type="button" className="wallet-sign-in-link" onClick={() => auth.loginInThisTab(returnTo)}>{t('auth.login.continueHere')}</button>}
  </div>;
}

export function WalletSignInPanel({ returnTo }: { returnTo: string }) {
  const { t } = useLanguage();
  return <section className="wallet-sign-in-panel">
    <div className="wallet-sign-in-symbol"><Wallet size={27} aria-hidden="true" /></div>
    <div className="wallet-sign-in-content">
      <h2>{t('auth.walletStartTitle')}</h2>
      <p>{t('auth.walletStartDescription')}</p>
      <WalletSignInActions returnTo={returnTo} />
      <p className="wallet-sign-in-note"><ShieldCheck size={14} aria-hidden="true" />{t('wallet.nonCustodialNotice')}</p>
    </div>
  </section>;
}
