import { formatUtcDateTime } from '../utils/dateTime';
import { Bell, Share2, ShieldCheck, Unlock, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAccessibleModal } from '../utils/useAccessibleModal';
import { CapsuleTitleText } from './CapsuleTitleText';
import { LoadingText } from './LoadingText';

interface DisplayCapsule { id: number | string; mode: 'public' | 'private'; unlockAt: number; payloadHash: string; publicTitle?: string; versionLabel?: string; }
export function CapsuleInspectionModal({ capsule, password, message, imageUrl, error, isBusy, onPasswordChange, onDecrypt, onClose, onRemind, onShare }: {
  capsule: DisplayCapsule; password: string; message: string | null; error: string | null; isBusy: boolean;
  imageUrl?: string | null;
  onPasswordChange: (value: string) => void; onDecrypt: () => void; onClose: () => void; onRemind: () => void; onShare: () => void;
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
            aria-labelledby="decrypt-modal-title"
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: 580,
              maxHeight: 'calc(100dvh - 40px)',
              overflowY: 'auto',
              background: 'rgba(11, 15, 36, 0.98)',
              border: '1px solid var(--border-glow)',
              boxShadow: '0 0 50px rgba(0, 240, 255, 0.25)',
              padding: 32,
              borderRadius: 24,
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              data-dialog-initial-focus
              aria-label={t('my.closeDetailsAria')}
              onClick={onClose}
              style={{
                position: 'absolute',
                top: 20,
                right: 20,
                background: 'rgba(255, 255, 255, 0.05)',
                border: 'none',
                borderRadius: '50%',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                cursor: 'pointer',
              }}
            >
              <X size={18} />
            </button>

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span className="badge badge-cyan">Capsule #{capsule.id}</span>
              <span className="badge badge-purple">{capsule.mode.toUpperCase()}</span>
              {message !== null && <span className="badge badge-cyan">{t('my.releaseChecked')}</span>}
            </div>

            <h2 id="decrypt-modal-title" style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: 8 }}>
              {t('my.decryptModalTitle')}
            </h2>
            <div style={{ marginBottom: 14, overflowWrap: 'anywhere', fontSize: '0.94rem', fontWeight: 700 }}>
              <CapsuleTitleText text={capsule.publicTitle ?? `${capsule.versionLabel ?? 'Registry'} ${t('my.capsuleNoun')} #${capsule.id}`} />
              {capsule.publicTitle && <div style={{ fontSize: '0.7rem', fontWeight: 500, color: 'var(--text-dim)', marginTop: 3 }}>{t('my.verifiedPublicTitle')}</div>}
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: 'var(--radius-md)',
                padding: 16,
                marginBottom: 18,
                fontSize: '0.84rem',
                color: 'var(--text-muted)',
                lineHeight: 1.5,
              }}>
                {t('my.scheduledRelease')}: <strong>{formatUtcDateTime(capsule.unlockAt * 1000)}</strong>. {t('my.countdownInfo')}
                <div className="font-mono" style={{ marginTop: 8, fontSize: '0.76rem', color: 'var(--cyan-primary)', wordBreak: 'break-all' }}>
                  {t('my.payloadHashLabel')}: {capsule.payloadHash}
                </div>
              </div>

              {message !== null ? (
                <div>
                  <div style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    padding: 14,
                    marginBottom: 16,
                    fontSize: '0.85rem',
                    color: '#34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}>
                    <ShieldCheck size={18} />
                    <span>{t('my.verifiedReleaseProof')}</span>
                  </div>
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.5)',
                    border: '1px solid var(--border-glow)',
                    borderRadius: 'var(--radius-md)',
                    padding: 20,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontSize: '1rem',
                    lineHeight: 1.6,
                    color: '#f8fafc',
                  }}>{message}</div>
                  {imageUrl && <img src={imageUrl} alt={t('collab.create.photoPreview')} style={{ display: 'block', width: '100%', maxHeight: 520, objectFit: 'contain', marginTop: 14, borderRadius: 'var(--radius-md)', background: 'rgba(0,0,0,.3)' }} />}
                </div>
              ) : (
                <div>
                  {capsule.mode === 'private' && (
                    <div style={{ marginBottom: 20 }}>
                      <label htmlFor="input-decrypt-password" style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: 8, color: '#c084fc' }}>
                        {t('my.privatePassphraseLabel')}
                      </label>
                      <input
                        id="input-decrypt-password"
                        type="password"
                        placeholder={t('my.passphrasePlaceholder')}
                        value={password}
                        onChange={(e) => onPasswordChange(e.target.value)}
                      />
                    </div>
                  )}
                  {error && (
                    <div role="alert" style={{
                      background: 'rgba(244, 63, 94, 0.12)',
                      border: '1px solid rgba(244, 63, 94, 0.3)',
                      borderRadius: 'var(--radius-md)',
                      padding: '12px 14px',
                      marginBottom: 16,
                      fontSize: '0.85rem',
                      color: '#fb7185',
                    }}>{error}</div>
                  )}
                  <button
                    id="btn-submit-decrypt"
                    className="btn-primary"
                    onClick={onDecrypt}
                    disabled={isBusy}
                    style={{ width: '100%', padding: '14px', fontSize: '1rem', gap: 8 }}
                  >
                    <Unlock size={18} />
                    {isBusy ? <LoadingText>{t('my.waitingDrand')}</LoadingText> : capsule.mode === 'public' ? t('my.viewContent') : t('my.checkSignalDecrypt')}
                  </button>
                </div>
              )}
            </div>

            {/* Share Poster & Remind in Modal */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                id="btn-modal-remind"
                type="button"
                className="btn-secondary"
                onClick={onRemind}
                style={{ padding: '8px 16px', fontSize: '0.85rem', gap: 6, color: 'var(--cyan-primary)' }}
              >
                <Bell size={14} />
                {t('my.setReminder')}
              </button>

              <button
                id="btn-modal-share-poster"
                type="button"
                className="btn-secondary"
                onClick={onShare}
                style={{ padding: '8px 16px', fontSize: '0.85rem', gap: 6 }}
              >
                <Share2 size={14} />
                {t('my.sharePoster')}
              </button>
            </div>
          </div>
        </div>
  );
}
