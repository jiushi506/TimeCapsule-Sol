import type { ReactNode } from 'react';
import { KeyRound, RefreshCw } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export function CapsulePageHeader({ title, description, badges, actions, children, centered = false }: {
  title: string; description: ReactNode; badges: ReactNode; actions?: ReactNode; children?: ReactNode; centered?: boolean;
}) {
  return <header className={`capsule-page-header${centered ? ' capsule-page-header-centered' : ''}`}>
    <div className="capsule-page-header-copy">
      <div className="capsule-page-badges">{badges}</div>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </div>
    {actions && <div className="capsule-page-header-actions">{actions}</div>}
  </header>;
}

export function PortfolioHeader({ isLoading, isConnected, onRefresh, onCreate, isDemo = false, description, children }: {
  isLoading: boolean; isConnected: boolean; onRefresh: () => void; onCreate: () => void; isDemo?: boolean; description?: ReactNode; children?: ReactNode;
}) {
  const { t } = useLanguage();
  return <CapsulePageHeader title={t('my.title')}
    description={description ?? t(isDemo ? 'my.subtitleDemo' : 'my.subtitle')}
    badges={<span className="badge badge-cyan">{t(isDemo ? 'my.badgeLocalPortfolio' : 'my.badgePortfolio')}</span>}
    actions={<>
      <button id="btn-refresh-capsules" type="button" onClick={onRefresh} disabled={isLoading || !isConnected} className="btn-secondary"><RefreshCw size={14} className={isLoading ? 'animate-spin-slow' : ''} />{t(isDemo ? 'my.refreshDemo' : 'my.btnRefresh')}</button>
      <button id="btn-new-capsule" type="button" onClick={onCreate} className="btn-primary"><KeyRound size={16} />{t('my.btnSealNew')}</button>
    </>}>{children}</CapsulePageHeader>;
}

export function WalletIdentityBanner({ address, walletName, networkName, balance, balanceTitle }: {
  address: string; walletName: string; networkName: string; balance?: string; balanceTitle?: string;
}) {
  const { t } = useLanguage();
  return <div id="dashboard-identity-banner" className="connected-card portfolio-identity-banner">
    <div className="dashboard-identity-main" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div className="status-dot-pulse" style={{ width: 12, height: 12, borderRadius: '50%', background: '#10b981', flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div className="dashboard-identity-labels" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ fontSize: '.74rem', fontWeight: 800, color: '#34d399', letterSpacing: '.06em' }}>{t('auth.signedIn')}</span>
          <span className="badge badge-purple" style={{ fontSize: '.65rem', padding: '2px 8px' }}>{walletName}</span>
        </div>
        <div style={{ fontSize: '.92rem', color: '#f8fafc', fontWeight: 600 }}>{t('my.address')} <span className="font-mono dashboard-identity-address" style={{ color: 'var(--cyan-primary)' }}>{address}</span></div>
      </div>
    </div>
    <div className="portfolio-identity-network">
      {balance && <span className="portfolio-identity-balance" title={balanceTitle}>💰 {balance}</span>}
      <span className="portfolio-identity-chain">{networkName}</span>
    </div>
  </div>;
}

export function CapsuleEmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: ReactNode; action?: ReactNode }) {
  return <div className="glass-panel capsule-empty-state"><div className="capsule-empty-icon">{icon}</div><h2>{title}</h2><p>{description}</p>{action}</div>;
}
