import React from 'react';
import {
  ArrowRight,
  Check,
  Clock3,
  Copy,
  DatabaseZap,
  Globe2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { DEFAULT_CHAIN_ID, hasVerifiedRegistryDeployment, SUPPORTED_CHAINS } from '../contracts/config';
import { useWallet } from '../context/WalletContext';
import { useSolanaWallet } from '../context/solanaWalletState';
import { SOLANA_PROGRAM_ID } from '../contracts/solanaConfig';
import { buildJudgeRecoveryUrl, JUDGE_SAMPLE_RECOVERY } from '../routing';
import { PUBLIC_APP_URL } from '../../publicAppUrl';

interface HomeViewProps {
  onNavigate: (tab: string, params?: Record<string, string | number | undefined>) => void;
  onOpenWallet: () => void;
}

const publicImage = (name: string) => `${import.meta.env.BASE_URL}images/${name}`;

const useCases = [
  { image: publicImage('usecase-future-self.webp'), title: 'home.use1Title', body: 'home.use1Desc', alt: 'home.use1Alt', number: '01' },
  { image: publicImage('usecase-private-thought.webp'), title: 'home.use2Title', body: 'home.use2Desc', alt: 'home.use2Alt', number: '02' },
  { image: publicImage('usecase-public-mark.webp'), title: 'home.use3Title', body: 'home.use3Desc', alt: 'home.use3Alt', number: '03' },
];

const lifecycleItems = [
  { icon: publicImage('icon-compose.webp'), name: 'home.step1Name', body: 'home.step1Desc' },
  { icon: publicImage('icon-encrypt.webp'), name: 'home.step2Name', body: 'home.step2Desc' },
  { icon: publicImage('icon-seal-onchain.webp'), name: 'home.step3Name', body: 'home.step3Desc' },
  { icon: publicImage('icon-future-revelation.webp'), name: 'home.step4Name', body: 'home.step4Desc' },
];

const heroNotes = [
  { image: publicImage('home-flow-write.webp'), title: 'home.heroNote1Title', body: 'home.heroNote1Desc' },
  { image: publicImage('home-flow-seal.webp'), title: 'home.heroNote2Title', body: 'home.heroNote2Desc' },
  { image: publicImage('home-flow-recover.webp'), title: 'home.heroNote3Title', body: 'home.heroNote3Desc' },
];

const protocolPoints = [
  { icon: ShieldCheck, title: 'home.tech1Title', body: 'home.tech1Desc', tone: 'cyan' },
  { icon: DatabaseZap, title: 'home.tech2Title', body: 'home.tech2Desc', tone: 'violet' },
  { icon: Clock3, title: 'home.tech3Title', body: 'home.tech3Desc', tone: 'amber' },
  { icon: RefreshCw, title: 'home.tech4Title', body: 'home.tech4Desc', tone: 'green' },
];

export const HomeView: React.FC<HomeViewProps> = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { chainId, isConnected: evmConnected } = useWallet();
  const solanaWallet = useSolanaWallet();
  const isSolana = true;
  const activeChain = SUPPORTED_CHAINS[chainId ?? DEFAULT_CHAIN_ID];
  const hasDeployment = isSolana || hasVerifiedRegistryDeployment(activeChain?.id ?? -1);
  const [judgeLinkCopied, setJudgeLinkCopied] = React.useState(false);
  const [judgeLinkCopyFailed, setJudgeLinkCopyFailed] = React.useState(false);

  const copyJudgeLink = async () => {
    try {
      await navigator.clipboard.writeText(buildJudgeRecoveryUrl(PUBLIC_APP_URL));
      setJudgeLinkCopied(true);
      setJudgeLinkCopyFailed(false);
    } catch {
      setJudgeLinkCopied(false);
      setJudgeLinkCopyFailed(true);
    }
  };

  return (
    <div className="home-page">
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="home-hero-copy">
          <div className="home-eyebrow"><Sparkles size={15} />{t('home.judgeBadge')}</div>
          {!hasDeployment && (
            <div className="home-network-warning" role="status">
              <strong>{activeChain?.name ?? t('home.networkUnsupported')}</strong>
              <span>{t('home.networkUnavailable')}</span>
            </div>
          )}
          <h1 id="hero-title" className="font-display home-hero-title">
            {t('home.judgeTitle1')}<br />
            <span className="home-hero-accent">{t('home.judgeTitle2')}</span>
          </h1>
          <p className="home-hero-subtitle">{t('home.judgeSubtitle')}</p>
          <div className="home-hero-trust">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <strong>{t('home.judgeTrustTitle')}</strong>
              <p>{t('home.judgeTrustDesc')}</p>
            </div>
          </div>
          <div className="home-hero-actions">
            <button
              id="hero-btn-live-recovery"
              className="btn-primary"
              onClick={() => onNavigate('recover', JUDGE_SAMPLE_RECOVERY)}
            >
              <ArrowRight size={19} />{t('home.judgeOpenSample')}
            </button>
            <button id="hero-btn-explore" className="btn-secondary" onClick={() => onNavigate('explore')}>
              <Globe2 size={18} />{t('home.judgeExplore')}
            </button>
            <button id="hero-btn-copy-judge-link" type="button" className="home-copy-judge-link" onClick={() => void copyJudgeLink()}>
              {judgeLinkCopied ? <Check size={16} /> : <Copy size={16} />}
              {judgeLinkCopied ? t('home.judgeLinkCopied') : t('home.judgeCopyLink')}
            </button>
          </div>
          {(judgeLinkCopied || judgeLinkCopyFailed) && (
            <p className="home-copy-status" role="status">
              {judgeLinkCopied ? t('home.judgeLinkCopiedStatus') : t('home.judgeLinkCopyFailed')}
            </p>
          )}
          <div className="home-architecture-strip" aria-label={t('home.judgeFlowLabel')}>
            {[1, 2, 3].map((step) => (
              <div className="home-architecture-step" key={step}>
                <span>0{step}</span>
                <strong>{t(`home.judgeFlow${step}`)}</strong>
              </div>
            ))}
          </div>
        </div>
        <figure className="home-hero-art-wrap">
          <img className="home-hero-art" src={publicImage('time-tunnel.webp')} alt={t('home.heroArtAlt')} />
        </figure>
        <div className="home-flow-wrap">
          <p className="home-flow-range">{t('home.flowRange')}</p>
          <div className="home-hero-notes" aria-label={t('home.heroProgressLabel')}>
            <svg className="home-flow-connectors" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <marker id="home-flow-arrow" viewBox="0 0 4 4" refX="3.6" refY="2" markerWidth="5" markerHeight="5" orient="auto" markerUnits="strokeWidth">
                  <path d="M0 0L4 2L0 4Z" fill="#62E5EF" />
                </marker>
              </defs>
              <path className="home-flow-track home-flow-desktop" d="M20 50 C28 42 39 58 47 50" />
              <path className="home-flow-track home-flow-desktop" d="M53 50 C61 58 72 42 80 50" />
              <path className="home-flow-dash home-flow-desktop" d="M20 50 C28 42 39 58 47 50" markerEnd="url(#home-flow-arrow)" />
              <path className="home-flow-dash home-flow-desktop" d="M53 50 C61 58 72 42 80 50" markerEnd="url(#home-flow-arrow)" />
              <path className="home-flow-dash home-flow-mobile" d="M10 30 C11.5 31 8.5 34 10 35" markerEnd="url(#home-flow-arrow)" />
              <path className="home-flow-dash home-flow-mobile" d="M10 65 C8.5 66 11.5 69 10 70" markerEnd="url(#home-flow-arrow)" />
            </svg>
            {heroNotes.map((note) => (
              <div className="home-hero-note" key={note.title} tabIndex={0} aria-label={`${t(note.title)}. ${t(note.body)}`}>
                <img className="home-hero-note-art" src={note.image} alt="" aria-hidden="true" loading="lazy" />
                <strong>{t(note.title)}</strong>
                <span className="home-hero-note-tooltip" role="tooltip">{t(note.body)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-evidence" aria-labelledby="home-evidence-title">
        <div>
          <span className="home-section-eyebrow">{t('home.judgeEvidenceEyebrow')}</span>
          <h2 id="home-evidence-title">{t('home.judgeEvidenceTitle')}</h2>
          <p>{t('home.judgeEvidenceSub')}</p>
        </div>
        <div className="home-evidence-links">
          <a href={isSolana ? `https://explorer.solana.com/address/${SOLANA_PROGRAM_ID}?cluster=devnet` : activeChain?.contractAddress ? `${activeChain.blockExplorer}/address/${activeChain.contractAddress}` : undefined} target="_blank" rel="noreferrer">
            {t(isSolana ? 'common.programAddress' : 'home.judgeEvidenceRegistry')} <span className="font-mono">{isSolana ? `Solana Devnet · ${SOLANA_PROGRAM_ID.slice(0, 6)}…${SOLANA_PROGRAM_ID.slice(-5)}` : activeChain?.contractAddress ? `${activeChain.id} · ${activeChain.contractAddress.slice(0, 6)}…${activeChain.contractAddress.slice(-4)}` : t('nav.notConfigured')}</span><ArrowRight size={14} />
          </a>
          <a href={isSolana ? 'https://github.com/jiushi506/TimeCapsule-Sol' : activeChain?.contractAddress ? `${activeChain.blockExplorer}/address/${activeChain.contractAddress}#code` : undefined} target="_blank" rel="noreferrer">
            {t('common.sourceCode')} <ArrowRight size={14} />
          </a>
          <a href="https://github.com/jiushi506/TimeCapsule-Sol/blob/main/web/src/codec/types.ts" target="_blank" rel="noreferrer">
            {t('home.judgeEvidenceFormat')} <ArrowRight size={14} />
          </a>
          <a href="https://github.com/jiushi506/TimeCapsule-Sol/tree/main/web" target="_blank" rel="noreferrer">
            {t('home.judgeEvidenceCli')} <ArrowRight size={14} />
          </a>
        </div>
      </section>

      <section className="home-usecases" aria-labelledby="home-usecases-title">
        <div className="home-section-heading">
          <span className="home-section-eyebrow">{t('home.useCasesEyebrow')}</span>
          <h2 id="home-usecases-title">{t('home.useCasesTitle')}</h2>
          <p>{t('home.useCasesSub')}</p>
        </div>
        <div className="home-usecase-grid">
          {useCases.map((item) => (
            <article className="home-usecase-card" key={item.number}>
              <div className="home-usecase-art">
                <img src={item.image} alt={t(item.alt)} loading="lazy" />
                <span className="home-usecase-number">{item.number}</span>
              </div>
              <div className="home-usecase-copy">
                <h3>{t(item.title)}</h3>
                <p>{t(item.body)}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="home-lifecycle" aria-labelledby="home-lifecycle-title">
        <div className="home-section-heading home-section-heading-left">
          <span className="home-section-eyebrow">{t('home.lifecycleEyebrow')}</span>
          <h2 id="home-lifecycle-title">{t('home.lifecycleTitle')}</h2>
          <p>{t('home.lifecycleSub')}</p>
        </div>
        <div className="home-steps-grid">
          {lifecycleItems.map((item) => (
            <article className="home-step-card" key={item.name}>
              <div className="home-step-icon" aria-hidden="true">
                <img src={item.icon} alt="" loading="lazy" />
              </div>
              <h3>{t(item.name)}</h3>
              <p>{t(item.body)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="home-open-network" aria-labelledby="home-open-network-title">
        <div className="home-open-network-heading">
          <div className="home-network-symbol" aria-hidden="true"><Globe2 size={26} /></div>
          <span className="home-section-eyebrow">{t('home.openNetworkEyebrow')}</span>
          <h2 id="home-open-network-title">{t('home.openNetworkTitle')}</h2>
        </div>
        <div className="home-open-network-copy">
          <p>{t('home.openNetworkSub')}</p>
          <div className="home-network-caveat"><ShieldCheck size={17} /><span>{t('home.openNetworkCaveat')}</span></div>
          <button className="home-text-link" onClick={() => onNavigate('explore')}>
            {t('home.openNetworkCta')}<ArrowRight size={16} />
          </button>
        </div>
        <div className="home-protocol">
          <div className="home-protocol-intro">
            <span className="home-section-eyebrow">{t('home.protocolEyebrow')}</span>
            <h3>{t('home.protocolTitle')}</h3>
            <p>{t('home.protocolSub')}</p>
          </div>
          <div className="home-protocol-grid">
            {protocolPoints.map(({ icon: Icon, title, body, tone }, index) => (
              <article className="home-protocol-card" key={title}>
                <div className={`home-protocol-icon ${tone}`}><Icon size={19} /></div>
                <span className="home-protocol-index">0{index + 1}</span>
                <h4>{t(title)}</h4>
                <p>{t(body)}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className="home-final-cta">
        <button id="hero-btn-cta-bottom" className="btn-primary home-bottom-cta" onClick={() => onNavigate('create')}>
          {t('home.ctaBottom')}<ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
};
