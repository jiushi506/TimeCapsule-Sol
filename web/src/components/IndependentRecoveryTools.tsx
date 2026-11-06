import { Download } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const downloads = [
  { key: 'recovery.desktopWindows', file: 'TimeCapsule-Recovery-1.1.0-win-x64.exe', version: '1.1.0' },
  { key: 'recovery.desktopMacApple', file: 'TimeCapsule-Recovery-1.1.0-mac-arm64.zip', version: '1.1.0' },
  { key: 'recovery.desktopMacIntel', file: 'TimeCapsule-Recovery-1.1.0-mac-x64.zip', version: '1.1.0' },
];

export function IndependentRecoveryTools() {
  const { t } = useLanguage();
  return <details className="glass-panel independent-recovery-tools">
    <summary><Download size={20} />{t('common.independentTools')}</summary>
    <p>{t('recovery.desktopDescription')}</p>
    <div className="recovery-panel-actions">{downloads.map(({ key, file, version }) => <a key={file} className="btn-secondary" href={`https://downloads.web3luma.com/${file}?v=${version}`}><Download size={15} />{t(key)}</a>)}</div>
    <small>{t('recovery.desktopNote')}</small>
  </details>;
}
