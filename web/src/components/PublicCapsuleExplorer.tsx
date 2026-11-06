import { formatUtcDateTime } from '../utils/dateTime';
import type { ReactNode } from 'react';
import { Sparkles, Unlock } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAccessibleModal } from '../utils/useAccessibleModal';
import { CapsulePageHeader } from './CapsulePageLayout';
import { CapsuleTitleText } from './CapsuleTitleText';
import { LoadingText } from './LoadingText';

export type ExplorerFilter = 'all' | 'unlocked' | 'locked';
export type ExplorerReadState = 'loading' | 'partial' | 'success-empty' | 'success-data' | 'error';

export function ExplorerHeader({ networkName }: { networkName: string }) {
  const { t } = useLanguage();
  return <CapsulePageHeader centered title={t('explore.title')} description={<>{t('recovery.verifiedViaRpc')} {networkName}.</>}
    badges={<><span className="badge badge-cyan">{t('recovery.verifiedViaRpc')}</span><span className="badge badge-purple">{t('explore.badgeSecondary')}</span></>} />;
}

export function ExplorerToolbar({ filter, onFilter, count, hasLoaded, isLoading, onRefresh, onCreate }: {
  filter: ExplorerFilter; onFilter: (value: ExplorerFilter) => void; count: number; hasLoaded: boolean; isLoading: boolean; onRefresh: () => void; onCreate: () => void;
}) {
  const { t } = useLanguage();
  return <div className="explorer-toolbar">
    <div className="explorer-filters" role="tablist" aria-label={t('explore.title')}>
      {(['all', 'unlocked', 'locked'] as const).map((value) => <button key={value} id={`tab-filter-${value}`} role="tab" aria-selected={filter === value} type="button"
        className={filter === value ? `explorer-filter-active explorer-filter-${value}` : ''} onClick={() => onFilter(value)}>
        {t(value === 'all' ? 'explore.loadedVaults' : value === 'unlocked' ? 'explore.targetDatePassed' : 'explore.upcomingFuture')}{value === 'all' && hasLoaded ? ` (${count})` : ''}
      </button>)}
    </div>
    <button id="btn-explore-refresh" type="button" className="btn-secondary" disabled={isLoading} onClick={onRefresh}>{t('explore.refreshChain')}</button>
    <button id="btn-explore-create" type="button" className="btn-primary" onClick={onCreate}><Sparkles size={14} />{t('explore.sealPublic')}</button>
  </div>;
}

export function ExplorerReadStatus({ state, children }: { state: ExplorerReadState; children: ReactNode }) {
  const { t } = useLanguage();
  const labels = { loading: 'explore.stateLoading', partial: 'explore.statePartial', 'success-empty': 'explore.stateEmpty', 'success-data': 'explore.stateLoaded', error: 'explore.stateError' };
  return <section data-read-state={state} role={state === 'error' ? 'alert' : 'status'} aria-live="polite" className={`explorer-read-status${state === 'error' ? ' explorer-read-error' : ''}`}>
    <strong style={{ display: 'block', marginBottom: 3 }}>{t(labels[state])}</strong><span>{children}</span>
  </section>;
}

export function PublicCapsuleCard({ id, capsuleId, owner, title, verifiedTitle, indexedMetadata = false, badges, identity, identityLink, unlockAt, now, onRead }: {
  id: string; capsuleId: number | string; owner: string; title: string; verifiedTitle: boolean; indexedMetadata?: boolean; badges?: ReactNode; identity: ReactNode; identityLink?: ReactNode; unlockAt: number; now: number; onRead: () => void;
}) {
  const { t } = useLanguage();
  const passed = now >= unlockAt;
  return <article id={id} className="glass-panel explore-capsule-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
    <div>
      <div className="explore-card-heading">
        <div className="explore-card-identifiers"><span className="font-mono" style={{ fontWeight: 700, color: 'var(--cyan-primary)', overflowWrap: 'anywhere' }}>#{capsuleId}</span>{badges}</div>
        <span className={`badge explore-card-target-badge ${passed ? 'badge-emerald' : 'badge-amber'}`}>{t(passed ? 'explore.targetPassed' : 'explore.beforeTarget')}</span>
      </div>
      <div style={{ fontSize: '.78rem', color: 'var(--text-dim)', marginBottom: 14 }}>{t('recovery.owner')}: <span className="font-mono" title={owner} style={{ color: 'var(--text-muted)' }}>{owner.slice(0, 8)}…</span></div>
      <h2 style={{ margin: '0 0 6px', fontSize: '1.08rem', fontWeight: 750, lineHeight: 1.35 }}><CapsuleTitleText text={title} showFullTitleOnHover /></h2>
      <div style={{ color: 'var(--text-dim)', fontSize: '.7rem', marginBottom: 12 }}>{t(indexedMetadata ? 'explore.indexedTitle' : verifiedTitle ? 'explore.verifiedPublicTitle' : 'explore.defaultName')}</div>
      <div className="font-mono" style={{ fontSize: '.68rem', color: 'var(--text-dim)', marginBottom: 4, overflowWrap: 'anywhere' }}>{identity}</div>
      {identityLink && <div className="explorer-identity-link">{identityLink}</div>}
      <div style={{ background: 'rgba(0,0,0,.3)', padding: 12, borderRadius: 'var(--radius-sm)', marginBottom: 16, fontSize: '.8rem' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: '.74rem', marginBottom: 4 }}>{t('my.unlockDate')}</div>
        <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{formatUtcDateTime(unlockAt * 1000)}</div>
      </div>
    </div>
    <button id={`btn-read-public-${id}`} type="button" onClick={onRead} className="btn-primary" style={{ width: '100%', padding: 10, fontSize: '.85rem' }}><Unlock size={14} />{t('my.viewContent')}</button>
  </article>;
}

export function PublicCapsuleReadModal({ capsuleId, title, verifiedTitle, message, error, isBusy, onClose }: {
  capsuleId: number | string; title: string; verifiedTitle: boolean; message: string | null; error: string | null; isBusy: boolean; onClose: () => void;
}) {
  const { t } = useLanguage();
  const dialogRef = useAccessibleModal<HTMLDivElement>(true, onClose);
  return <div className="modal-backdrop" onClick={onClose}>
    <div ref={dialogRef} data-accessible-dialog="true" role="dialog" aria-modal="true" aria-labelledby="public-read-modal-title" className="glass-panel capsule-content-modal" onClick={(event) => event.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><span className="badge badge-cyan">Capsule #{capsuleId}</span><span className={`badge ${message !== null ? 'badge-emerald' : 'badge-amber'}`}>{t(message !== null ? 'explore.decrypted' : 'explore.notOpened')}</span></div>
        <button type="button" data-dialog-initial-focus aria-label={t('explore.closeAria')} onClick={onClose} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '.75rem' }}>{t('common.close')}</button>
      </div>
      <h3 id="public-read-modal-title" style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 12 }}>{t(error ? 'explore.unableOpen' : 'explore.publicMessagePast')}</h3>
      <div style={{ overflowWrap: 'anywhere', fontSize: '.96rem', fontWeight: 700, marginBottom: 12 }}><CapsuleTitleText text={title} showFullTitleOnHover />{verifiedTitle && <div style={{ fontSize: '.7rem', color: 'var(--text-dim)', marginTop: 4 }}>{t('explore.verifiedPublicTitle')}</div>}</div>
      <div className="capsule-plaintext" role={error ? 'alert' : undefined}>{isBusy ? <LoadingText>{t('explore.waitingDrand')}</LoadingText> : error || message}</div>
    </div>
  </div>;
}
