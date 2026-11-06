import { CapsuleNameEditor } from "../components/CapsuleNameEditor";
import {
  getCapsuleLabel,
  saveCapsuleLabel,
} from "../services/localCapsuleLabelService";
import {
  finishLocalSolanaPublication,
  type LocalPublicationContext,
  type LocalPublicationResult,
} from "../services/localSolanaPublication";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Lock,
  Search,
  Sparkles,
  Unlock,
  Wallet,
} from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import { useSolanaWallet } from "../context/solanaWalletState";
import { useAuthLocalScope } from "../context/useAuthLocalScope";
import {
  CapsuleComposerForm,
  CapsuleComposerHeader,
  useCapsuleComposer,
} from "./CapsuleComposer";
import {
  PublicCapsuleCard,
  PublicCapsuleReadModal,
  ExplorerHeader,
  ExplorerToolbar,
  ExplorerReadStatus,
  type ExplorerFilter,
} from "../components/PublicCapsuleExplorer";
import {
  PortfolioHeader,
  WalletIdentityBanner,
  CapsuleEmptyState,
} from "../components/CapsulePageLayout";
import { PortfolioTabs } from "../components/PortfolioTabs";
import { PortfolioDrafts } from "../components/PortfolioDrafts";
import { PortfolioCapsuleCard } from "../components/PortfolioCapsuleCard";
import { CapsuleInspectionModal } from "../components/CapsuleInspectionModal";
import { WalletSignInPanel } from "../components/WalletSignIn";
import {
  RecoveryHeader,
  RecoveryScanner,
  RecoveryMethodTabs,
  RecoveryCardUpload,
  RecoveryResults,
  RecoveryResultItem,
  RecoveryDecryptionPanel,
  type RecoveryMethod,
} from "../components/RecoveryWorkspace";
import { SealConfirmationModal } from "../components/SealConfirmationModal";
import { WalletReviewDialog } from "../components/WalletReviewDialog";
import { SolanaProtocolFeePanel } from "../components/SolanaProtocolFeePanel";
import { NotificationModal } from "../components/NotificationModal";
import { SharePosterModal } from "../components/SharePosterModal";
import { SolanaCapsuleSuccessModal } from "../components/SolanaCapsuleSuccessModal";
import { LoadingText } from "../components/LoadingText";
import { parseUtcInput } from "../utils/dateTime";
import {
  getLocalDrafts,
  saveLocalDraft,
  getActiveLocalDraftId,
} from "../services/draftService";
import { sealCapsulePayload, type EncryptedCapsuleResult } from "../codec";
import { getPhantomSolanaProvider } from "../context/solanaWalletUtils";
import {
  fetchSolanaCapsule,
  fetchSolanaCapsulesByOwner,
  fetchSolanaPublicCapsules,
  decryptSolanaCapsule,
  createSolanaSealQuote,
  fetchSolanaProtocolFee,
  submitSolanaCapsule,
  exportSolanaRecoveryCard,
  getPendingSolanaUpload,
  clearPendingSolanaUpload,
  decodeSolanaUploadDraftPayload,
  reconcileCompletedSolanaUpload,
  cancelSolanaUpload,
  formatSolanaError,
  formatLamports,
  SOLANA_PROGRAM_ID,
  type SolanaCapsuleRecord,
  type SolanaRecoveryCard,
  type SolanaSealQuote,
  type SolanaUploadDraft,
} from "../services/solanaCapsuleService";
import type { SolanaProtocolFeeReview } from "../services/solanaProtocolFee";

type Navigate = (
  tab: string,
  params?: Record<string, string | number | undefined>,
) => void;
const explorer = (pda: string) =>
  `https://explorer.solana.com/address/${encodeURIComponent(pda)}?cluster=devnet`;
const name = (record: SolanaCapsuleRecord) =>
  record.publicTitle || `Capsule #${record.capsuleId}`;
