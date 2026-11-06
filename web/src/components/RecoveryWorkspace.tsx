import { formatUtcDateTime } from '../utils/dateTime';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, FileJson, ShieldCheck, Unlock, UploadCloud, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { CapsulePageHeader } from './CapsulePageLayout';
import { CapsuleTitleText } from './CapsuleTitleText';
import { LoadingText } from './LoadingText';
import { PortfolioCapsuleCard } from './PortfolioCapsuleCard';
import { useAccessibleModal } from '../utils/useAccessibleModal';

export type RecoveryMethod = 'wallet' | 'capsuleId' | 'file';

export function RecoveryHeader({ networkName }: { networkName: string }) {
  const { t } = useLanguage();
  return <CapsulePageHeader centered title={t('recovery.toolTitle')} description={<>{t('recovery.verifiedViaRpc')} {networkName}. {t('recovery.headerSuffix')}</>}
    badges={<><span className="badge badge-purple">{t('recovery.verifiedViaRpc')}</span><span className="badge badge-cyan">{t('recovery.badgeScanner')}</span></>} />;
}

export function RecoveryScanner({ children }: { children: ReactNode }) {
  return <div className="glass-panel recovery-scanner">{children}</div>;
}

export function RecoveryMethodTabs({ value, onChange }: { value: RecoveryMethod; onChange: (value: RecoveryMethod) => void }) {
  const { t } = useLanguage();
  return <div className="recovery-method-tabs" role="tablist" aria-label={t('recovery.toolTitle')}>
    {(['wallet', 'capsuleId', 'file'] as const).map((method) => <button key={method} type="button" role="tab" aria-selected={value === method} id={`tab-search-${method === 'capsuleId' ? 'id' : method}`}
      className={value === method ? `recovery-method-active${method === 'file' ? ' recovery-method-file' : ''}` : ''} onClick={() => onChange(method)}>
      {t(method === 'wallet' ? 'recovery.tabWallet' : method === 'capsuleId' ? 'recovery.tabId' : 'recovery.tabFile')}
    </button>)}
  </div>;
}

export function RecoveryCardUpload({ onFile, isBusy }: { onFile: (file: File) => void; isBusy?: boolean }) {
  const { t } = useLanguage();
  const [json, setJson] = useState('');
  return <div className="recovery-card-upload" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !isBusy) onFile(file); }}>
    <UploadCloud size={40} color="var(--cyan-primary)" style={{ margin: '0 auto 12px' }} />
    <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('recovery.uploadCard')}</div>
    <div style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: 20 }}>{t('recovery.uploadDrop')}</div>
    <label id="btn-upload-file-label" className="btn-secondary" style={{ position: 'relative', cursor: 'pointer', display: 'inline-flex', padding: '10px 20px' }}>
      <FileJson size={16} />{t('recovery.selectJson')}
      <input id="input-upload-recovery-card" type="file" accept="application/json,.json" disabled={isBusy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }} className="visually-hidden" />
    </label>
    <details style={{ marginTop: 18, textAlign: 'left' }}>
      <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.82rem' }}>{t('common.pasteCard')}</summary>
      <div className="recovery-field" style={{ marginTop: 12 }}><label htmlFor="input-paste-recovery-card" className="visually-hidden">{t('common.pasteCard')}</label><textarea id="input-paste-recovery-card" rows={8} value={json} onChange={(event) => setJson(event.target.value)} style={{ fontFamily: 'monospace' }} /></div>
      <button type="button" className="btn-secondary" disabled={isBusy || !json.trim()} onClick={() => onFile(new File([json], 'recovery-card.json', { type: 'application/json' }))}>{t('common.verifyCard')}</button>
    </details>
  </div>;
}

export function RecoveryResults({ count, source = 'chain', children }: { count: number; source?: 'chain' | 'demo' | 'card'; children: ReactNode }) {
  const { t } = useLanguage();
  return <section className="glass-panel recovery-results">
    <div className="recovery-results-heading"><div><h3>{t(source === 'chain' ? 'recovery.discoveredChain' : source === 'demo' ? 'recovery.localDemoData' : 'recovery.cardData')}</h3>
      <div>{source === 'chain' ? `${t('recovery.foundRecords')} ${count} ${t('recovery.verifiedRecordsSuffix')}` : t('recovery.unverifiedData')}</div></div>
      <span className={`badge ${source === 'chain' ? 'badge-emerald' : 'badge-amber'}`}>{t(source === 'chain' ? 'recovery.verifiedViaRpc' : 'recovery.notChainVerified')}</span>
    </div>
    {!count ? <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '.9rem' }}>{t('recovery.noCapsules')}</div> : <div className="recovery-result-list">{children}</div>}
  </section>;
}

