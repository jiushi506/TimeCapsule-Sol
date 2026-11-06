import { formatUtcDateTime, draftUnlockInput } from '../utils/dateTime';
import { Edit3, FileText, Trash2 } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useAuthLocalScope } from '../context/useAuthLocalScope';
import { deleteLocalDraft, setActiveLocalDraftId, type LocalDraft } from '../services/draftService';

export function PortfolioDrafts({ drafts, onNavigate, onDelete }: {
  drafts: LocalDraft[]; onNavigate: (tab: string) => void; onDelete?: () => void;
}) {
  const { t } = useLanguage();
  const localScope = useAuthLocalScope();
  return <>{
        drafts.length === 0 ? (
          <div className="glass-panel" style={{ padding: 60, textAlign: 'center' }}>
            <div style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              background: 'rgba(168, 85, 247, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 16px auto',
            }}>
              <FileText size={28} color="#c084fc" />
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>{t('my.emptyDraftsTitle')}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: 440, margin: '0 auto 24px auto' }}>
              {t('my.emptyDraftsSub')}
            </p>
            <button
              id="btn-drafts-create"
              className="btn-primary"
              onClick={() => onNavigate('create')}
              style={{ padding: '12px 28px' }}
            >
              {t('my.btnSealNew')}
            </button>
          </div>
        ) : (
          <div className="capsule-grid capsule-draft-grid">
            {drafts.map((d) => (
              <div
                key={d.id}
                className="glass-panel"
                style={{
                  padding: 24,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  border: '1px dashed rgba(168, 85, 247, 0.4)',
                  background: 'rgba(168, 85, 247, 0.03)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <span className="badge badge-purple" style={{ fontSize: '0.72rem' }}>
                      Local Draft
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                      Saved: {formatUtcDateTime(d.updatedAt)}
                    </span>
                  </div>

                  <div style={{
                    fontSize: '0.9rem',
                    color: '#f8fafc',
                    lineHeight: 1.5,
                    marginBottom: 16,
                    maxHeight: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'pre-wrap',
                  }}>
                    "{d.message.substring(0, 120)}{d.message.length > 120 ? '...' : ''}"
                  </div>

                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>{t('my.mode')} <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{d.mode.toUpperCase()}</span></div>
                    <div>{t('my.targetDate')} <span style={{ color: 'var(--cyan-primary)' }}>{formatUtcDateTime(`${draftUnlockInput(d.unlockDate, d.timeZone)}Z`)}</span></div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
                  <button
                    id={`btn-continue-draft-${d.id}`}
                    onClick={() => {
                      setActiveLocalDraftId(d.id, localScope);
                      onNavigate('create');
                    }}
                    className="btn-primary"
                    style={{ flex: 1, padding: '9px', fontSize: '0.85rem', gap: 6 }}
                  >
                    <Edit3 size={14} />
                    {t('my.continueDraft')}
                  </button>
                  <button
                    id={`btn-delete-draft-${d.id}`}
                    onClick={() => {
                      deleteLocalDraft(d.id, localScope);
                      onDelete?.();
                    }}
                    className="btn-secondary"
                    style={{ padding: '9px 12px', color: '#fb7185' }}
                    title={t('my.deleteDraft')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
  }</>;
}
