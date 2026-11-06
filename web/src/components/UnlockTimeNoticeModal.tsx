import { Clock3, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAccessibleModal } from '../utils/useAccessibleModal';

export function UnlockTimeNoticeModal({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const dialogRef = useAccessibleModal<HTMLDivElement>(true, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        data-accessible-dialog="true"
        data-dialog-initial-focus
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unlock-time-notice-title"
        className="glass-panel"
        style={{
          width: 'min(480px, calc(100vw - 32px))',
          background: 'rgba(11, 15, 36, 0.98)',
          border: '1px solid rgba(244, 63, 94, 0.4)',
          boxShadow: '0 0 50px rgba(0, 240, 255, 0.18)',
          padding: 28,
          borderRadius: 24,
          position: 'relative',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={t('common.close')}
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16, width: 32, height: 32,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.05)',
            color: 'var(--text-muted)', cursor: 'pointer',
          }}
        >
          <X size={18} />
        </button>
        <div style={{ color: '#fb7185', marginBottom: 14 }}><Clock3 size={24} /></div>
        <h2 id="unlock-time-notice-title" style={{ fontSize: '1.05rem', lineHeight: 1.5, fontWeight: 700, margin: '0 28px 22px 0' }}>
          {t('my.unlockTimeNotReached')}
        </h2>
        <button type="button" className="btn-secondary" onClick={onClose} style={{ width: '100%' }}>
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}
