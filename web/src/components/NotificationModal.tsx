import { formatUtcDateTime } from '../utils/dateTime';
import React, { useRef } from 'react';
import { X, Bell, Calendar, Download, ShieldCheck } from 'lucide-react';
import { SUPPORTED_CHAINS } from '../contracts/config';
import { useLanguage } from '../context/LanguageContext';
import { downloadIcsCalendarFile, generateGoogleCalendarUrl } from '../utils/calendarUtils';
import { useAccessibleModal } from '../utils/useAccessibleModal';



interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
  capsuleId: number | string;
  unlockAt: number;
  chainId?: number;
  networkName?: string;
  mode?: string;
  onOpenWallet?: () => void;
}

/** Calendar reminders are supported. Push needs a published channel and sender. */
export const NotificationModal: React.FC<NotificationModalProps> = ({
  isOpen, onClose, capsuleId, unlockAt, chainId, mode, networkName: suppliedNetworkName,
}) => {
  const { t, language } = useLanguage();
  const closeButton = useRef<HTMLButtonElement>(null);
  const dialogRef = useAccessibleModal<HTMLDivElement>(isOpen, onClose);

  if (!isOpen) return null;
  const networkName = suppliedNetworkName ?? (chainId === undefined ? undefined : SUPPORTED_CHAINS[chainId]?.name) ?? t('home.networkUnsupported');
  const unlockFormatted = formatUtcDateTime(unlockAt * 1000);
  const handleGoogleCalendar = () => {
    window.open(generateGoogleCalendarUrl({ capsuleId, unlockAt, networkName, mode, language }), '_blank', 'noopener,noreferrer');
  };
  const handleDownloadIcs = () => downloadIcsCalendarFile({ capsuleId, unlockAt, networkName, mode, language });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div ref={dialogRef} data-accessible-dialog="true" className="glass-panel notification-modal" role="dialog" aria-modal="true" aria-labelledby="notification-modal-title" onClick={(event) => event.stopPropagation()}>
        <button ref={closeButton} data-dialog-initial-focus className="notification-close-button" onClick={onClose} aria-label={t('notify.closeAria')}><X size={18} /></button>
        <header className="notification-header">
          <div className="notification-badges"><span className="badge badge-cyan">{t('notify.title')}</span><span className="badge badge-purple">#{capsuleId}</span></div>
          <h2 id="notification-modal-title">{t('notify.modalTitle')}</h2>
          <p>{t('notify.targetUnlock')} <strong>{unlockFormatted}</strong></p>
        </header>
        <div className="notification-panel-content">
          <div className="notification-info-card calendar-info"><strong><ShieldCheck size={16} />{t('notify.localCalendar')}</strong><span>{t('notify.localCalendarDesc')}</span></div>
          <div className="notification-info-card push-info"><strong><Bell size={16} />{t('notify.pushNotConfiguredTitle')}</strong><span>{t('notify.pushNotConfiguredDesc')}</span></div>
          <button id="btn-add-google-calendar" className="btn-primary" onClick={handleGoogleCalendar}><Calendar size={18} />{t('notify.googleBtn')}</button>
          <button id="btn-download-ics" className="btn-secondary" onClick={handleDownloadIcs}><Download size={18} />{t('notify.icsBtn')}</button>
        </div>
      </div>
    </div>
  );
};
