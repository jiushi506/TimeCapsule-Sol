import { formatUtcDateTime } from '../utils/dateTime';
import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

function remainingTime(unlockAt: number, now: number): string {
  const seconds = Math.max(0, unlockAt - now);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600).toString().padStart(2, '0');
  const minutes = Math.floor(seconds % 3600 / 60).toString().padStart(2, '0');
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${days ? `${days}d ` : ''}${hours}h ${minutes}m ${rest}s`;
}

export function PortfolioCapsuleCard({ id, capsuleId, mode, badges, identity, name, nameSource, unlockAt, now, technicalDetails, actions }: {
  id: string; capsuleId: string | number; mode: 'private' | 'public'; badges?: ReactNode; identity?: ReactNode;
  name: ReactNode; nameSource: ReactNode; unlockAt: number; now: number; technicalDetails: ReactNode; actions: ReactNode;
}) {
  const { t } = useLanguage();
  const passed = now >= unlockAt;
  return <article id={id} className={`glass-panel capsule-card${passed ? ' capsule-card-target-passed' : ''}`}>
    <div>
      <div className="capsule-card-heading">
        <div className="capsule-card-title-row"><span className="capsule-card-id font-mono">Capsule #{capsuleId}</span>{badges}</div>
        <div className="capsule-card-badges"><span className={`badge ${mode === 'private' ? 'badge-purple' : 'badge-cyan'}`}>{t(mode === 'private' ? 'my.privateMode' : 'my.publicMode')}</span></div>
      </div>
      {identity && <div className="font-mono" style={{ marginTop: 7, color: 'var(--text-dim)', fontSize: '.68rem', overflowWrap: 'anywhere' }}>{identity}</div>}
      {name}
      <p className="capsule-name-source">{nameSource}</p>
      <div className="capsule-release">
        <div className="capsule-release-date"><span>{t('my.unlocks')}</span><time dateTime={new Date(unlockAt * 1000).toISOString()}>{formatUtcDateTime(unlockAt * 1000)}</time></div>
        <div className={`capsule-release-state${passed ? ' capsule-release-state-passed' : ''}`}><Clock size={13} /><span>{passed ? t('my.releaseTimeReached') : `${t('my.in')} ${remainingTime(unlockAt, now)}`}</span></div>
      </div>
      <details className="capsule-technical-details"><summary>{t('my.technicalDetails')}</summary>{technicalDetails}</details>
    </div>
    <div className="capsule-card-actions">{actions}</div>
  </article>;
}
