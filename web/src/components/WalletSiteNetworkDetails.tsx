import { SUPPORTED_CHAINS } from '../contracts/config';
import { useLanguage } from '../context/languageContextState';

export function WalletSiteNetworkDetails({ targetChainId, walletChainId, switching, onSwitch }: {
  targetChainId: number;
  walletChainId: number | null;
  switching: boolean;
  onSwitch: (chainId: number) => void;
}) {
  const { t } = useLanguage();
  const name = (id: number) => SUPPORTED_CHAINS[id]?.name ?? `${t('home.networkUnsupported')} (${id})`;
  return (
    <section id="wallet-site-network-details" className="wallet-site-network-details" aria-label={t('create.networkErrorWalletLabel')}>
      <dl aria-live="polite">
        <dt>{t('create.networkErrorPageLabel')}</dt>
        <dd>{name(targetChainId)}</dd>
        <dt>{t('create.networkErrorWalletLabel')}</dt>
        <dd id="wallet-site-network-value">{walletChainId === null ? t('nav.walletNetworkUnknown') : `${name(walletChainId)} (${walletChainId})`}</dd>
      </dl>
      <p>{t('networkNotice.walletConnectionHint')}</p>
      <a href="https://support.metamask.io/configure/networks/how-to-change-networks" target="_blank" rel="noopener noreferrer">{t('networkNotice.walletConnectionHelp')}</a>
      <button id="btn-check-site-wallet-network" type="button" className="btn-secondary" disabled={switching} onClick={() => onSwitch(targetChainId)}>
        {t(switching ? 'networkNotice.switchingAction' : 'nav.networkConfirmAction').replaceAll('{target}', name(targetChainId))}
      </button>
    </section>
  );
}
