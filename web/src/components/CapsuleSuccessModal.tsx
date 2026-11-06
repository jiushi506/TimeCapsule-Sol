import { formatUtcDateTime } from '../utils/dateTime';
import type { ReactNode } from 'react';
import { Bell, CheckCircle, Download, ExternalLink, Share2, Users } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAccessibleModal } from '../utils/useAccessibleModal';
import { CapsuleTitleText } from './CapsuleTitleText';

interface CapsuleSuccessModalProps {
  capsuleId: number | string;
  unlockAt: number;
  description: string;
  onClose: () => void;
  onDownload: () => void;
  onViewMy: () => void;
  onRemind: () => void;
  onShare?: () => void;
  onCoCreate?: () => void;
  isDemo?: boolean;
  transaction?: { hash: string; url: string };
  publicTitle?: string;
  localLabelSaved?: boolean;
  localLabelSaveError?: string;
  confirmationTimeMs?: number | null;
  children?: ReactNode;
}

/** One completion dialog for wallet-based publishing on every chain. */
export function CapsuleSuccessModal({
  capsuleId, unlockAt, description, onClose, onDownload, onViewMy, onRemind, onShare, onCoCreate,
  isDemo = false, transaction, publicTitle, localLabelSaved, localLabelSaveError,
  confirmationTimeMs, children,
}: CapsuleSuccessModalProps) {
  const { t } = useLanguage();
  const dialogRef = useAccessibleModal<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        data-accessible-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="seal-success-modal-title"
        aria-describedby="seal-success-modal-description"
        className="glass-panel capsule-success-modal"
      >
        <div className="capsule-success-icon"><CheckCircle size={36} color="#10b981" /></div>
        <h2 id="seal-success-modal-title" data-dialog-initial-focus tabIndex={-1} style={{ fontSize: '1.6rem', fontWeight: 800, marginBottom: 8 }}>
          {t(isDemo ? 'create.successDemo' : 'create.successChain')}
        </h2>
        <p id="seal-success-modal-description" style={{ color: 'var(--text-muted)', fontSize: '.88rem', marginBottom: 24 }}>{description}</p>
        {publicTitle && (
          <div style={{ textAlign: 'left', overflowWrap: 'anywhere', marginBottom: 16, padding: 12, borderRadius: 10, background: 'rgba(0,240,255,.08)', border: '1px solid rgba(0,240,255,.25)' }}>
            <span style={{ color: 'var(--text-dim)', fontSize: '.78rem' }}>{t('create.verifiedPublicTitle')}</span>
            <div style={{ fontWeight: 700, marginTop: 4 }}><CapsuleTitleText text={publicTitle} /></div>
          </div>
        )}
        {localLabelSaved && <div style={{ color: 'var(--text-muted)', fontSize: '.78rem', marginBottom: 12 }}>{t(isDemo ? 'create.localLabelSavedBrowser' : 'shared.titleSyncPending')}</div>}
        {localLabelSaveError && <div role="alert" style={{ color: '#fb7185', fontSize: '.8rem', marginBottom: 12 }}>{t('create.localLabelSaveFailed')} {localLabelSaveError}</div>}

        <div className="capsule-success-summary">
          <div className="capsule-success-row">
            <span style={{ color: 'var(--text-dim)' }}>{t('create.capsuleId')}</span>
            <span className="font-mono" style={{ fontWeight: 700, color: 'var(--cyan-primary)' }}>#{capsuleId}</span>
          </div>
          <div className="capsule-success-row">
            <span style={{ color: 'var(--text-dim)' }}>{t('my.unlockDate')}</span>
            <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{formatUtcDateTime(unlockAt * 1000)}</span>
          </div>
          {transaction && (
            <div className="capsule-success-row">
              <span style={{ color: 'var(--text-dim)' }}>{t('create.verifiedTx')}</span>
              <a href={transaction.url} target="_blank" rel="noreferrer" style={{ color: '#38bdf8', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {transaction.hash.slice(0, 10)}… <ExternalLink size={12} />
              </a>
            </div>
          )}
          {confirmationTimeMs != null && (
            <div className="capsule-success-row">
              <span style={{ color: 'var(--text-dim)' }}>{t('create.confirmationTime')}</span>
              <span style={{ color: '#34d399', fontWeight: 600 }}>{(confirmationTimeMs / 1000).toFixed(1)} s</span>
            </div>
          )}
          {children}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {onShare && <button id="btn-open-poster-share" type="button" className="btn-primary" onClick={onShare} style={{ width: '100%', padding: 14, fontSize: '.98rem', gap: 8 }}><Share2 size={18} />{t('create.btnPoster')}</button>}
          <button id="btn-open-notification-modal" type="button" className="capsule-success-reminder" onClick={onRemind}><Bell size={16} />{t('create.btnRemind')}</button>
          {onCoCreate ? <button id="btn-success-co-create" type="button" className="btn-purple" onClick={onCoCreate} style={{ width: '100%', padding: 12, fontSize: '.9rem' }}><Users size={16} />{t('shared.invite')}</button>
            : <button id="btn-download-recovery-card" type="button" className="btn-purple" onClick={onDownload} style={{ width: '100%', padding: 12, fontSize: '.9rem' }}><Download size={16} />{t(isDemo ? 'create.downloadDemoData' : 'create.downloadRecoveryCard')}</button>}
          <button id="btn-view-my-capsules" type="button" className="btn-secondary" onClick={onViewMy} style={{ width: '100%', padding: 12 }}>{t('create.btnViewMy')}</button>
        </div>
      </div>
    </div>
  );
}
