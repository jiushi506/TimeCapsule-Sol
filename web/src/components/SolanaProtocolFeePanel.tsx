import { formatUtcDateTime } from '../utils/dateTime';
import { useLanguage } from '../context/LanguageContext';
import { formatLamports } from '../services/solanaCapsuleService';
import { formatUsdcMicros, type SolanaProtocolFeeReview } from '../services/solanaProtocolFee';

export function SolanaProtocolFeePanel({ fee, balance, loading, error, onRefresh }: {
  fee: SolanaProtocolFeeReview | null; balance: string; loading: boolean;
  error: string | null; onRefresh: () => void;
}) {
  const { t } = useLanguage();
  return (
    <section aria-label={t('solFee.paymentMethod')} style={{ padding: 20, marginBottom: 24,
      border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,.02)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <strong>{t('solFee.paymentMethod')}</strong>
        <span style={{ color: 'var(--cyan-primary)', fontSize: '.85rem' }}>{t('solFee.walletBalance')}: {balance} SOL</span>
      </div>
      <div style={{ padding: '14px 16px', border: '1px solid var(--cyan-primary)', borderRadius: 12, background: 'rgba(0,240,255,.07)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--cyan-primary)', fontWeight: 700 }}>
          <span>SOL</span><span style={{ fontSize: '.8rem' }}>{t('solFee.selected')}</span>
        </div>
        <p role="status" style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: '.85rem' }}>
          {fee ? <>{fee.mode === 'usdc-equivalent-sol' ? `${formatUsdcMicros(fee.targetUsdcMicros)} USDC ≈ ` : ''}{formatLamports(fee.protocolFeeLamports, 9)} SOL</>
            : loading ? t('solFee.loading') : t('solFee.unavailable')}
        </p>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.6, margin: '10px 0 0' }}>{t('solFee.separateCosts')}</p>
      {fee?.solPublishTime && <p style={{ color: 'var(--text-dim)', fontSize: '.75rem', margin: '6px 0 0' }}>
        {t('solFee.updatedAt')}: {formatUtcDateTime(Math.min(fee.solPublishTime, fee.usdcPublishTime!) * 1_000)}
      </p>}
      {error && <p role="status" style={{ color: '#fbbf24', fontSize: '.8rem', lineHeight: 1.5, marginTop: 10 }}>{error}</p>}
      <button type="button" className="btn-secondary" disabled={loading} onClick={onRefresh} style={{ marginTop: 12, fontSize: '.8rem', padding: '7px 12px' }}>{t('solFee.refresh')}</button>
    </section>
  );
}
