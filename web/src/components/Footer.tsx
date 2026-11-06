import { ShieldCheck, DatabaseZap, Lock, Terminal, ExternalLink } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { SOLANA_PROGRAM_ID } from '../contracts/solanaConfig';
export function Footer() {
const { t } = useLanguage();
const isSolanaConnected = true;
const chainConfig: any = null;
const chainId: number | null = null;
const hasVerifiedRegistryDeployment = (_id: number) => false;
const publicAsset = (name: string) => `${import.meta.env.BASE_URL}${name}`;
return (      <footer style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'rgba(5, 7, 19, 0.95)',
        padding: '40px 24px 30px 24px',
        marginTop: 60,
      }}>
        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 32,
          marginBottom: 36,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <img
                src={publicAsset('timecapsule-icon-rounded.png')}
                alt=""
                width={22}
                height={22}
                style={{ width: 22, height: 22, borderRadius: 6, objectFit: 'cover', display: 'block' }}
              />
              <span className="font-display" style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                TIMECAPSULE <span className="gradient-text-cyan">PROTOCOL</span>
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', lineHeight: 1.6 }}>
              {t('footer.tagline')}
            </p>
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 12, color: 'var(--text-main)' }}>
              {t('footer.architecture')}
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={14} color="#10b981" /> {t('footer.dataControl')}
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Lock size={14} color="var(--cyan-primary)" /> {t('footer.localEncryption')}
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <DatabaseZap size={14} color="#c084fc" /> {t('footer.onChain')}
              </li>
              <li style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Terminal size={14} color="#f59e0b" /> {t('footer.recovery')}
              </li>
            </ul>
          </div>

          <div>
            <div style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 12, color: 'var(--text-main)' }}>
              {isSolanaConnected ? 'Solana Program' : t('footer.registry')}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 8 }}>
              {t('footer.network')}: {isSolanaConnected ? 'Solana Devnet' : chainConfig ? `${chainConfig.name} (Chain ID: ${chainConfig.id})` : `${t('home.networkUnsupported')} (${chainId})`}
            </div>
            {isSolanaConnected ? (
              <a
                href={`https://explorer.solana.com/address/${SOLANA_PROGRAM_ID}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="font-mono"
                style={{ fontSize: '0.78rem', color: 'var(--cyan-primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, wordBreak: 'break-all' }}
              >
                {SOLANA_PROGRAM_ID} <ExternalLink size={12} />
              </a>
            ) : chainConfig?.contractAddress && hasVerifiedRegistryDeployment(chainConfig.id) ? (
              <a
                href={`${chainConfig.blockExplorer}/address/${chainConfig.contractAddress}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono"
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--cyan-primary)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  wordBreak: 'break-all',
                }}
              >
                {chainConfig.contractAddress} <ExternalLink size={12} />
              </a>
            ) : (
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                {t('footer.pending')}
              </span>
            )}
          </div>
        </div>

        <div style={{
          maxWidth: 1200,
          margin: '0 auto',
          paddingTop: 20,
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: '0.78rem',
          color: 'var(--text-dim)',
        }}>
          <div>
            {t('footer.copyright')}
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <span>{isSolanaConnected ? 'Phantom · Solana wallet' : 'EVM wallets'}</span>
          </div>
        </div>
      </footer>);
}