const errorMessage = (error: unknown) =>
  formatSolanaError(error, "The Solana request could not be completed.");
function saveCard(card: SolanaRecoveryCard) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `timecapsule-${card.capsuleId}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function useClock() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  return now;
}
function Alert({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="capsule-inline-error"
      style={{ marginBottom: 20 }}
    >
      {children}
    </div>
  );
}

export function CreateView({
  onOpenWallet,
  onNavigate,
}: {
  onOpenWallet: () => void;
  onNavigate: Navigate;
}) {
  const { t } = useLanguage();
  const wallet = useSolanaWallet();
  const composer = useCapsuleComposer();
  const scope = useAuthLocalScope();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [payload, setPayload] = useState<EncryptedCapsuleResult | null>(null);
  const [quote, setQuote] = useState<SolanaSealQuote | null>(null);
  const [reviewOwner, setReviewOwner] = useState("");
  const [fee, setFee] = useState<SolanaProtocolFeeReview | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeRefresh, setFeeRefresh] = useState(0);
  const [pending, setPending] = useState<SolanaUploadDraft | null>(() =>
    getPendingSolanaUpload(),
  );
  const [success, setSuccess] = useState<({
    card: SolanaRecoveryCard;
    publicTitle: string;
    protocolFeePaidLamports?: bigint;
  } & LocalPublicationResult) | null>(null);
  const localReview = useRef<LocalPublicationContext | null>(null);
  const ownerRef = useRef(wallet.address);
  ownerRef.current = wallet.address;
  useEffect(() => {
    let active = true;
    setFeeLoading(true);
    fetchSolanaProtocolFee()
      .then((v) => {
        if (active) {
          setFee(v);
          setFeeError(null);
        }
      })
      .catch((e) => {
        if (active) setFeeError(errorMessage(e));
      })
      .finally(() => {
        if (active) setFeeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [feeRefresh]);
  useEffect(() => {
    ownerRef.current = wallet.address;
    setQuote(null);
    setPayload(null);
    setConfirm(false);
    setSuccess(null);
    localReview.current = null;
    setPending(getPendingSolanaUpload());
    return () => {
      ownerRef.current = null;
    };
  }, [wallet.address]);
  useEffect(() => {
    const id = getActiveLocalDraftId(scope.key);
    const draft = getLocalDrafts(scope.key).find((v) => v.id === id);
    if (draft) {
      composer.setMessage(draft.message);
      composer.setMode(draft.mode);
      composer.setPublicTitle(draft.publicTitle);
      composer.setLocalLabel(draft.localLabel);
      composer.setUnlockDate(draft.unlockDate);
      composer.setDraftId(draft.id);
    }
  }, [scope.key]);
  async function run(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
      setStatus("");
    } finally {
      lock.current = false;
      setBusy(false);
      setPending(getPendingSolanaUpload());
    }
  }
  function validate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!wallet.address) {
      onOpenWallet();
      return;
    }
    if (pending) {
      setError(
        "Resume or cancel the unfinished encrypted upload before starting another.",
      );
      return;
    }
    if (!composer.message.trim()) {
      setError(t("create.errorEmptyMessage"));
      return;
    }
    if (
      composer.mode === "public" &&
      (!composer.normalizedPublicTitle ||
        composer.publicTitleByteLength > 2048 ||
        composer.publicTitleCharacterCount > 512)
    ) {
      setError(
        "A public title must contain 1–512 characters and at most 2,048 UTF-8 bytes.",
      );
      return;
    }
    if (
      composer.mode === "private" &&
      (composer.password.length < 12 || composer.passwordStrength < 2)
    ) {
      setError("Use a strong private passphrase of at least 12 characters.");
      return;
    }
    if (new TextEncoder().encode(composer.message).length > 8192) {
      setError(
        "Shorten this text: encrypted content plus public title must fit within 8,192 bytes.",
      );
      return;
    }
    if (parseUtcInput(composer.unlockDate).getTime() < Date.now() + 60000) {
      setError(
        "Choose a future time that leaves enough time for wallet confirmation and upload.",
      );
      return;
    }
    setConfirm(true);
  }
  function prepare() {
    setConfirm(false);
    void run(async () => {
      const owner = wallet.address!;
      const mode = composer.mode;
      const publicTitle = composer.normalizedPublicTitle;
      const localLabel = composer.localLabel;
      const draftId = composer.draftId;
      setStatus("Encrypting this text in your browser…");
      const sealed = await sealCapsulePayload({
        message: composer.message,
        mode,
        password: mode === "private" ? composer.password : undefined,
        unlockAt: Math.floor(
          parseUtcInput(composer.unlockDate).getTime() / 1000,
        ),
      });
      const next = await createSolanaSealQuote({
        owner,
        payloadBytes: sealed.payloadBytes,
        mode,
        publicTitle,
        unlockAt: sealed.unlockAt,
      });
      if (ownerRef.current !== owner)
        throw new Error("The wallet changed. Prepare a new review.");
      localReview.current = {
        owner,
        payloadHash: sealed.payloadHash,
        localLabel,
        draftId,
      };
      setPayload(sealed);
      setReviewOwner(owner);
      setQuote(next);
      setStatus("");
    });
  }
  function finishUpload(result: {
    record: SolanaCapsuleRecord;
    card: SolanaRecoveryCard;
    protocolFeePaidLamports?: bigint;
  }) {
    if (ownerRef.current !== result.record.owner)
      throw new Error(
        "The wallet or page changed. Reconnect the original account and resume to recover its confirmed capsule.",
      );
    const context = localReview.current;
    let localResult: LocalPublicationResult = {};
    if (
      context?.owner === result.record.owner &&
      context.payloadHash === result.record.payloadHash
    ) {
      localResult = finishLocalSolanaPublication(result.record, context);
      composer.setMessage("");
      composer.setPassword("");
      composer.setLocalLabel("");
      composer.setDraftId(null);
      composer.setDraftSavedNotice(false);
    }
    try {
      clearPendingSolanaUpload(result.record);
    } catch {
      localResult.draftCleanupError ??= "The capsule is confirmed, but this browser could not clear its encrypted upload marker. Resume will recheck the completed capsule before any new wallet request.";
    }
    setSuccess({
      card: result.card,
      publicTitle: result.record.publicTitle,
      protocolFeePaidLamports: result.protocolFeePaidLamports,
      ...localResult,
    });
    localReview.current = null;
    setQuote(null);
    setPayload(null);
    setError(localResult.draftCleanupError ?? null);
    setStatus("");
    void wallet.refreshBalance();
  }
  function resume() {
    void run(async () => {
      if (!pending || pending.owner !== wallet.address)
        throw new Error("Connect the original Phantom account.");
      const completed = await reconcileCompletedSolanaUpload(pending, {
        retainCompletedDraft: true,
      });
      if (completed) {
        finishUpload(completed);
        return;
      }
      const bytes = decodeSolanaUploadDraftPayload(pending);
      const next = await createSolanaSealQuote({
        owner: pending.owner,
        payloadBytes: bytes,
        mode: pending.mode,
        publicTitle: pending.publicTitle,
        capsuleId: pending.capsuleId,
        unlockAt: pending.unlockAt,
      });
      if (ownerRef.current !== pending.owner)
        throw new Error("The wallet changed. Reconnect the original account to resume this upload.");
      composer.setMode(pending.mode);
      composer.setPublicTitle(pending.publicTitle);
      setPayload({
        payloadBytes: bytes,
        payloadHash: pending.payloadHash as `0x${string}`,
        unlockAt: pending.unlockAt,
        formatVersion: 1,
      } as EncryptedCapsuleResult);
      setReviewOwner(pending.owner);
      setQuote(next);
    });
  }
  function publish() {
    void run(async () => {
      const provider = getPhantomSolanaProvider(window as never);
      if (
        !provider ||
        !wallet.address ||
        wallet.address !== reviewOwner ||
        !quote ||
        !payload
      )
        throw new Error("Reconnect the wallet that reviewed this upload.");
      const result = await submitSolanaCapsule({
        owner: reviewOwner,
        provider,
        quote,
        unlockAt: payload.unlockAt,
        mode: pending?.mode ?? composer.mode,
        payloadBytes: payload.payloadBytes,
        payloadHash: payload.payloadHash,
        publicTitle: pending?.publicTitle ?? composer.normalizedPublicTitle,
        resumeDraft: pending,
        retainCompletedDraft: true,
        onStatus: setStatus,
      });
      finishUpload(result);
    });
  }
  return (
    <div
      className="create-page"
      style={{ maxWidth: 860, margin: "0 auto", padding: "36px 20px" }}
    >
      <CapsuleComposerHeader
        title={t("create.title")}
        subtitle={t("create.subtitle")}
      />
      {pending && (
        <div className="glass-panel" style={{ padding: 20, marginBottom: 20 }}>
          <p>
            {"Unfinished encrypted upload"}: <code>{pending.capsulePda}</code>
          </p>
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn-primary"
              disabled={busy || pending.owner !== wallet.address}
              onClick={resume}
            >
              Resume encrypted upload
            </button>
            <button
              className="btn-secondary"
              disabled={busy || pending.owner !== wallet.address}
              onClick={() =>
                void run(async () => {
                  const provider = getPhantomSolanaProvider(window as never);
                  if (!provider || !wallet.address) return;
                  await cancelSolanaUpload(
                    wallet.address,
                    pending.capsulePda,
                    provider,
                    setStatus,
                  );
                  setQuote(null);
                  setPayload(null);
                  localReview.current = null;
                })
              }
            >
              Cancel unfinished upload
            </button>
          </div>
        </div>
      )}
      <CapsuleComposerForm
        composer={composer}
        idPrefix="solana"
        onSubmit={validate}
        error={error || wallet.error}
        connected={wallet.isConnected}
        isConnecting={wallet.isConnecting}
        onConnectWallet={onOpenWallet}
        isSubmitting={busy}
        submittingLabel={status || t("create.statusPreparing")}
        submitButtonId="btn-solana-seal-capsule"
        saveDraftButtonId="btn-solana-save-draft"
        submitDisabled={!!quote || !!pending}
        onSaveDraft={() => {
          try {
            const next = saveLocalDraft(
              {
                id: composer.draftId ?? undefined,
                message: composer.message,
                mode: composer.mode,
                publicTitle: composer.publicTitle,
                localLabel: composer.localLabel,
                unlockDate: composer.unlockDate,
                timeZone: "UTC",
              },
              scope.key,
            );
            composer.setDraftId(next.id);
            composer.setDraftSavedNotice(true);
          } catch (e) {
            setError(errorMessage(e));
          }
        }}
        draftSavedNotice={composer.draftSavedNotice}
        networkSummary={
          <span title={SOLANA_PROGRAM_ID}>
            Solana Devnet · {SOLANA_PROGRAM_ID.slice(0, 6)}…
            {SOLANA_PROGRAM_ID.slice(-5)}
          </span>
        }
        feeSummary={
          fee
            ? `${formatLamports(fee.protocolFeeLamports, 9)} SOL`
            : t("solFee.unavailable")
        }
        messageAddon={
          <p style={{ color: "var(--text-dim)", fontSize: ".75rem" }}>
            Solana text only · encrypted content and public title: 8,192 bytes
            maximum.
          </p>
        }
      >
        <SolanaProtocolFeePanel
          fee={fee}
          balance={wallet.balance}
          loading={feeLoading}
          error={feeError}
          onRefresh={() => setFeeRefresh((v) => v + 1)}
        />
        {status && (
          <p
            role="status"
            style={{ color: "var(--text-muted)", marginBottom: 16 }}
          >
            {status}
          </p>
        )}
      </CapsuleComposerForm>
      {confirm && (
        <SealConfirmationModal
          mode={composer.mode}
          publicTitle={composer.normalizedPublicTitle}
          unlockDate={composer.unlockDate}
          duration={composer.getDurationFromNow()}
          networkName="Solana Devnet"
          feeDescription={t("solana.costsBeforeSigning")}
          onClose={() => setConfirm(false)}
          onProceed={prepare}
        />
      )}
      {quote && payload && !busy && (
        <WalletReviewDialog
          titleId="solana-review-title"
          onClose={() => {
            setQuote(null);
            setPayload(null);
          }}
        >
          <h2
            id="solana-review-title"
            style={{ fontSize: "1.25rem", fontWeight: 800, marginBottom: 10 }}
          >
            {t("create.reviewSeal")}
          </h2>
          <p style={{ color: "var(--text-muted)" }}>
            Solana Devnet test SOL · {quote.walletApprovalCount} Phantom
            request(s)
          </p>
          <dl
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 12,
              margin: "20px 0",
            }}
          >
            <dt>{t("solFee.protocolFee")}</dt>
            <dd>{formatLamports(quote.protocolFeeLamports, 9)} SOL</dd>
            <dt>{t("solFee.maximumProtocolFee")}</dt>
            <dd>
              {formatLamports(quote.feeReview.maxProtocolFeeLamports, 9)} SOL
            </dd>
            <dt>Storage balance</dt>
            <dd>{formatLamports(quote.accountRentLamports, 9)} SOL</dd>
            {quote.nonceAccountRentLamports > 0n && (
              <>
                <dt>Transaction setup rent</dt>
                <dd>{formatLamports(quote.nonceAccountRentLamports, 9)} SOL</dd>
              </>
            )}
            <dt>{t("solFee.networkFee")}</dt>
            <dd>{formatLamports(quote.estimatedNetworkFeeLamports, 9)} SOL</dd>
            <dt>Wallet balance</dt>
            <dd>{formatLamports(quote.ownerBalanceLamports, 9)} SOL</dd>
          </dl>
          {error && <Alert>{error}</Alert>}
          <button
            className="btn-primary"
            style={{ width: "100%" }}
            onClick={publish}
          >
            Confirm in Phantom
          </button>
        </WalletReviewDialog>
      )}
      {success && (
        <SolanaCapsuleSuccessModal
          card={success.card}
          publicTitle={success.publicTitle}
          localLabelSaved={success.localLabelSaved}
          localLabelSaveError={success.localLabelSaveError}
          protocolFeePaidLamports={success.protocolFeePaidLamports}
          onClose={() => setSuccess(null)}
          onViewMy={() => {
            setSuccess(null);
            onNavigate("my");
          }}
        />
      )}
    </div>
  );
}

function useRecords(owner?: string | null, publicOnly = false) {
  const [records, setRecords] = useState<SolanaCapsuleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setRecords([]);
    setError(null);
    if (!publicOnly && !owner) return;
    setLoading(true);
    (publicOnly
      ? fetchSolanaPublicCapsules()
      : fetchSolanaCapsulesByOwner(owner!)
    )
      .then((v) => {
        if (active) setRecords(v.filter((r) => r.formatVersion === 1));
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [owner, publicOnly, version]);
  return { records, loading, error, refresh: () => setVersion((v) => v + 1) };
}

export function MyView({
  onOpenWallet,
  onNavigate,
}: {
  onOpenWallet: () => void;
  onNavigate: Navigate;
}) {
  const { t } = useLanguage();
  const wallet = useSolanaWallet();
  const scope = useAuthLocalScope();
  const data = useRecords(wallet.address);
  const now = useClock();
  const [tab, setTab] = useState<"onchain" | "drafts">("onchain");
  const [selected, setSelected] = useState<SolanaCapsuleRecord | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reminder, setReminder] = useState<SolanaCapsuleRecord | null>(null);
  const [poster, setPoster] = useState<SolanaCapsuleRecord | null>(null);
  const [, updateLabels] = useState(0);
  const [, updateDrafts] = useState(0);
  const request = useRef(0);
  const drafts = getLocalDrafts(scope.key);
  function close() {
    request.current++;
    setSelected(null);
    setMessage(null);
    setPassword("");
    setError(null);
    setBusy(false);
  }
  useEffect(() => {
    close();
    setReminder(null);
    setPoster(null);
  }, [wallet.address]);
  return (
    <div style={{ maxWidth: 1760, margin: "0 auto", padding: "36px 20px" }}>
      <PortfolioHeader
        isLoading={data.loading}
        isConnected={wallet.isConnected}
        description={<>{t("recovery.verifiedViaRpc")} · Solana Devnet</>}
        onRefresh={() => {
          close();
          data.refresh();
          void wallet.refreshBalance();
        }}
        onCreate={() => onNavigate("create")}
      >
        {(error || data.error || wallet.error) && (
          <p role="alert" style={{ color: "#fb7185", fontSize: ".85rem" }}>
            {error || data.error || wallet.error}
          </p>
        )}
      </PortfolioHeader>
      {wallet.isConnected && (
        <WalletIdentityBanner
          address={wallet.address!}
          walletName="PHANTOM"
          networkName="Solana Devnet"
          balance={`${wallet.balance} SOL`}
          balanceTitle={wallet.balanceError ?? undefined}
        />
      )}
      <PortfolioTabs
        value={tab}
        chainCount={data.records.length}
        draftCount={drafts.length}
        onChange={setTab}
      />
      {tab === "drafts" ? (
        <PortfolioDrafts
          drafts={drafts}
          onNavigate={onNavigate}
          onDelete={() => updateDrafts((v) => v + 1)}
        />
      ) : !wallet.isConnected ? (
        <WalletSignInPanel returnTo="/#/my" />
      ) : data.loading ? (
        <div
          role="status"
          className="glass-panel"
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--text-muted)",
          }}
        >
          <LoadingText>{t("my.indexLoading")}</LoadingText>
        </div>
      ) : data.error ? (
        <div
          role="alert"
          className="glass-panel"
          style={{ padding: 40, textAlign: "center", color: "#fb7185" }}
        >
          {data.error}
          <p>
            <button className="btn-secondary" onClick={data.refresh}>
              {t("auth.retry")}
            </button>
          </p>
        </div>
      ) : !data.records.length ? (
        <CapsuleEmptyState
          icon={<Sparkles size={28} />}
          title={t("my.emptyTitle")}
          description={t("my.emptySub")}
          action={
            <button
              className="btn-primary"
              onClick={() => onNavigate("create")}
            >
              {t("my.btnSealNew")}
            </button>
          }
        />
      ) : (
        <div className="capsule-grid capsule-onchain-grid">
          {data.records.map((record) => {
            const displayId = record.capsulePda.slice(0, 8);
            const label = getCapsuleLabel(record.owner, record.capsulePda);
            const displayName =
              label ||
              record.publicTitle ||
              `${t("my.capsuleNoun")} #${displayId}`;
            return (
              <PortfolioCapsuleCard
                key={record.capsulePda}
                id={`capsule-card-solana-${record.capsulePda}`}
                capsuleId={displayId}
                mode={record.mode}
                unlockAt={record.unlockAt}
                now={now}
                badges={<span className="capsule-version">Solana</span>}
                identity={
                  <>
                    Solana Devnet · {record.capsulePda.slice(0, 6)}…
                    {record.capsulePda.slice(-5)}
                  </>
                }
                name={
                  <CapsuleNameEditor
                    id={`solana-${record.capsulePda}`}
                    capsuleId={displayId}
                    displayName={displayName}
                    label={label}
                    onSave={async (value) => {
                      const normalized = value.normalize("NFC").trim();
                      if (!normalized || Array.from(normalized).length > 512)
                        throw new Error(t("my.localLabelPlaceholder"));
                      saveCapsuleLabel(
                        record.owner,
                        record.capsulePda,
                        normalized,
                      );
                      updateLabels((v) => v + 1);
                    }}
                    onRemove={async () => {
                      saveCapsuleLabel(record.owner, record.capsulePda, "");
                      updateLabels((v) => v + 1);
                    }}
                  />
                }
                nameSource={
                  label
                    ? "Saved only in this browser"
                    : record.publicTitle
                      ? t("my.publicTitleIndexed")
                      : t("my.defaultNameAddOwn")
                }
                technicalDetails={
                  <>
                    <div>
                      {t("my.payloadHashLabel")}{" "}
                      <span className="font-mono">{record.payloadHash}</span>
                    </div>
                    <div>
                      Capsule PDA{" "}
                      <span className="font-mono">{record.capsulePda}</span>
                    </div>
                    <div>
                      {t("common.encryptedBytes")}:{" "}
                      {record.payloadBytes.length.toLocaleString()}
                    </div>
                    <div className="capsule-detail-links">
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(record.capsulePda)
                            .catch((e) => setError(errorMessage(e)))
                        }
                      >
                        <Copy size={12} />
                        {t("recovery.copy")}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onNavigate("recover", {
                            capsulePda: record.capsulePda,
                          })
                        }
                      >
                        {t("nav.directRecovery")}
                      </button>
                      <a
                        href={explorer(record.capsulePda)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={12} />
                        {t("nav.explorer")}
                      </a>
                    </div>
                  </>
                }
                actions={
                  <>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        close();
                        setSelected(record);
                      }}
                    >
                      <Unlock size={14} />
                      {t("my.viewContent")}
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() =>
                        void exportSolanaRecoveryCard(record.capsulePda)
                          .then(saveCard)
                          .catch((e) => setError(errorMessage(e)))
                      }
                    >
                      <Download size={14} />
                      {t("my.downloadCard")}
                    </button>
                  </>
                }
              />
            );
          })}
        </div>
      )}
      {selected && (
        <CapsuleInspectionModal
          capsule={{
            id: selected.capsulePda.slice(0, 8),
            mode: selected.mode,
            unlockAt: selected.unlockAt,
            payloadHash: selected.payloadHash,
            publicTitle: selected.publicTitle,
            versionLabel: "Solana · V1",
          }}
          password={password}
          message={message}
          error={error}
          isBusy={busy}
          onPasswordChange={setPassword}
          onDecrypt={() => {
            const current = ++request.current;
            setBusy(true);
            setError(null);
            decryptSolanaCapsule(selected, password)
              .then((v) => {
                if (current === request.current) {
                  setMessage(v);
                  setPassword("");
                }
              })
              .catch((e) => {
                if (current === request.current) setError(errorMessage(e));
              })
              .finally(() => {
                if (current === request.current) setBusy(false);
              });
          }}
          onClose={close}
          onRemind={() => setReminder(selected)}
          onShare={() => setPoster(selected)}
        />
      )}
      {reminder && (
        <NotificationModal
          isOpen
          onClose={() => setReminder(null)}
          capsuleId={reminder.capsuleId}
          unlockAt={reminder.unlockAt}
          mode={reminder.mode}
          networkName="Solana Devnet"
        />
      )}
      {poster && (
        <SharePosterModal
          isOpen
          onClose={() => setPoster(null)}
          data={{
            capsuleId: poster.capsuleId,
            owner: poster.owner,
            unlockAt: poster.unlockAt,
            mode: poster.mode,
            payloadHash: poster.payloadHash,
            networkName: "Solana Devnet",
            publicTitle:
              poster.mode === "public" ? poster.publicTitle : undefined,
          }}
        />
      )}
    </div>
  );
}
