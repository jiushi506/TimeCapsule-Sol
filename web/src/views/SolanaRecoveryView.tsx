import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Search, Wallet } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useSolanaWallet } from '../context/solanaWalletState';
import { decryptSolanaCapsule, fetchSolanaCapsule, formatSolanaError, SOLANA_DEVNET_RPC_URL, SOLANA_PROGRAM_ID, type SolanaCapsuleRecord, type SolanaRecoveryCard } from '../services/solanaCapsuleService';
import { fetchIndexedSolanaCapsules, fetchVerifiedIndexedSolanaCapsule, type IndexedSolanaCapsuleMetadata } from '../services/solanaPublicCapsuleIndex';
import { RecoveryHeader, RecoveryScanner, RecoveryMethodTabs, RecoveryCardUpload, RecoveryResults, RecoveryResultItem, RecoveryDecryptionPanel, type RecoveryMethod } from '../components/RecoveryWorkspace';
import { LoadingText } from '../components/LoadingText';
import { IndependentRecoveryTools } from '../components/IndependentRecoveryTools';
import { exportSolanaRecoveryCard } from '../services/solanaCapsuleService';

interface Props { initialSearch: string }
function readInitialSearch(search: string) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return { capsulePda: params.get('capsulePda') ?? '', owner: params.get('owner') ?? '', capsuleId: params.get('capsuleId') ?? '' };
}

