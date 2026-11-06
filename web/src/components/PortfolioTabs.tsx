import { FileText, Lock } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

export function PortfolioTabs({ value, onChange, chainCount, draftCount }: {
  value: 'onchain' | 'drafts'; onChange: (value: 'onchain' | 'drafts') => void; chainCount: number | string; draftCount: number;
}) {
  const { t } = useLanguage();
  return <div className="portfolio-tabs" role="tablist" aria-label={t('my.title')}>
    {(['onchain', 'drafts'] as const).map((tab) => <button key={tab} role="tab" aria-selected={value === tab} id={tab === 'onchain' ? 'tab-onchain-capsules' : 'tab-local-drafts'}
      className={value === tab ? `portfolio-tab-active portfolio-tab-${tab}` : ''} type="button" onClick={() => onChange(tab)}>
      {tab === 'onchain' ? <Lock size={15} /> : <FileText size={15} />}{t(tab === 'onchain' ? 'my.tabOnChain' : 'my.tabDrafts')} ({tab === 'onchain' ? chainCount : draftCount})
    </button>)}
  </div>;
}
