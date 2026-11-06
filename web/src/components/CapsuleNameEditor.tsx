import { useState } from 'react';
import { Check, Edit3, Trash2, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { CapsuleTitleText } from './CapsuleTitleText';

/** Personal names are independent of immutable public titles. */
export function CapsuleNameEditor({ id, capsuleId, displayName, label, onSave, onRemove }: {
  id: string; capsuleId: string | number; displayName: string; label?: string | null;
  onSave: (value: string) => void | Promise<void>; onRemove: () => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancel = () => { setEditing(false); setError(null); };
  const commit = async (action: () => void | Promise<void>) => {
    setBusy(true); setError(null);
    try { await action(); cancel(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('create.localLabelSaveFailed')); }
    finally { setBusy(false); }
  };
  return <>
    <div className="capsule-name-row">
      {editing ? <form className="capsule-label-editor" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (!busy) void commit(() => onSave(value)); }}>
        <input id={`local-label-${id}`} disabled={busy} autoFocus value={value} onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Escape') cancel(); }} aria-label={`${t('shared.personalName')} ${displayName}`} placeholder={t('memory.titlePlaceholder')} />
        <button disabled={busy} type="submit" className="capsule-icon-button capsule-icon-save" aria-label={`${t('my.saveLabelAria')} ${capsuleId}`} title={t('my.saveLabelAria')}><Check size={16} /></button>
        <button disabled={busy} type="button" className="capsule-icon-button" aria-label={`${t('my.cancelLabelAria')} ${capsuleId}`} title={t('my.cancelLabelAria')} onClick={cancel}><X size={16} /></button>
        {label && <button disabled={busy} type="button" className="capsule-icon-button capsule-icon-delete" aria-label={`${t('my.removeLabelAria')} ${capsuleId}`} title={t('my.removeLabelAria')} onClick={() => commit(onRemove)}><Trash2 size={15} /></button>}
      </form> : <>
        <h3><CapsuleTitleText text={displayName} /></h3>
        <button id={`btn-edit-local-label-${id}`} type="button" className="capsule-icon-button capsule-edit-button" aria-label={`${t('shared.editName')} ${capsuleId}`} title={t('shared.editName')}
          onClick={() => { setValue(label ?? ''); setEditing(true); setError(null); }}><Edit3 size={15} /></button>
      </>}
    </div>
    {error && <p className="capsule-label-error" role="alert">{error}</p>}
  </>;
}