export function RecoveryResultItem({ id, capsuleId, mode, badges, title, publicTitle, owner, identity, payloadHash, unlockAt, now, onSelect }: {
  id: string; capsuleId: number | string; mode: 'private' | 'public'; badges?: ReactNode; title: string; publicTitle?: string; owner: string; identity: ReactNode; payloadHash: string; unlockAt: number; now: number; onSelect: () => void;
}) {
  const { t } = useLanguage();
  return <PortfolioCapsuleCard id={id} capsuleId={capsuleId} mode={mode}
    badges={badges} unlockAt={unlockAt} now={now}
    identity={<span className="recovery-card-identity">{identity}</span>}
    name={<div className="capsule-name-row"><h3><CapsuleTitleText text={title} /></h3></div>}
    nameSource={publicTitle ? t('recovery.verifiedPublicTitle') : null}
    technicalDetails={<>
      <div className="font-mono recovery-result-meta">{t('recovery.ownerWalletAddress')}: {owner}</div>
      <div className="font-mono recovery-result-meta">{identity}</div>
      <div className="font-mono recovery-result-meta">SHA-256 {payloadHash}</div>
    </>}
    actions={<button id={`btn-select-recovery-capsule-${capsuleId}`} type="button" className="btn-primary" onClick={onSelect}>
      <Unlock size={16} />{t('recovery.selectDecrypt')}
    </button>}
  />;
}

export function RecoveryDecryptionPanel({ capsuleId, mode, title, verifiedTitle, identity, badges, unlockAt, now, password, onPasswordChange, message, imageUrl, error, isBusy, onDecrypt, onClose, actions }: {
  capsuleId: number | string; mode: 'private' | 'public'; title: string; verifiedTitle: boolean; identity: ReactNode; badges?: ReactNode; unlockAt: number; now: number;
  password: string; onPasswordChange: (value: string) => void; message: string | null; imageUrl?: string | null; error: string | null; isBusy: boolean; onDecrypt: () => void; onClose: () => void; actions?: ReactNode;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const titleId = useId();
  const dialogRef = useAccessibleModal<HTMLElement>(true, onClose);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);
  return createPortal(<div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
      data-accessible-dialog="true" className="glass-panel recovery-decryption-panel recovery-decryption-modal">
    <button type="button" data-dialog-initial-focus className="recovery-dialog-close" aria-label={t('my.closeDetailsAria')} onClick={onClose}><X size={18} /></button>
    <div className="recovery-result-badges" style={{ marginBottom: 12 }}><span className="badge badge-cyan">Capsule #{capsuleId}</span><span className="badge badge-purple">{mode.toUpperCase()}</span>{badges}</div>
    <div className="font-mono recovery-result-meta" style={{ marginBottom: 12 }}>{identity}</div>
    <div style={{ marginBottom: 12, overflowWrap: 'anywhere', fontWeight: 700 }}><CapsuleTitleText text={title} />{verifiedTitle && <div style={{ fontSize: '.7rem', fontWeight: 500, color: 'var(--text-dim)', marginTop: 4 }}>{t('recovery.verifiedPublicTitle')}</div>}</div>
    <h2 id={titleId} style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 8 }}>{t('recovery.localDecryptionTitle')}</h2>
    <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginBottom: 20 }}>{t('recovery.localDecryptionDesc')}</p>
    <div role="status" className="recovery-release-note">{t(now < unlockAt ? 'recovery.dateNotPassed' : 'recovery.datePassed')} {t('recovery.localClockNote')} {t('recovery.targetLabel')}: <strong>{formatUtcDateTime(unlockAt * 1000)}</strong>.</div>
    {message !== null ? <>
      <div className="recovery-verified-note"><ShieldCheck size={16} />{t('recovery.plaintextVerified')}</div>
      <div className="capsule-plaintext" style={{ position: 'relative', paddingTop: 48 }}>
        <button type="button" className="recovery-copy-plaintext" onClick={() => { void navigator.clipboard.writeText(message).then(() => { setCopied(true); setCopyError(false); window.setTimeout(() => setCopied(false), 2000); }).catch(() => setCopyError(true)); }}>
          {copied ? <Check size={12} /> : <Copy size={12} />}{t(copied ? 'recovery.copied' : 'recovery.copy')}
        </button>
        <div style={{ fontSize: '.78rem', color: 'var(--text-dim)', marginBottom: 8 }}>{t('recovery.decryptedPlaintext')}:</div>{message}
      </div>
      {imageUrl && <img src={imageUrl} alt={t('collab.create.photoPreview')} style={{ display: 'block', width: '100%', maxHeight: 520, objectFit: 'contain', marginTop: 14, borderRadius: 'var(--radius-md)', background: 'rgba(0,0,0,.3)' }} />}
      {copyError && <p role="alert" style={{ color: '#fb7185' }}>{t('common.copyFailed')}</p>}
    </> : <>
      {mode === 'private' && <div className="recovery-field"><label htmlFor="input-recovery-password" style={{ color: '#c084fc' }}>{t('recovery.privatePassphraseLabel')}</label>
        <input id="input-recovery-password" type="password" autoComplete="current-password" placeholder={t('recovery.passphrasePlaceholder')} value={password} onChange={(event) => onPasswordChange(event.target.value)} /></div>}
      {error && <div role="alert" className="capsule-inline-error">{error}</div>}
      <button id="btn-recover-decrypt-submit" type="button" className="btn-primary" disabled={isBusy} onClick={onDecrypt} style={{ width: '100%', padding: 14, fontSize: '.95rem' }}><Unlock size={16} />{isBusy ? <LoadingText>{t('recovery.decrypting')}</LoadingText> : t('recovery.unsealDecrypt')}</button>
    </>}
    {actions && <div className="recovery-panel-actions">{actions}</div>}
    </section>
  </div>, document.body);
}