export const SolanaRecoveryView: React.FC<Props> = ({ initialSearch }) => {
  const { t } = useLanguage();
  const wallet = useSolanaWallet();
  const initial = readInitialSearch(initialSearch);
  const [rpcUrl, setRpcUrl] = useState(SOLANA_DEVNET_RPC_URL);
  const [method, setMethod] = useState<RecoveryMethod>(initial.capsulePda || initial.capsuleId ? 'capsuleId' : 'wallet');
  const [usePda, setUsePda] = useState(Boolean(initial.capsulePda));
  const [capsulePda, setCapsulePda] = useState(initial.capsulePda);
  const [owner, setOwner] = useState(initial.owner || wallet.address || '');
  const [capsuleId, setCapsuleId] = useState(initial.capsuleId);
  const [records, setRecords] = useState<SolanaCapsuleRecord[] | null>(null);
  const [indexedRecords, setIndexedRecords] = useState<IndexedSolanaCapsuleMetadata[] | null>(null);
  const [indexCoverage, setIndexCoverage] = useState('unknown');
  const [indexStatus, setIndexStatus] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const [selected, setSelected] = useState<SolanaCapsuleRecord | null>(null);
  const [password, setPassword] = useState('');
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const readVersion = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const decryptVersion = useRef(0);

  useEffect(() => {
    if (!imageUrl) return;
    return () => URL.revokeObjectURL(imageUrl);
  }, [imageUrl]);

  const clearSelection = () => { decryptVersion.current += 1; setSelected(null); setPassword(''); setPlaintext(null); setImageUrl(null); setDecryptError(null); setIsDecrypting(false); };
  const cancelRead = () => {
    readVersion.current += 1;
    readController.current?.abort();
    readController.current = null;
    setIsReading(false);
    setStatus('');
  };
  const changeMethod = (next: RecoveryMethod) => { cancelRead(); clearSelection(); setMethod(next); setRecords(null); setIndexedRecords(null); setError(null); };
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => {
      window.clearInterval(timer);
      readVersion.current += 1;
      readController.current?.abort();
      readController.current = null;
      decryptVersion.current += 1;
    };
  }, []);


  const beginRead = (loadingStatus = t('recovery.queryingRpc')) => {
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const version = ++readVersion.current;
    clearSelection(); setRecords(null); setIndexedRecords(null); setError(null); setIsReading(true); setStatus(loadingStatus);
    return version;
  };
  const acceptRead = (version: number, result: SolanaCapsuleRecord[]) => {
    if (version !== readVersion.current) return;
    setRecords(result); setStatus(t('recovery.verifiedViaRpc'));
  };
  const reportReadError = (version: number, cause: unknown) => {
    if (version === readVersion.current) { setError(formatSolanaError(cause, 'Could not recover verified capsule data.')); setStatus(''); }
  };
  const scan = async (event: React.FormEvent) => {
    event.preventDefault();
    const version = beginRead(method === 'wallet' ? t('my.indexLoading') : t('recovery.queryingRpc'));
    try {
      if (method === 'wallet') {
        const result = await fetchIndexedSolanaCapsules({ ownerAddress: owner.trim(), signal: readController.current?.signal });
        if (version !== readVersion.current) return;
        setIndexedRecords(result.capsules);
        setIndexCoverage(result.coverage);
        setIndexStatus(result.status);
        setStatus(result.status === 'available'
          ? `${result.capsules.length} ${t('explore.publicCapsulesLoaded')}. ${t('solana.indexCoverage')} ${result.coverage}. ${''}`
          : t(result.status === 'unknown' ? 'my.indexUnknown' : 'my.indexUnavailable'));
      } else {
        const result = [await fetchSolanaCapsule({ rpcUrl: rpcUrl.trim(), capsulePda: usePda ? capsulePda.trim() : undefined, owner: usePda ? undefined : owner.trim(), capsuleId: usePda ? undefined : capsuleId.trim() })];
        acceptRead(version, result);
      }
    } catch (cause) { reportReadError(version, cause); }
    finally {
      if (version === readVersion.current) {
        readController.current = null;
        setIsReading(false);
      }
    }
  };
  const readFile = async (file: File) => {
    const version = beginRead();
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Recovery Card exceeds the 4 MB file limit.');
      const text = await file.text(); const raw = JSON.parse(text);
      if (file.size > 1024 * 1024) throw new Error('Recovery Card exceeds the 1 MB file limit.');
      const card = raw as SolanaRecoveryCard;
      if (version !== readVersion.current) return;
      if (!card || card.version !== 2 || card.chainNamespace !== 'solana' || card.cluster !== 'devnet') throw new Error('Select a Solana Devnet Recovery Card v2.');
      acceptRead(version, [await fetchSolanaCapsule({ rpcUrl: rpcUrl.trim(), card })]);
    } catch (cause) { reportReadError(version, cause); }
    finally {
      if (version === readVersion.current) {
        readController.current = null;
        setIsReading(false);
      }
    }
  };
  const decrypt = async () => {
    if (!selected) return;
    const version = ++decryptVersion.current;
    setIsDecrypting(true); setDecryptError(null); setPlaintext(null); setImageUrl(null);
    try {
      // Selection already fetched and verified this exact capsule from the chain.
      // Decrypt those verified ciphertext bytes locally; do not re-read the account.
      const message = await decryptSolanaCapsule(selected, selected.mode === 'private' ? password : undefined);
      const opened: { text: string; imageUrl?: string; revokeImage?: () => void } = { text: message };
      if (version === decryptVersion.current) { setPlaintext(opened.text); setImageUrl(opened.imageUrl ?? null); setPassword(''); }
      else opened.revokeImage?.();
    } catch (cause) { if (version === decryptVersion.current) setDecryptError(formatSolanaError(cause, 'Could not decrypt the verified capsule.')); }
    finally { if (version === decryptVersion.current) setIsDecrypting(false); }
  };
  const openIndexedRecord = async (record: IndexedSolanaCapsuleMetadata) => {
    const version = ++readVersion.current;
    clearSelection(); setError(null); setIsReading(true); setStatus(t('recovery.queryingRpc'));
    try {
      const verified = await fetchVerifiedIndexedSolanaCapsule(record);
      if (version === readVersion.current) { setSelected(verified); setStatus(t('recovery.verifiedViaRpc')); }
    } catch (cause) { reportReadError(version, cause); }
    finally { if (version === readVersion.current) setIsReading(false); }
  };
  const copyCli = async () => {
    if (!selected) return;
    try {
      const card = await exportSolanaRecoveryCard(selected.capsulePda);
      const url = URL.createObjectURL(new Blob([JSON.stringify(card, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `timecapsule-${card.capsuleId}.json`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setCopied(true);
    } catch (error) { setError(formatSolanaError(error, 'Could not export the verified recovery card.')); }
  };
  const name = (record: SolanaCapsuleRecord) => record.publicTitle || `${t('my.capsuleNoun')} #${record.capsuleId}`;

  return <div style={{ maxWidth: 900, margin: '0 auto', padding: '36px 20px' }}>
    <RecoveryHeader networkName="Solana Devnet" />
    <IndependentRecoveryTools />
    <RecoveryScanner>
      <RecoveryMethodTabs value={method} onChange={changeMethod} />
      {method === 'file' ? <RecoveryCardUpload onFile={(file) => void readFile(file)} isBusy={isReading} /> : <form onSubmit={scan}>
        <div className="recovery-field"><label htmlFor="recovery-network">{t('recovery.networkToScan')}</label>
          <button id="recovery-network" type="button" disabled className="network-selector-button recovery-network-selector-button"><span className="network-selector-label"><span className="network-option-indicator" style={{ background: '#9945ff' }} /><span>Solana Devnet</span></span><ChevronDown size={15} /></button>
        </div>
        <div className="recovery-settings-grid">
          {method === 'capsuleId' && <div className="recovery-field"><label htmlFor="input-recovery-rpc">{t('recovery.rpcEndpoint')}</label><input id="input-recovery-rpc" value={rpcUrl} onChange={(event) => setRpcUrl(event.target.value)} required /></div>}
          <div className="recovery-field"><label htmlFor="input-recovery-contract">{t('common.programAddress')}</label><input id="input-recovery-contract" value={SOLANA_PROGRAM_ID} readOnly /></div>
        </div>
        {method === 'capsuleId' && <fieldset className="recovery-lookup-choice"><legend>{t('common.capsuleLookup')}</legend>
          <label><input type="radio" name="solana-id-lookup" checked={!usePda} onChange={() => setUsePda(false)} />{t('common.ownerAndId')}</label>
          <label><input type="radio" name="solana-id-lookup" checked={usePda} onChange={() => setUsePda(true)} />Capsule PDA</label>
        </fieldset>}
        {method === 'capsuleId' && usePda ? <div className="recovery-field"><label htmlFor="input-recovery-capsule-pda">Capsule PDA</label><input id="input-recovery-capsule-pda" value={capsulePda} onChange={(event) => setCapsulePda(event.target.value)} placeholder={t('common.solanaAddress')} required /></div>
          : <>
            <div className="recovery-field"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}><label htmlFor="input-recovery-wallet-address">{t('recovery.ownerWalletAddress')}</label>
              {wallet.address && <button type="button" id="btn-use-connected-wallet" className="recovery-use-wallet" onClick={() => setOwner(wallet.address!)}><Wallet size={12} />{t('recovery.useMyWallet')} ({wallet.address.slice(0, 6)}…{wallet.address.slice(-4)})</button>}
            </div><input id="input-recovery-wallet-address" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder={t('common.solanaAddress')} aria-describedby="recovery-wallet-address-help" required />
              <p id="recovery-wallet-address-help" style={{ color: 'var(--text-muted)', fontSize: '.78rem', lineHeight: 1.5, marginTop: 8 }}>{t('recovery.ownerWalletHint')}</p>
            </div>
            {method === 'capsuleId' && <div className="recovery-field"><label htmlFor="input-recovery-capsule-id">{t('create.capsuleId')}</label><input id="input-recovery-capsule-id" value={capsuleId} onChange={(event) => setCapsuleId(event.target.value)} inputMode="numeric" pattern="[0-9]+" placeholder={t('recovery.capsuleIdPlaceholder')} required /></div>}
          </>}
        <button id="btn-run-recovery-scan" type="submit" className="btn-primary" disabled={isReading} style={{ width: '100%', padding: 14, fontSize: '.95rem', gap: 8 }}><Search size={16} />{isReading ? <LoadingText>{status || t('recovery.queryingRpc')}</LoadingText> : t('recovery.btnScan')}</button>
        {isReading && <button type="button" className="btn-secondary" onClick={cancelRead} style={{ width: '100%', marginTop: 10 }}>{t('recovery.cancelScan')}</button>}
      </form>}
      {error && <div role="alert" className="capsule-inline-error">{error}</div>}
      {status && <p role="status" style={{ color: 'var(--text-muted)', fontSize: '.82rem', marginTop: 14 }}>{isReading ? <LoadingText>{status}</LoadingText> : status}</p>}
    </RecoveryScanner>
    {indexedRecords && indexStatus === 'available' && <section className="glass-panel recovery-results">
      <div className="recovery-results-heading"><div><h3>{t('recovery.verifiedViaRpc')}</h3>
        <div>{indexedRecords.length} {t('explore.publicCapsulesLoaded')}. {t('recovery.verifiedViaRpc')} ({indexCoverage})</div></div>
        <span className="badge badge-amber">{t('recovery.verifiedViaRpc')}</span>
      </div>
      {!indexedRecords.length ? <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '.9rem' }}>{t('my.indexEmpty')}</div> : <div className="recovery-result-list">
        {indexedRecords.map((record) => <RecoveryResultItem key={record.capsulePda} id={`recovery-result-solana-${record.capsulePda}`} capsuleId={record.capsulePda.slice(0, 8)} mode={record.mode} owner={record.owner}
          title={record.publicTitle || `${t('my.capsuleNoun')} #${record.capsulePda.slice(0, 8)}`} publicTitle={record.publicTitle} unlockAt={record.unlockAt} now={now} payloadHash={record.payloadHash}
          badges={<><span className="badge badge-cyan">Solana</span><span className="badge badge-cyan">{t('recovery.verifiedViaRpc')}</span></>}
          identity={<>Solana Devnet · {record.capsulePda}</>} onSelect={() => void openIndexedRecord(record)} />)}
      </div>}
    </section>}
    {records && <RecoveryResults count={records.length}>
      {records.map((record) => <RecoveryResultItem key={record.capsulePda} id={`recovery-result-solana-${record.capsulePda}`} capsuleId={record.capsuleId} mode={record.mode} owner={record.owner}
        title={name(record)} publicTitle={record.publicTitle} unlockAt={record.unlockAt} now={now} payloadHash={record.payloadHash}
        badges={<><span className="badge badge-cyan">Solana</span><span className="badge badge-cyan">{t('recovery.format')} V{record.formatVersion}</span></>}
        identity={<>Solana Devnet · {record.capsulePda}</>} onSelect={() => { clearSelection(); setSelected(record); }} />)}
    </RecoveryResults>}
    {selected && <RecoveryDecryptionPanel key={selected.capsulePda} capsuleId={selected.capsuleId} mode={selected.mode} title={name(selected)} verifiedTitle={Boolean(selected.publicTitle)}
      identity={<>Solana Devnet · {selected.capsulePda}</>} badges={<span className="badge badge-cyan">Solana</span>} unlockAt={selected.unlockAt} now={now}
      password={password} onPasswordChange={setPassword} message={plaintext} imageUrl={imageUrl} error={decryptError} isBusy={isDecrypting} onDecrypt={() => void decrypt()} onClose={clearSelection}
      actions={<button type="button" className="btn-secondary" onClick={() => void copyCli()}>{copied ? <Check size={14} /> : <Copy size={14} />}{t('my.downloadCard')}</button>} />}
  </div>;
};
