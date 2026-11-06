import { formatUtcDateTime, parseUtcInput } from '../utils/dateTime';
import { AlertTriangle, Lock } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAccessibleModal } from '../utils/useAccessibleModal';

export function SealConfirmationModal({ mode, publicTitle, unlockDate, duration, networkName, feeDescription, onClose, onProceed }: {
  mode: 'public' | 'private'; publicTitle: string; unlockDate: string; duration: string; networkName: string; feeDescription: string; onClose: () => void; onProceed: () => void;
}) {
  const { t } = useLanguage();
  const dialogRef = useAccessibleModal<HTMLDivElement>(true, onClose);
  return (
        <div className="modal-backdrop" onClick={onClose}>
          <div
            ref={dialogRef}
            data-accessible-dialog="true"
            role="dialog"
            aria-modal="true"
            aria-labelledby="seal-confirm-modal-title"
            className="glass-panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 540,
              maxHeight: 'calc(100dvh - 40px)',
              overflowY: 'auto',
              background: 'rgba(11, 15, 36, 0.98)',
              border: '1px solid rgba(245, 158, 11, 0.5)',
              boxShadow: '0 0 50px rgba(245, 158, 11, 0.25)',
              padding: 32,
              borderRadius: 24,
              textAlign: 'left',
              position: 'relative',
            }}
          >
            {/* Header Icon + Title */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(245, 158, 11, 0.15)',
                border: '1px solid #f59e0b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <AlertTriangle size={24} color="#f59e0b" />
              </div>
              <div>
                <h3 id="seal-confirm-modal-title" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', marginBottom: 2 }}>
                  {t('create.confirmModalTitle')}
                </h3>
                <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>
                  {t('create.nonReversibleBadge')}
                </span>
              </div>
            </div>

            {/* Warning Box */}
            <div style={{
              background: 'rgba(245, 158, 11, 0.08)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: 'var(--radius-md)',
              padding: '14px 16px',
              fontSize: '0.85rem',
              lineHeight: 1.6,
              color: '#fef3c7',
              marginBottom: 20,
            }}>
              <strong>⚠️ {t('create.confirmModalWarning')}</strong>
            </div>

            {/* Parameters Breakdown */}
            <div style={{
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              fontSize: '0.85rem',
              marginBottom: 24,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dim)' }}>{t('create.confirmUnlockMoment')}:</span>
                <span className="font-mono" style={{ fontWeight: 700, color: 'var(--cyan-primary)' }}>
                  {formatUtcDateTime(parseUtcInput(unlockDate))} ({duration})
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dim)' }}>{t('create.confirmMode')}:</span>
                <span className={mode === 'private' ? 'badge badge-purple' : 'badge badge-cyan'}>
                  {mode === 'private' ? t('create.privateModeTechnical') : t('create.publicModeTechnical')}
                </span>
              </div>

              {mode === 'private' && (
                <div style={{
                  fontSize: '0.78rem',
                  color: '#fbbf24',
                  background: 'rgba(245, 158, 11, 0.1)',
                  padding: '8px 10px',
                  borderRadius: 6,
                }}>
                  🔐 {t('create.confirmPassWarning')}
                </div>
              )}

              {mode === 'public' && (
                <div className="public-title-review" style={{ background: 'rgba(0, 240, 255, 0.08)', border: '1px solid rgba(0, 240, 255, 0.25)', borderRadius: 8, padding: '10px 12px', overflowWrap: 'anywhere' }}>
                  <span style={{ color: 'var(--text-dim)' }}>{t('create.finalOnChainTitle')} </span>
                  <strong>{publicTitle || t('create.emptyValue')}</strong>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dim)' }}>{t('create.network')}:</span>
                <span style={{ fontWeight: 600, color: '#f8fafc' }}>
                  {networkName}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-dim)' }}>{t('create.fee')}:</span>
                <span className="font-mono" style={{ fontWeight: 700, color: '#fbbf24' }}>
                  {feeDescription}
                </span>
              </div>
            </div>

            {/* Modal Actions */}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                data-dialog-initial-focus
                type="button"
                id="btn-confirm-modal-back"
                onClick={onClose}
                className="btn-secondary"
                style={{ flex: 1, padding: '12px', fontSize: '0.92rem' }}
              >
                {t('create.confirmBtnBack')}
              </button>

              <button
                type="button"
                id="btn-confirm-modal-proceed"
                onClick={onProceed}
                className="btn-primary"
                style={{
                  flex: 1.4,
                  padding: '12px',
                  fontSize: '0.92rem',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  boxShadow: '0 0 20px rgba(245, 158, 11, 0.4)',
                  borderColor: '#f59e0b',
                  gap: 6,
                }}
              >
                <Lock size={16} />
                {t('create.confirmBtnProceed')}
              </button>
            </div>
          </div>
        </div>
  );
}
