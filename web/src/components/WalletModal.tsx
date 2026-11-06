import React from 'react';
import { useWallet, SupportedWallet } from '../context/WalletContext';
import { X, ExternalLink, ShieldAlert, CheckCircle2, Sparkles, ArrowRight } from 'lucide-react';
import { useAccessibleModal } from '../utils/useAccessibleModal';
import { useLanguage } from '../context/LanguageContext';
import { useSolanaWallet } from '../context/solanaWalletState';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const WalletModal: React.FC<WalletModalProps> = ({ isOpen, onClose }) => {
  const evmWallet = useWallet();
  const solanaWallet = useSolanaWallet();
  const isConnecting = evmWallet.isConnecting || solanaWallet.isConnecting;
  const error = evmWallet.error || solanaWallet.error;
  const { t } = useLanguage();

  const handleClose = () => {
    if (isConnecting) {
      evmWallet.cancelConnection();
      solanaWallet.cancelConnection();
    }
    onClose();
  };

  const dialogRef = useAccessibleModal<HTMLDivElement>(isOpen, handleClose);

  if (!isOpen) return null;

  const handleSelectWallet = async (wallet: SupportedWallet | 'phantom-solana') => {
    if (isConnecting) return;
    evmWallet.clearError();
    solanaWallet.clearError();
    if (wallet === 'phantom-solana') {
      evmWallet.disconnect();
      if (await solanaWallet.connect()) onClose();
    } else {
      solanaWallet.disconnect();
      if (await evmWallet.connect(wallet)) onClose();
    }
  };

  const WALLETS = [
    {
      id: 'metamask' as SupportedWallet,
      group: 'EVM',
      name: 'MetaMask',
      description: t('wallet.connectMetaMask'),
      icon: (
        <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
          <path d="M28.5 4.5L18.5 12L20.5 7.5L28.5 4.5Z" fill="#E17726" stroke="#E17726" />
          <path d="M3.5 4.5L11.5 7.5L13.5 12L3.5 4.5Z" fill="#E27625" stroke="#E27625" />
          <path d="M24.5 21.5L22 25.5L28 27L29.5 21.5L24.5 21.5Z" fill="#E27625" />
          <path d="M2.5 21.5L4 27L10 25.5L7.5 21.5L2.5 21.5Z" fill="#E27625" />
          <path d="M9.5 14L8 18.5L13.5 19L13.5 13.5L9.5 14Z" fill="#E27625" />
          <path d="M22.5 14L18.5 13.5L18.5 19L24 18.5L22.5 14Z" fill="#E27625" />
          <path d="M10 25.5L13 24L10.5 21.5L10 25.5Z" fill="#D5BFB2" />
          <path d="M22 25.5L21.5 21.5L19 24L22 25.5Z" fill="#D5BFB2" />
        </svg>
      ),
      installed: evmWallet.detected.metamask,
      downloadUrl: 'https://metamask.io/download/',
    },
    {
      id: 'phantom-solana' as const,
      group: 'SOLANA',
      name: 'Phantom (Solana)',
      description: t('wallet.connectPhantom'),
      icon: (
        <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: 8, display: 'grid', placeItems: 'center', background: '#ab9ff2', color: '#1a1533', fontSize: 20, fontWeight: 800 }}>
          ◉
        </span>
      ),
      installed: solanaWallet.isInstalled,
      downloadUrl: 'https://phantom.com/download',
    },
  ];

  return (
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        ref={dialogRef}
        data-accessible-dialog="true"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-modal-title"
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: 480,
          background: 'rgba(11, 15, 36, 0.95)',
          border: '1px solid var(--border-glow)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(0, 240, 255, 0.2)',
          padding: '28px',
          borderRadius: 24,
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          data-dialog-initial-focus
          id="btn-close-wallet-modal"
          type="button"
          aria-label={t('wallet.closeAria')}
          onClick={handleClose}
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

        {/* Modal Header */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span className="badge badge-cyan">{t('wallet.badgeAuth')}</span>
            <span className="badge badge-purple">SOLANA · DEVNET</span>
          </div>
          <h2 id="wallet-modal-title" style={{ fontSize: '1.4rem', fontWeight: 700 }}>{t('wallet.title')}</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginTop: 4 }}>
            {t('wallet.connectPhantom')}
          </p>
        </div>

        {isConnecting && (
          <div style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            <p>{t('wallet.waiting')}</p>
            <button
              type="button"
              onClick={handleClose}
              style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-subtle)', background: 'rgba(255, 255, 255, 0.06)', color: 'var(--text-main)', cursor: 'pointer' }}
            >
              {t('wallet.stopWaiting')}
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div style={{
            background: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 16,
            fontSize: '0.85rem',
            color: '#fb7185',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <ShieldAlert size={18} />
            <div style={{ flex: 1 }}>{error}</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {WALLETS.filter(wallet => wallet.id === 'phantom-solana').map((w) => (
            <React.Fragment key={w.id}>
            <div style={{ marginTop: w.group === 'SOLANA' ? 8 : 0, color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.08em' }}>
              {w.group === 'EVM' ? 'EVM' : 'SOLANA · DEVNET'}
            </div>
            <div
              id={`wallet-option-${w.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-subtle)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(0, 240, 255, 0.08)';
                e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
              }}
            >
              <button
                type="button"
                disabled={!w.installed || isConnecting}
                onClick={() => void handleSelectWallet(w.id)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flex: 1, minWidth: 0, padding: 0, background: 'transparent', border: 0, color: 'var(--text-main)', textAlign: 'left', cursor: w.installed ? 'pointer' : 'default' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {w.icon}
                  </span>
                  <span>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {w.name}
                      {w.installed && (
                        <span style={{ color: '#10b981', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <CheckCircle2 size={12} /> {t('wallet.detected')}
                        </span>
                      )}
                    </span>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {w.description}
                    </span>
                  </span>
                </span>
                {w.installed && <ArrowRight size={18} color="var(--cyan-primary)" />}
              </button>

              {!w.installed && (
                <a
                  href={w.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--cyan-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    textDecoration: 'none',
                    padding: '4px 8px',
                    borderRadius: 6,
                    background: 'rgba(0, 240, 255, 0.08)',
                  }}
                >
                  {t('wallet.install')} <ExternalLink size={12} />
                </a>
              )}
            </div>
            </React.Fragment>
          ))}


        </div>

        {/* Security Notice */}
        <div style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid var(--border-subtle)',
          fontSize: '0.78rem',
          color: 'var(--text-dim)',
          textAlign: 'center',
        }}>
          🛡️ {t('wallet.nonCustodialNotice')}
        </div>
      </div>
    </div>
  );
};
