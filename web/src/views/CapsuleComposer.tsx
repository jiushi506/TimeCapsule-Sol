import React, { createContext, useContext, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, Eye, EyeOff, FileText, Flame, Lock, ShieldCheck, Sparkles, Unlock, Wallet } from 'lucide-react';
import { sha256Hex } from '../codec';
import { useLanguage } from '../context/LanguageContext';
import { useWallet } from '../context/WalletContext';
import { useSolanaWallet } from '../context/solanaWalletState';
import { useAuthSession } from '../context/useAuthSession';
import { getPasswordStrength } from '../services/passwordStrength';
import { countPublicTitleCharacters, MAX_PUBLIC_TITLE_BYTES, MAX_PUBLIC_TITLE_CHARACTERS } from '../services/publicTitle';
import { MAX_LOCAL_LABEL_CHARACTERS } from '../services/localCapsuleLabelService';
import { getPresetUnlockDate, type UnlockTimePreset } from '../utils/unlockTimePresets';
import { getRandomBytes as secureRandomBytes, uint8ArrayToBase64 } from '../codec/crypto';
const encodeBase64Url = (bytes: Uint8Array) => uint8ArrayToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
import { parseUtcInput, toUtcInput } from '../utils/dateTime';
import { LoadingText } from '../components/LoadingText';
import { DateTimeInput } from '../components/DateTimeInput';

export type CapsuleMode = 'public' | 'private';
export function newMemoryEntryPassword() {
  for (;;) {
    const secret = secureRandomBytes(32);
    try { const password = encodeBase64Url(secret); if (getPasswordStrength(password) >= 2) return password; }
    finally { secret.fill(0); }
  }
}
type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute';

export interface CapsuleComposerState {
  fixedMemory?: boolean;
  memberPasswordRequired?: boolean;
  message: string;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  mode: CapsuleMode;
  setMode: React.Dispatch<React.SetStateAction<CapsuleMode>>;
  publicTitle: string;
  setPublicTitle: React.Dispatch<React.SetStateAction<string>>;
  localLabel: string;
  setLocalLabel: React.Dispatch<React.SetStateAction<string>>;
  photo: File | null;
  setPhoto: React.Dispatch<React.SetStateAction<File | null>>;
  publicTitleLimitNotice: boolean;
  setPublicTitleLimitNotice: React.Dispatch<React.SetStateAction<boolean>>;
  localLabelLimitNotice: boolean;
  setLocalLabelLimitNotice: React.Dispatch<React.SetStateAction<boolean>>;
  password: string;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  showPassword: boolean;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  unlockDate: string;
  setUnlockDate: React.Dispatch<React.SetStateAction<string>>;
  nowMs: number;
  draftId: string | null;
  setDraftId: React.Dispatch<React.SetStateAction<string | null>>;
  draftSavedNotice: boolean;
  setDraftSavedNotice: React.Dispatch<React.SetStateAction<boolean>>;
  normalizedPublicTitle: string;
  publicTitleByteLength: number;
  publicTitleCharacterCount: number;
  localLabelCharacterCount: number;
  publicTitleExceedsCharacterLimit: boolean;
  publicTitleExceedsByteLimit: boolean;
  passwordStrength: number;
  previewHash: { input: string; hash: string } | null;
  getParsedUnlockDate: () => { year: number; month: number; day: number; hour: number; minute: number; second: number };
  getDurationFromNow: () => string;
  updateDatePart: (part: DatePart, value: number) => void;
  addYears: (years: number) => void;
  setUnlockPreset: (preset: UnlockTimePreset) => void;
}

const CapsuleComposerContext = createContext<CapsuleComposerState | null>(null);

export const toDateTimeLocalValue = toUtcInput;

