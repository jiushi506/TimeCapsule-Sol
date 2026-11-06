import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { decryptSolanaCapsule, formatSolanaError } from '../services/solanaCapsuleService';
import { fetchVerifiedIndexedSolanaCapsule, type IndexedSolanaCapsuleMetadata } from '../services/solanaPublicCapsuleIndex';
import { ExplorerHeader, ExplorerToolbar, ExplorerReadStatus, PublicCapsuleCard, PublicCapsuleReadModal, type ExplorerFilter } from '../components/PublicCapsuleExplorer';
import { LoadingText } from '../components/LoadingText';
import { useSolanaCapsuleList } from './useSolanaCapsuleList';

interface Props { onNavigate: (tab: string) => void }

export const SolanaExploreView: React.FC<Props> = ({ onNavigate }) => {
  const { t } = useLanguage();
  const { capsules, isLoading, error, indexStatus, indexCoverage, refresh } = useSolanaCapsuleList('public');
  const [filter, setFilter] = useState<ExplorerFilter>('all');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [selected, setSelected] = useState<IndexedSolanaCapsuleMetadata | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const version = useRef(0);
  const close = () => { version.current += 1; setSelected(null); setMessage(null); setReadError(null); setIsReading(false); };
  useEffect(() => { const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => { window.clearInterval(timer); version.current += 1; }; }, []);
  const filtered = capsules.filter((record) => filter === 'all' || (filter === 'unlocked' ? now >= record.unlockAt : now < record.unlockAt));
  const open = async (record: IndexedSolanaCapsuleMetadata) => {
    const request = ++version.current;
    setSelected(record); setMessage(null); setReadError(null); setIsReading(true);
    try {
      const verified = await fetchVerifiedIndexedSolanaCapsule(record);
      const plaintext = await decryptSolanaCapsule(verified);
      if (request === version.current) setMessage(plaintext);
    } catch (cause) { if (request === version.current) setReadError(formatSolanaError(cause, 'Could not open this public capsule.')); }
    finally { if (request === version.current) setIsReading(false); }
  };
  const state = isLoading ? 'loading' : error || indexStatus === 'unavailable' ? 'error' : capsules.length ? 'success-data' : 'success-empty';
  const listStatus = error || (indexStatus === 'unavailable' ? t('explore.indexUnavailable')
    : indexStatus === 'unknown' ? t('explore.indexUnknown')
      : capsules.length ? `${capsules.length} ${t('explore.publicCapsulesLoaded')}. ${t('recovery.verifiedViaRpc')} (${indexCoverage}).`
        : `${t('explore.allReadNoMatch')} ${t('recovery.verifiedViaRpc')} (${indexCoverage}).`);
  return <div style={{ maxWidth: 1100, margin: '0 auto', padding: '36px 20px' }}>
    <ExplorerHeader networkName="Solana Devnet" />
    <ExplorerToolbar filter={filter} onFilter={setFilter} count={capsules.length} hasLoaded={!isLoading} isLoading={isLoading}
      onRefresh={() => { close(); void refresh(); }} onCreate={() => onNavigate('create')} />
    <ExplorerReadStatus state={state}>{isLoading ? <LoadingText>{t('my.indexLoading')}</LoadingText> : listStatus}</ExplorerReadStatus>
    <div className="public-capsule-grid">
      {!isLoading && capsules.length > 0 && !filtered.length && <p style={{ color: 'var(--text-muted)', gridColumn: '1 / -1', textAlign: 'center', padding: 32 }}>{t('common.noFilterMatches')}</p>}
      {filtered.map((record) => <PublicCapsuleCard key={record.capsulePda} id={`explore-solana-${record.capsulePda}`} capsuleId={record.capsulePda.slice(0, 8)} owner={record.owner}
        title={record.publicTitle || `${t('my.capsuleNoun')} #${record.capsulePda.slice(0, 8)}`} verifiedTitle={Boolean(record.publicTitle)} unlockAt={record.unlockAt} now={now}
        badges={<span className="capsule-version">Solana</span>}
        identity={<>Solana Devnet · {record.capsulePda.slice(0, 6)}…{record.capsulePda.slice(-5)} · Capsule PDA</>}
        identityLink={<a href={`https://explorer.solana.com/address/${record.capsulePda}?cluster=devnet`} target="_blank" rel="noreferrer">{t('nav.viewOnExplorer')}</a>}
        onRead={() => void open(record)} />)}
    </div>
    {(error || indexStatus !== 'available') && <div style={{ textAlign: 'center', marginTop: 24 }}><button type="button" className="btn-secondary" onClick={() => void refresh()}>{t('auth.retry')}</button></div>}
    {selected && <PublicCapsuleReadModal capsuleId={selected.capsulePda.slice(0, 8)} title={selected.publicTitle} verifiedTitle={Boolean(selected.publicTitle)}
      message={message} error={readError} isBusy={isReading} onClose={close} />}
  </div>;
};
