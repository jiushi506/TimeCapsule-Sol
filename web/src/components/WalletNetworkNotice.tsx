import { AlertTriangle, RefreshCw } from 'lucide-react';
import { SUPPORTED_CHAINS } from '../contracts/config';
import { useLanguage } from '../context/languageContextState';
import { shouldShowWalletNetworkNotice } from '../context/walletProviderUtils';

export interface WalletNetworkNoticeProps {
  connected: boolean;
  targetChainId: number;
  walletChainId: number | null;
  switching: boolean;
  readError: boolean;
  errorKey: string | null;
  onSwitch: (chainId: number) => void;
  onConnect: () => void;
}

/** Warn before submission; disappear as soon as the wallet network is verified. */
export function WalletNetworkNotice({ connected, targetChainId, walletChainId, switching, readError, errorKey, onSwitch, onConnect }: WalletNetworkNoticeProps) {
  const { t } = useLanguage();
  if (!shouldShowWalletNetworkNotice({ connected, targetChainId, walletChainId, switching, readError })) return null;
  const targetName = SUPPORTED_CHAINS[targetChainId]?.name ?? `${t('home.networkUnsupported')} (${targetChainId})`;
  const walletName = walletChainId === null
    ? t(connected ? 'nav.walletNetworkUnknown' : 'networkNotice.disconnected')
    : SUPPORTED_CHAINS[walletChainId]?.name ?? `${t('home.networkUnsupported')} (${walletChainId})`;
  const mismatch = connected && walletChainId !== null && walletChainId !== targetChainId;
  const fill = (key: string) => t(key).replaceAll('{target}', targetName).replaceAll('{current}', walletName);
  const statusKey = !connected ? 'networkNotice.connectDescription'
    : switching ? 'networkNotice.switchingDescription'
    : mismatch ? 'networkNotice.mismatchDescription'
    : readError ? 'networkNotice.unknownDescription'
    : 'networkNotice.checking';
  const Icon = switching ? RefreshCw : AlertTriangle;

  return (
    <section id="wallet-network-notice" className="wallet-network-notice" aria-label={t('networkNotice.label')}>
      <div className="wallet-network-notice-copy" role="alert" aria-live="polite" aria-atomic="true">
        <Icon size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong>{t(mismatch ? 'networkNotice.mismatchTitle' : 'networkNotice.title')}</strong>
          <dl className="wallet-network-notice-networks">
            <div><dt>{t('create.networkErrorPageLabel')}</dt><dd>{targetName}</dd></div>
            <div><dt>{t('create.networkErrorWalletLabel')}</dt><dd>{walletName}</dd></div>
          </dl>
          <p>{fill(statusKey)}</p>
          {errorKey && <p className="wallet-network-notice-error">{t(errorKey)}</p>}
        </div>
      </div>
      <button id="btn-sync-wallet-network" type="button" className="btn-secondary" disabled={switching} aria-busy={switching} onClick={() => connected ? onSwitch(targetChainId) : onConnect()}>
        {fill(!connected ? 'networkNotice.connectAction' : switching ? 'networkNotice.switchingAction' : mismatch || readError || errorKey ? 'nav.networkSwitchAction' : 'nav.networkConfirmAction')}
      </button>
    </section>
  );
}