export const CapsuleComposerProvider: React.FC<{ children: React.ReactNode; initialMemory?: { mode: CapsuleMode; unlockAt: number; password?: string; memberPasswordRequired?: boolean } }> = ({ children, initialMemory }) => {
  const { t } = useLanguage();
  const evmWallet = useWallet();
  const solanaWallet = useSolanaWallet();
  const auth = useAuthSession();
  const activeWalletIdentity = evmWallet.isConnected && evmWallet.address
    ? `evm:${evmWallet.chainId ?? ''}:${evmWallet.walletType}:${evmWallet.address.toLowerCase()}`
    : solanaWallet.isConnected && solanaWallet.address
      ? `solana:${solanaWallet.address}`
      : 'disconnected';
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<CapsuleMode>(initialMemory?.mode ?? 'private');
  const [publicTitle, setPublicTitle] = useState('');
  const [localLabel, setLocalLabel] = useState('');
  const [photoState, setPhotoState] = useState<{ scopeKey: string; file: File | null }>(() => ({ scopeKey: auth.scopeKey, file: null }));
  const photoScopeRef = React.useRef(auth.scopeKey);
  const photo = photoState.scopeKey === auth.scopeKey ? photoState.file : null;
  const setPhoto = React.useCallback<React.Dispatch<React.SetStateAction<File | null>>>((next) => {
    setPhotoState(current => {
      const currentValue = current.scopeKey === auth.scopeKey ? current.file : null;
      return { scopeKey: auth.scopeKey, file: typeof next === 'function' ? next(currentValue) : next };
    });
  }, [auth.scopeKey]);
  const [publicTitleLimitNotice, setPublicTitleLimitNotice] = useState(false);
  const [localLabelLimitNotice, setLocalLabelLimitNotice] = useState(false);
  const [passwordState, setPasswordState] = useState(() => {
    if (!initialMemory || initialMemory.mode !== 'private' || initialMemory.memberPasswordRequired) return { identity: activeWalletIdentity, value: '' };
    return { identity: activeWalletIdentity, value: newMemoryEntryPassword() };
  });
  if (passwordState.identity !== activeWalletIdentity) {
    setPasswordState({ identity: activeWalletIdentity, value: initialMemory?.mode === 'private' && !initialMemory.memberPasswordRequired ? newMemoryEntryPassword() : '' });
  }
  const password = passwordState.identity === activeWalletIdentity ? passwordState.value : '';
  const setPassword: React.Dispatch<React.SetStateAction<string>> = (next) => {
    setPasswordState((current) => {
      const currentValue = current.identity === activeWalletIdentity ? current.value : '';
      return { identity: activeWalletIdentity, value: typeof next === 'function' ? next(currentValue) : next };
    });
  };
  const [showPassword, setShowPassword] = useState(false);
  const [unlockDate, setUnlockDate] = useState<string>(() => {
    if (initialMemory) return toDateTimeLocalValue(new Date(initialMemory.unlockAt * 1000));
    const nextYear = getPresetUnlockDate(new Date(), '1y');
    return toUtcInput(nextYear);
  });
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSavedNotice, setDraftSavedNotice] = useState(false);
  const [previewHash, setPreviewHash] = useState<{ input: string; hash: string } | null>(null);
  const normalizedPublicTitle = publicTitle.normalize('NFC').trim();
  const publicTitleByteLength = new TextEncoder().encode(normalizedPublicTitle).length;
  const publicTitleCharacterCount = countPublicTitleCharacters(normalizedPublicTitle);
  const localLabelCharacterCount = countPublicTitleCharacters(localLabel);
  const publicTitleExceedsCharacterLimit = publicTitleCharacterCount > MAX_PUBLIC_TITLE_CHARACTERS;
  const publicTitleExceedsByteLimit = publicTitleByteLength > MAX_PUBLIC_TITLE_BYTES;
  const passwordStrength = getPasswordStrength(password);

  useEffect(() => {
    const refresh = () => setNowMs(Date.now());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  useEffect(() => {
    const previousScope = photoScopeRef.current;
    photoScopeRef.current = auth.scopeKey;
    setPhotoState(current => {
      if (current.scopeKey === auth.scopeKey) return current;
      if (previousScope.startsWith('anonymous:') && auth.status === 'authenticated' && current.scopeKey === previousScope) {
        return { ...current, scopeKey: auth.scopeKey };
      }
      return { scopeKey: auth.scopeKey, file: null };
    });
  }, [auth.scopeKey, auth.status]);

  useEffect(() => {
    if (!message) return;
    let active = true;
    const input = `${mode}:${message}`;
    void sha256Hex(new TextEncoder().encode(message + mode))
      .then((hash) => { if (active) setPreviewHash({ input, hash }); })
      .catch(() => {});
    return () => { active = false; };
  }, [message, mode]);

  const getParsedUnlockDate = () => {
    const date = parseUtcInput(unlockDate);
    const fallback = Number.isNaN(date.getTime()) ? new Date(nowMs + 365 * 86400000) : date;
    return {
      year: fallback.getUTCFullYear(),
      month: fallback.getUTCMonth() + 1,
      day: fallback.getUTCDate(),
      hour: fallback.getUTCHours(),
      minute: fallback.getUTCMinutes(),
      second: fallback.getUTCSeconds(),
    };
  };

  const getDurationFromNow = () => {
    const unlockAt = Math.floor(parseUtcInput(unlockDate).getTime() / 1000);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const diffSeconds = unlockAt - nowSeconds;
    if (!Number.isSafeInteger(unlockAt) || diffSeconds <= 0) return t('create.timePassedError');
    const days = Math.floor(diffSeconds / 86400);
    const hours = Math.floor((diffSeconds % 86400) / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    if (days >= 365) return `~${Math.floor(days / 365)} ${t('create.unitYear')} ${days % 365} ${t('create.unitDay')} ${hours} ${t('create.unitHour')}`;
    if (days > 0) return `${days} ${t('create.unitDay')} ${hours} ${t('create.unitHour')} ${minutes} ${t('create.unitMinute')}`;
    if (hours > 0) return `${hours} ${t('create.unitHour')} ${minutes} ${t('create.unitMinute')}`;
    return `${minutes} ${t('create.unitMinute')} ${diffSeconds % 60} ${t('create.unitSecond')}`;
  };

  const updateDatePart = (part: DatePart, value: number) => {
    const updated = { ...getParsedUnlockDate(), [part]: value };
    updated.day = Math.min(updated.day, new Date(Date.UTC(updated.year, updated.month, 0)).getUTCDate());
    const date = new Date(Date.UTC(updated.year, updated.month - 1, updated.day, updated.hour, updated.minute, updated.second));
    setUnlockDate(toDateTimeLocalValue(date));
  };

  const setUnlockPreset = (preset: UnlockTimePreset) => {
    const date = getPresetUnlockDate(new Date(), preset);
    setUnlockDate(toDateTimeLocalValue(date));
  };

  const value: CapsuleComposerState = {
    fixedMemory: Boolean(initialMemory), memberPasswordRequired: initialMemory?.memberPasswordRequired,
    message, setMessage, mode, setMode, publicTitle, setPublicTitle, localLabel, setLocalLabel, photo, setPhoto,
    publicTitleLimitNotice, setPublicTitleLimitNotice, localLabelLimitNotice, setLocalLabelLimitNotice,
    password, setPassword, showPassword, setShowPassword, unlockDate, setUnlockDate, nowMs,
    draftId, setDraftId, draftSavedNotice, setDraftSavedNotice, normalizedPublicTitle,
    publicTitleByteLength, publicTitleCharacterCount, localLabelCharacterCount,
    publicTitleExceedsCharacterLimit, publicTitleExceedsByteLimit, passwordStrength, previewHash,
    getParsedUnlockDate, getDurationFromNow, updateDatePart,
    addYears: (years) => updateDatePart('year', getParsedUnlockDate().year + years), setUnlockPreset,
  };

  return <CapsuleComposerContext.Provider value={value}>{children}</CapsuleComposerContext.Provider>;
};

export function useCapsuleComposer(): CapsuleComposerState {
  const state = useContext(CapsuleComposerContext);
  if (!state) throw new Error('Capsule composer must be used within CapsuleComposerProvider.');
  return state;
}

export function useOptionalCapsuleComposer(): CapsuleComposerState | null {
  return useContext(CapsuleComposerContext);
}

export function limitComposerCharacters(previousValue: string, nextValue: string, maximum: number): { value: string; exceeded: boolean } {
  const previous = Array.from(previousValue).slice(0, maximum);
  const next = Array.from(nextValue);
  if (next.length <= maximum) return { value: nextValue, exceeded: false };
  let prefixLength = 0;
  while (prefixLength < previous.length && prefixLength < next.length && previous[prefixLength] === next[prefixLength]) prefixLength += 1;
  let suffixLength = 0;
  while (suffixLength < previous.length - prefixLength && suffixLength < next.length - prefixLength && previous[previous.length - 1 - suffixLength] === next[next.length - 1 - suffixLength]) suffixLength += 1;
  const inserted = next.slice(prefixLength, next.length - suffixLength);
  const available = Math.max(0, maximum - prefixLength - suffixLength);
  return {
    value: [...previous.slice(0, prefixLength), ...inserted.slice(0, available), ...(suffixLength ? previous.slice(-suffixLength) : [])].join(''),
    exceeded: true,
  };
}

export interface CapsuleComposerValidationOptions {
  mode: CapsuleMode;
  message: string;
  publicTitle: string;
  publicTitleCharacterCount: number;
  publicTitleByteLength: number;
  localLabelCharacterCount: number;
  password: string;
  passwordStrength: number;
  unlockDate: string;
  minimumFutureSeconds: number;
  maxTitleCharacters?: number;
  maxTitleBytes?: number;
  idPrefix: string;
  texts: {
    emptyMessage: string;
    publicTitleRequired: string;
    publicTitleIs: string;
    unicodeCharacters: string;
    limitIs: string;
    bytes: string;
    maximumIs: string;
    localTitleMax: string;
    charactersOrFewer: string;
    passwordLength: string;
    validTime: string;
  };
}

export function validateCapsuleComposer(options: CapsuleComposerValidationOptions): { message: string; focusId: string } | null {
  const fieldIds: Record<string, Record<string, string>> = {
    input: {
      message: 'input-capsule-message', publicTitle: 'input-public-title', localLabel: 'input-local-label',
      password: 'input-capsule-password', unlockDate: 'input-unlock-datetime',
    },
    solana: {
      message: 'solana-message', publicTitle: 'solana-public-title', localLabel: 'solana-private-label',
      password: 'solana-password', unlockDate: 'solana-unlock',
    },
  };
  const id = (field: string) => fieldIds[options.idPrefix]?.[field] ?? `${options.idPrefix}-${field}`;
  const maxTitleCharacters = options.maxTitleCharacters ?? MAX_PUBLIC_TITLE_CHARACTERS;
  const maxTitleBytes = options.maxTitleBytes ?? MAX_PUBLIC_TITLE_BYTES;
  if (!options.message.trim()) return { message: options.texts.emptyMessage, focusId: id('message') };
  if (options.mode === 'public') {
    if (!options.publicTitle) return { message: options.texts.publicTitleRequired, focusId: id('publicTitle') };
    if (options.publicTitleCharacterCount > maxTitleCharacters) {
      return { message: `${options.texts.publicTitleIs} ${options.publicTitleCharacterCount} ${options.texts.unicodeCharacters}; ${options.texts.limitIs} ${maxTitleCharacters}.`, focusId: id('publicTitle') };
    }
    if (options.publicTitleByteLength > maxTitleBytes) {
      return { message: `${options.texts.publicTitleIs} ${options.publicTitleByteLength} UTF-8 ${options.texts.bytes}; ${options.texts.maximumIs} ${maxTitleBytes} UTF-8 ${options.texts.bytes}.`, focusId: id('publicTitle') };
    }
  }
  if (options.mode === 'private' && options.localLabelCharacterCount > MAX_LOCAL_LABEL_CHARACTERS) {
    return { message: `${options.texts.localTitleMax} ${MAX_LOCAL_LABEL_CHARACTERS} ${options.texts.charactersOrFewer}`, focusId: id('localLabel') };
  }
  if (options.mode === 'private' && (!options.password || options.password.length < 12 || options.passwordStrength < 2)) {
    return { message: options.texts.passwordLength, focusId: id('password') };
  }
  const unlockAt = Math.floor(parseUtcInput(options.unlockDate).getTime() / 1000);
  if (!Number.isSafeInteger(unlockAt) || unlockAt <= Math.floor(Date.now() / 1000) + options.minimumFutureSeconds) {
    return { message: options.texts.validTime, focusId: id('unlockDate') };
  }
  return null;
}

interface CapsuleComposerFieldsProps {
  composer: CapsuleComposerState;
  idPrefix: 'input' | 'solana';
  publicTitleDisclosure?: React.ReactNode;
  publicTitleMetadata?: React.ReactNode;
  passwordDisclosure?: React.ReactNode;
  titleMaxCharacters?: number;
  messageAddon?: React.ReactNode;
  privateTitleStorage?: 'local' | 'account';
  disabled?: boolean;
}

export const CapsuleComposerFields: React.FC<CapsuleComposerFieldsProps> = ({
  composer,
  idPrefix,
  publicTitleDisclosure,
  publicTitleMetadata,
  passwordDisclosure,
  titleMaxCharacters = MAX_PUBLIC_TITLE_CHARACTERS,
  messageAddon,
  privateTitleStorage = 'local',
  disabled = false,
}) => {
  const { t } = useLanguage();
  const {
    message, setMessage, mode, setMode, publicTitle, setPublicTitle, localLabel, setLocalLabel,
    publicTitleLimitNotice, setPublicTitleLimitNotice, localLabelLimitNotice, setLocalLabelLimitNotice,
    password, setPassword, showPassword, setShowPassword, unlockDate, setUnlockDate, nowMs,
    publicTitleByteLength, publicTitleCharacterCount, localLabelCharacterCount,
    publicTitleExceedsCharacterLimit, publicTitleExceedsByteLimit, passwordStrength,
    getParsedUnlockDate, getDurationFromNow, updateDatePart, addYears, setUnlockPreset,
  } = composer;
  const privateModeId = idPrefix === 'input' ? 'mode-toggle-private' : 'solana-mode-private';
  const publicModeId = idPrefix === 'input' ? 'mode-toggle-public' : 'solana-mode-public';
  const publicTitleId = `${idPrefix}-public-title`;
  const localLabelId = idPrefix === 'input' ? 'input-local-label' : 'solana-private-label';
  const messageId = idPrefix === 'input' ? 'input-capsule-message' : 'solana-message';
  const passwordId = idPrefix === 'input' ? 'input-capsule-password' : 'solana-password';
  const unlockId = idPrefix === 'input' ? 'input-unlock-datetime' : 'solana-unlock';
  const datePartIds: Record<DatePart, string> = idPrefix === 'input'
    ? { year: 'select-custom-year', month: 'select-custom-month', day: 'select-custom-day', hour: 'select-custom-hour', minute: 'select-custom-minute' }
    : { year: 'solana-year', month: 'solana-month', day: 'solana-day', hour: 'solana-hour', minute: 'solana-minute' };
  const preset90sId = idPrefix === 'input' ? 'preset-btn-90s' : 'solana-preset-90s';
  const strengthLabels = ['Too Weak', 'Weak', 'Fair', 'Strong', 'Very strong'];
  const strengthColors = ['#f43f5e', '#fb7185', '#f59e0b', '#38bdf8', '#10b981'];
  const parsed = getParsedUnlockDate();
  const daysInMonth = new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate();
  const currentYear = new Date(nowMs).getUTCFullYear();
  const yearOptions = Array.from({ length: 60 }, (_, index) => currentYear + index);
  const monthOptions = Array.from({ length: 12 }, (_, index) => index + 1);
  const dayOptions = Array.from({ length: daysInMonth }, (_, index) => index + 1);
  const hourOptions = Array.from({ length: 24 }, (_, index) => index);
  const minuteOptions = Array.from({ length: 60 }, (_, index) => index);

  const setLimitedText = (field: 'public' | 'local', value: string) => {
    if (field === 'public') {
      const limited = limitComposerCharacters(publicTitle, value, titleMaxCharacters);
      setPublicTitle(limited.value);
      setPublicTitleLimitNotice(limited.exceeded);
    } else {
      const limited = limitComposerCharacters(localLabel, value, MAX_LOCAL_LABEL_CHARACTERS);
      setLocalLabel(limited.value);
      setLocalLabelLimitNotice(limited.exceeded);
    }
  };

  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <>
      <div hidden={composer.fixedMemory} style={{ marginBottom: 28 }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '.95rem', marginBottom: 12 }}>{t('create.step2')}</label>
        <div className="capsule-mode-grid" role="radiogroup" aria-label={t('create.step2')}>
          <div id={privateModeId} role="radio" aria-checked={mode === 'private'} aria-disabled={disabled} tabIndex={mode === 'private' ? 0 : -1} onClick={() => { if (!disabled) setMode('private'); }} onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setMode('private'); } }} style={{ padding: '16px 18px', borderRadius: 'var(--radius-md)', background: mode === 'private' ? 'rgba(168, 85, 247, .12)' : 'rgba(255,255,255,.02)', border: mode === 'private' ? '1px solid rgba(168,85,247,.5)' : '1px solid var(--border-subtle)', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all .2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><Lock size={18} color="#c084fc" /><span style={{ fontWeight: 700, fontSize: '.95rem', color: mode === 'private' ? '#c084fc' : 'var(--text-main)' }}>{t('create.privateTitle')}</span><span className="badge badge-purple" style={{ fontSize: '.65rem' }}>{t('create.protected')}</span></div>
            <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{t('create.privateDesc')}</p>
          </div>
          <div id={publicModeId} role="radio" aria-checked={mode === 'public'} aria-disabled={disabled} tabIndex={mode === 'public' ? 0 : -1} onClick={() => { if (!disabled) setMode('public'); }} onKeyDown={(event) => { if (!disabled && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setMode('public'); } }} style={{ padding: '16px 18px', borderRadius: 'var(--radius-md)', background: mode === 'public' ? 'rgba(0,240,255,.12)' : 'rgba(255,255,255,.02)', border: mode === 'public' ? '1px solid rgba(0,240,255,.5)' : '1px solid var(--border-subtle)', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all .2s' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}><Unlock size={18} color="#00f0ff" /><span style={{ fontWeight: 700, fontSize: '.95rem', color: mode === 'public' ? '#00f0ff' : 'var(--text-main)' }}>{t('create.publicTitle')}</span><span className="badge badge-cyan" style={{ fontSize: '.65rem' }}>{t('create.open')}</span></div>
            <p style={{ fontSize: '.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{t('create.publicDesc')}</p>
          </div>
        </div>
      </div>

      {mode === 'public' ? (
        <div style={{ marginBottom: 28, padding: 20, borderRadius: 'var(--radius-md)', background: 'rgba(0,240,255,.05)', border: '1px solid rgba(0,240,255,.25)' }}>
          <label htmlFor={publicTitleId} style={{ display: 'block', fontWeight: 700, fontSize: '.95rem', marginBottom: 8 }}>{t('create.publicTitleRequiredLabel')}</label>
          <input id={publicTitleId} value={publicTitle} onChange={(event) => setLimitedText('public', event.target.value)} aria-describedby={`${idPrefix}-title-disclosure ${idPrefix}-title-count`} placeholder={t('create.publicTitlePlaceholder')} style={{ marginBottom: 8 }} />
          <p id={`${idPrefix}-title-disclosure`} style={{ color: 'var(--text-muted)', fontSize: '.79rem', lineHeight: 1.5, margin: '0 0 6px' }}>{publicTitleDisclosure ?? t('create.publicTitleDisclosure')}</p>
          <div id={`${idPrefix}-title-count`} aria-live="polite" style={{ color: publicTitleLimitNotice || publicTitleExceedsCharacterLimit || publicTitleExceedsByteLimit ? '#fb7185' : 'var(--text-dim)', fontSize: '.74rem', lineHeight: 1.5, marginBottom: publicTitleMetadata ? 8 : 0 }}>
            {publicTitleCharacterCount}/{titleMaxCharacters} {t('create.characters')} · {publicTitleByteLength} UTF-8 {t('create.bytes')} · {t('create.titleImmutable')}
            {publicTitleLimitNotice && <span role="status"> · {t('create.titleLimitReached')}</span>}
          </div>
          {publicTitleMetadata}
        </div>
      ) : (
        <div style={{ marginBottom: 28, padding: 20, borderRadius: 'var(--radius-md)', background: 'rgba(168,85,247,.05)', border: '1px solid rgba(168,85,247,.22)' }}>
          <label htmlFor={localLabelId} style={{ display: 'block', fontWeight: 700, fontSize: '.92rem', marginBottom: 8, color: '#c084fc' }}>{t(privateTitleStorage === 'account' ? 'memory.titleOptional' : 'create.privateTitleOptionalLabel')}</label>
          <input id={localLabelId} value={localLabel} onChange={(event) => setLimitedText('local', event.target.value)} aria-describedby={`${idPrefix}-local-count ${idPrefix}-local-disclosure`} placeholder={t(privateTitleStorage === 'account' ? 'memory.titlePlaceholder' : 'create.privateTitlePlaceholder')} />
          <div id={`${idPrefix}-local-count`} aria-live="polite" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6, fontSize: '.74rem', lineHeight: 1.5, color: localLabelLimitNotice ? '#fb7185' : 'var(--text-dim)' }}>{localLabelCharacterCount}/{MAX_LOCAL_LABEL_CHARACTERS} {t('create.characters')}</div>
          {localLabelLimitNotice && <div role="status" style={{ marginTop: 2, textAlign: 'right', color: '#fb7185', fontSize: '.74rem' }}>{t('create.titleLimitReached')}</div>}
          <p id={`${idPrefix}-local-disclosure`} style={{ color: 'var(--text-muted)', fontSize: '.78rem', lineHeight: 1.5, margin: '8px 0 0' }}>{t(privateTitleStorage === 'account' ? 'memory.titleSyncedNote' : 'create.privateTitleLocalOnly')}</p>
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label htmlFor={messageId} style={{ fontWeight: 600, fontSize: '.95rem' }}>{t('create.step1')}</label>
          <span style={{ fontSize: '.78rem', color: 'var(--text-dim)' }}>{message.length} {t('create.chars')} • {t('create.encryptedWith')}</span>
        </div>
        <textarea id={messageId} rows={5} placeholder={t('create.placeholder')} value={message} onChange={(event) => setMessage(event.target.value)} style={{ resize: 'vertical' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: '.76rem', color: 'var(--text-muted)' }}><ShieldCheck size={14} color="#00f0ff" />{t('create.plainNotice')}</div>
      </div>

      {messageAddon}

      {mode === 'private' && (!composer.fixedMemory || composer.memberPasswordRequired) && (
        <div style={{ background: 'rgba(168,85,247,.06)', border: '1px solid rgba(168,85,247,.25)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <label htmlFor={passwordId} style={{ fontWeight: 600, fontSize: '.92rem', color: '#c084fc' }}>{t(composer.memberPasswordRequired ? 'shared.joinPassword' : 'create.passLabel')}</label>
            {password && <span style={{ fontSize: '.78rem', color: strengthColors[passwordStrength], fontWeight: 600 }}>{t('create.strength')}: {strengthLabels[passwordStrength]}</span>}
          </div>
          <div style={{ position: 'relative' }}>
            <input id={passwordId} type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder={t('create.passPlaceholder')} value={password} onChange={(event) => setPassword(event.target.value)} style={{ paddingRight: 42 }} />
            <button type="button" aria-label={showPassword ? t('create.hidePassword') : t('create.showPassword')} onClick={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </div>
          {password && <div aria-hidden="true" style={{ display: 'flex', gap: 4, marginTop: 8, height: 4 }}>{[0, 1, 2, 3].map((step) => <div key={step} style={{ flex: 1, borderRadius: 2, background: step < passwordStrength ? strengthColors[passwordStrength] : 'rgba(255,255,255,.1)' }} />)}</div>}
          {passwordDisclosure}
          <div style={{ marginTop: 10, fontSize: '.78rem', color: '#fbbf24', display: 'flex', gap: 6, alignItems: 'flex-start' }}><AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} /><div><strong>{t('create.passWarning')}</strong> {t('create.permRule')}</div></div>
        </div>
      )}

      <div hidden={composer.fixedMemory} style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <label style={{ fontWeight: 600, fontSize: '.98rem', display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={16} color="var(--cyan-primary)" />{t('create.step3')}</label>
          <span className="badge badge-cyan" style={{ fontSize: '.72rem' }}>{t('create.dateSectionBadge')}</span>
        </div>
        <div style={{ background: 'rgba(0,240,255,.04)', border: '1px solid rgba(0,240,255,.25)', borderRadius: 'var(--radius-md)', padding: '20px 22px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingBottom: 16, marginBottom: 18, borderBottom: '1px solid rgba(255,255,255,.08)' }}>
            <div><div style={{ fontSize: '.76rem', color: 'var(--text-dim)', marginBottom: 2 }}>{t('create.targetSummaryLabel')}</div><div className="font-display" style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>{`${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')} `}<span style={{ color: 'var(--cyan-primary)' }}>{String(parsed.hour).padStart(2, '0')}:{String(parsed.minute).padStart(2, '0')}:{String(parsed.second).padStart(2, '0')} UTC</span></div></div>
            <div style={{ background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.35)', borderRadius: 'var(--radius-full)', padding: '6px 14px', fontSize: '.82rem', color: '#34d399', fontWeight: 700 }}>⏳ {getDurationFromNow()}</div>
          </div>
          <label htmlFor={unlockId} style={{ display: 'block', fontSize: '.82rem', color: 'var(--text-muted)', marginBottom: 6 }}>{t('create.chooseUnlockDateTime')} (UTC)</label>
          <DateTimeInput disabled={composer.fixedMemory} id={unlockId} step={1} value={unlockDate} onChange={(event) => setUnlockDate(event.target.value)} style={{ maxWidth: 280, marginBottom: 16 }} />
          <details hidden={composer.fixedMemory} style={{ borderTop: '1px solid rgba(255,255,255,.08)', paddingTop: 12 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--cyan-primary)', fontWeight: 600, fontSize: '.82rem' }}>{t('create.fineTuneTime')}</summary>
            <div style={{ marginTop: 14, marginBottom: 16 }}>
              <div style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>{t('create.preciseAdjust')}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
                {[
                  { part: 'year' as const, label: 'selectYear', values: yearOptions, format: (value: number) => `${value} ${t('create.unitYear')}` },
                  { part: 'month' as const, label: 'selectMonth', values: monthOptions, format: (value: number) => `${value} ${t('create.unitMonth')}` },
                  { part: 'day' as const, label: 'selectDay', values: dayOptions, format: (value: number) => `${value} ${t('create.unitDay')}` },
                  { part: 'hour' as const, label: 'selectHour', values: hourOptions, format: (value: number) => `${String(value).padStart(2, '0')}:00` },
                  { part: 'minute' as const, label: 'selectMinute', values: minuteOptions, format: (value: number) => `${String(value).padStart(2, '0')} ${t('create.unitMinute')}` },
                ].map(({ part, label, values, format }) => {
                  const id = datePartIds[part];
                  return <div key={part}><label htmlFor={id} style={{ display: 'block', fontSize: '.72rem', color: 'var(--text-dim)', marginBottom: 4 }}>{t(`create.${label}`)}</label><select id={id} value={parsed[part]} onChange={(event) => updateDatePart(part, Number(event.target.value))} style={{ padding: '8px 10px', fontSize: '.88rem', fontWeight: 600 }}>{values.map((value) => <option key={value} value={value}>{format(value)}</option>)}</select></div>;
                })}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px dashed rgba(255,255,255,.08)' }}><span style={{ fontSize: '.76rem', color: 'var(--text-dim)' }}>{t('create.yearSteps')}</span>{[1, 5, 10, 20].map((years) => <button key={years} type="button" onClick={() => addYears(years)} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '.75rem', ...(years === 20 ? { color: 'var(--cyan-primary)' } : {}) }}>+{years} {t('create.unitYear')}</button>)}</div>
          </details>
        </div>
        <div hidden={composer.fixedMemory}><div style={{ fontSize: '.78rem', color: 'var(--text-dim)', marginBottom: 8 }}>{t('create.presetsLabel')}</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" id={preset90sId} onClick={() => setUnlockPreset('90s')} style={{ background: 'rgba(245,158,11,.15)', border: '1px solid rgba(245,158,11,.4)', color: '#fbbf24', padding: '6px 12px', borderRadius: 'var(--radius-sm)', fontSize: '.78rem', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><Flame size={12} />{t('create.preset90s')}</button>
          {([['preset1h', '1h'], ['preset1m', '1m'], ['preset1y', '1y'], ['preset5y', '5y'], ['preset10y', '10y'], ['preset20y', '20y']] as const).map(([key, preset]) => <button key={key} type="button" onClick={() => setUnlockPreset(preset)} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '.78rem', ...(key === 'preset20y' ? { color: 'var(--cyan-primary)', borderColor: 'rgba(0,240,255,.3)' } : {}) }}>{t(`create.${key}`)}</button>)}
        </div></div>
      </div>
    </>
    </fieldset>
  );
};

interface CapsuleComposerFormProps extends CapsuleComposerFieldsProps {
  onSubmit: React.FormEventHandler<HTMLFormElement>;
  error: string | null;
  errorDetails?: React.ReactNode;
  errorRef?: React.RefObject<HTMLDivElement | null>;
  connected: boolean;
  isConnecting?: boolean;
  onConnectWallet: () => void;
  isSubmitting: boolean;
  submittingLabel: string;
  submitButtonId: string;
  saveDraftButtonId?: string;
  submitDisabled?: boolean;
  onSaveDraft: () => void;
  draftSavedNotice: boolean;
  networkSummary: React.ReactNode;
  feeSummary: React.ReactNode;
  children?: React.ReactNode;
  submitLabel?: string;
  draftDisclosure?: React.ReactNode;
}

export const CapsuleComposerHeader: React.FC<{ title: string; subtitle: string; formatLabel?: string }> = ({ title, subtitle, formatLabel }) => {
  const { t } = useLanguage();
  return (
    <div style={{ textAlign: 'center', marginBottom: 36 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <span className="badge badge-cyan">{t('create.badgeCreator')}</span>
        <span className="badge badge-purple">{formatLabel ?? t('create.badgeFormat')}</span>
      </div>
      <h1 style={{ fontSize: '2.4rem', fontWeight: 800 }}>{title}</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '.95rem', maxWidth: 540, margin: '8px auto 0' }}>{subtitle}</p>
    </div>
  );
};

export const CapsuleComposerForm: React.FC<CapsuleComposerFormProps> = ({
  composer,
  idPrefix,
  publicTitleDisclosure,
  publicTitleMetadata,
  passwordDisclosure,
  titleMaxCharacters,
  messageAddon,
  privateTitleStorage,
  onSubmit,
  error,
  errorDetails,
  errorRef,
  connected,
  isConnecting = false,
  onConnectWallet,
  isSubmitting,
  submittingLabel,
  submitButtonId,
  saveDraftButtonId,
  submitDisabled = false,
  onSaveDraft,
  draftSavedNotice,
  networkSummary,
  feeSummary,
  children,
  submitLabel,
  draftDisclosure,
}) => {
  const { t } = useLanguage();
  const currentHash = composer.message && composer.previewHash?.input === `${composer.mode}:${composer.message}` ? composer.previewHash.hash : '0x...';
  return (
    <form noValidate onSubmit={onSubmit} className="glass-panel create-form" style={{ padding: '36px 32px' }}>
      {error && <div ref={errorRef} role="alert" tabIndex={-1} style={{ background: 'rgba(244,63,94,.12)', border: '1px solid rgba(244,63,94,.3)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: 24, fontSize: '.88rem', color: '#fb7185', display: 'flex', alignItems: 'flex-start', gap: 10 }}><AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 3 }} /><div style={{ flex: 1, minWidth: 0 }}>{errorDetails ?? error}</div></div>}
      <CapsuleComposerFields composer={composer} idPrefix={idPrefix} publicTitleDisclosure={publicTitleDisclosure} publicTitleMetadata={publicTitleMetadata} passwordDisclosure={passwordDisclosure} titleMaxCharacters={titleMaxCharacters} messageAddon={messageAddon} privateTitleStorage={privateTitleStorage} disabled={isSubmitting} />
      {children}
      <div style={{ background: 'rgba(255,255,255,.02)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: 20, marginBottom: 32 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
          <div><div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{t('create.shaPreview')}</div><div className="font-mono" style={{ fontSize: '.78rem', color: 'var(--cyan-primary)', wordBreak: 'break-all', marginTop: 2 }}>{`${currentHash.substring(0, 18)}...${currentHash.substring(currentHash.length - 8)}`}</div></div>
          <div><div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{t('create.network')}</div><div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text-main)', marginTop: 2 }}>{networkSummary}</div></div>
          <div><div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{t('create.fee')}</div><div style={{ fontSize: '.88rem', fontWeight: 700, color: '#fbbf24', marginTop: 2 }}>{feeSummary}</div></div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          style={{
            background: 'rgba(244,63,94,.12)',
            border: '1px solid rgba(244,63,94,.3)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 20,
            fontSize: '.88rem',
            color: '#fb7185',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <AlertTriangle size={18} style={{ flexShrink: 0 }} />
          <div style={{ flex: 1 }}>{error}</div>
        </div>
      )}
      {connected ? (
        <button type="submit" id={submitButtonId} className="btn-primary" disabled={isSubmitting || submitDisabled} aria-busy={isSubmitting} style={{ width: '100%', padding: 16, fontSize: '1.05rem', gap: 10 }}>
          {isSubmitting ? <><Sparkles size={20} className="animate-spin-slow" /><LoadingText>{submittingLabel}</LoadingText></> : <><Lock size={20} /><span>{submitLabel ?? t('create.btnSeal')}</span></>}
        </button>
      ) : (
        <button type="button" id={`${idPrefix}-connect-wallet`} className="btn-primary" onClick={onConnectWallet} disabled={isConnecting} style={{ width: '100%', padding: 16, fontSize: '1.05rem', gap: 10 }}><Wallet size={20} />{isConnecting ? 'Connecting wallet…' : t('create.btnConnect')}</button>
      )}
      <div hidden={composer.fixedMemory} style={{ marginTop: 12 }}>
        <button type="button" id={saveDraftButtonId ?? `${idPrefix}-save-draft`} onClick={onSaveDraft} className="btn-secondary" style={{ width: '100%', padding: 12, fontSize: '.92rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1px dashed var(--border-subtle)' }}><FileText size={16} />{composer.draftId ? t('create.btnUpdateDraft') : t('create.btnSaveDraft')}</button>
        <p style={{ margin: '8px 2px 0', color: 'var(--text-dim)', fontSize: '.75rem', lineHeight: 1.5 }}>{draftDisclosure ?? 'Draft text is stored unencrypted in this browser\'s local storage. The private passphrase is never included in a draft.'}</p>
      </div>
      {draftSavedNotice && <div role="status" style={{ background: 'rgba(16,185,129,.15)', border: '1px solid #10b981', borderRadius: 'var(--radius-md)', padding: '12px 16px', marginTop: 12, fontSize: '.85rem', color: '#34d399', display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle size={16} />{t('create.draftSavedNotice')}</div>}
    </form>
  );
};
