import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Download,
  ExternalLink,
  Globe2,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import type { CapsuleMode, EncryptedCapsuleResult } from "./codec";
import { useWallet } from "./context/useWallet";
import { useAccessibleModal } from "./context/useAccessibleModal";
import {
  CapsuleCard,
  explorerUrl,
  shortAddress,
} from "./components/CapsuleCard";
import {
  cancelSolanaUpload,
  createSolanaSealQuote,
  decodeSolanaUploadDraftPayload,
  decryptSolanaCapsule,
  exportSolanaRecoveryCard,
  fetchSolanaCapsule,
  fetchSolanaCapsulesByOwner,
  fetchSolanaPublicCapsules,
  formatLamports,
  formatSolanaError,
  getPendingSolanaUpload,
  readSolanaRecoveryCard,
  reconcileCompletedSolanaUpload,
  SOLANA_PROGRAM_ID,
  submitSolanaCapsule,
  type SolanaCapsuleRecord,
  type SolanaRecoveryCard,
  type SolanaSealQuote,
  type SolanaUploadDraft,
} from "./services/solanaCapsuleService";

type Page = "home" | "create" | "my" | "explore" | "recover";
type Prepared = {
  owner: string;
  payload: Pick<EncryptedCapsuleResult, "payloadBytes" | "payloadHash">;
  quote: SolanaSealQuote;
  mode: CapsuleMode;
  title: string;
  unlockAt: number;
  draft?: SolanaUploadDraft;
};
const pages: Page[] = ["home", "create", "my", "explore", "recover"];
const readPage = (): Page =>
  pages.includes(location.hash.slice(1) as Page)
    ? (location.hash.slice(1) as Page)
    : "home";
const localDate = (date: Date) =>
  new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
const errorText = (cause: unknown) =>
  formatSolanaError(cause, "The request could not be completed.");

function downloadCard(card: SolanaRecoveryCard) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(card, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `timecapsule-${card.capsuleId}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function App() {
  const wallet = useWallet();
  const [page, setPage] = useState<Page>(readPage);
  const [zh, setZh] = useState(() => navigator.language.startsWith("zh"));
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<CapsuleMode>("private");
  const [title, setTitle] = useState("");
  const [password, setPassword] = useState("");
  const [unlock, setUnlock] = useState(() =>
    localDate(new Date(Date.now() + 86_400_000)),
  );
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [pending, setPending] = useState(() => getPendingSolanaUpload());
  const [records, setRecords] = useState<SolanaCapsuleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [revision, setRevision] = useState(0);
  const [pda, setPda] = useState("");
  const [selected, setSelected] = useState<SolanaCapsuleRecord | null>(null);
  const [openPassword, setOpenPassword] = useState("");
  const [plaintext, setPlaintext] = useState("");
  const selectionVersion = useRef(0);
  const ownerRef = useRef(wallet.owner);
  ownerRef.current = wallet.owner;
  const text = (en: string, cn: string) => (zh ? cn : en);

  useEffect(() => {
    const change = () => {
      setPage(readPage());
      setError("");
      setStatus("");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.documentElement.lang = zh ? "zh-CN" : "en";
  }, [zh]);
  useEffect(() => {
    setPrepared(null);
    setPassword("");
    setMessage("");
    setOpenPassword("");
    setPlaintext("");
    setSelected(null);
    selectionVersion.current++;
    setPending(getPendingSolanaUpload());
  }, [wallet.owner]);
  useEffect(() => {
    setRecords([]);
    setListError("");
    if (page !== "explore" && (page !== "my" || !wallet.owner)) return;
    let current = true;
    setLoading(true);
    const request =
      page === "my"
        ? fetchSolanaCapsulesByOwner(wallet.owner)
        : fetchSolanaPublicCapsules();
    request
      .then((items) => {
        if (current)
          setRecords(items.filter((item) => item.formatVersion === 1));
      })
      .catch((cause) => {
        if (current) setListError(errorText(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [page, wallet.owner, revision]);
  const dialogRef = useAccessibleModal<HTMLElement>(!!selected, () => {
    if (!actionLock.current) closeRecord();
  });
  const [, refreshClock] = useState(0);
  useEffect(() => {
    if (!selected) return;
    const timer = setInterval(() => refreshClock((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [selected]);

  async function run(action: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorText(cause));
      setStatus("");
    } finally {
      actionLock.current = false;
      setBusy(false);
      setPending(getPendingSolanaUpload());
    }
  }
  function closeRecord() {
    selectionVersion.current++;
    setSelected(null);
    setPlaintext("");
    setOpenPassword("");
  }
  function openRecord(record: SolanaCapsuleRecord) {
    selectionVersion.current++;
    setPlaintext("");
    setOpenPassword("");
    setSelected(record);
    setError("");
  }
  function navigate(next: Page) {
    location.hash = next;
  }
  function review() {
    void run(async () => {
      if (!wallet.owner)
        throw new Error(
          text(
            "Connect Phantom before preparing a capsule.",
            "请先连接 Phantom 钱包。",
          ),
        );
      if (getPendingSolanaUpload())
        throw new Error(
          text(
            "An encrypted upload is already saved. Resume it with its original wallet before starting another.",
            "已有未完成的加密上传，请用原钱包继续上传或取消后再新建。",
          ),
        );
      if (new TextEncoder().encode(message).length > 8192)
        throw new Error(
          text(
            "This text is too long for a Solana capsule.",
            "文字过长，请缩短后再试。",
          ),
        );
      if (!message.trim())
        throw new Error(
          text("Write a text memory first.", "请先写下文字记忆。"),
        );
      if (mode === "private" && password.length < 12)
        throw new Error(
          text(
            "Use a passphrase of at least 12 characters.",
            "请使用至少 12 个字符的独立口令。",
          ),
        );
      const owner = wallet.owner;
      const unlockAt = Math.floor(new Date(unlock).getTime() / 1000);
      const publicTitle =
        mode === "public" ? title.normalize("NFC").trim() : "";
      setStatus(text("Encrypting in this browser…", "正在浏览器中加密…"));
      const { sealCapsulePayload } = await import("./codec");
      const payload = await sealCapsulePayload({
        message,
        mode,
        password: mode === "private" ? password : undefined,
        unlockAt,
      });
      setStatus(
        text(
          "Reading the on-chain fee and storage estimate…",
          "正在读取链上费用与存储估算…",
        ),
      );
      const quote = await createSolanaSealQuote({
        owner,
        payloadBytes: payload.payloadBytes,
        mode,
        publicTitle,
        unlockAt,
      });
      if (ownerRef.current !== owner)
        throw new Error(
          text(
            "The wallet changed. Prepare the review again.",
            "钱包已变化，请重新准备费用确认。",
          ),
        );
      setPrepared({
        owner,
        payload,
        quote,
        mode,
        title: publicTitle,
        unlockAt,
      });
      setPassword("");
      setStatus("");
    });
  }
  function resume() {
    void run(async () => {
      const draft = getPendingSolanaUpload(wallet.owner);
      if (!wallet.owner || !draft)
        throw new Error(
          text(
            "Connect the wallet that started this upload.",
            "请连接最初发起上传的钱包。",
          ),
        );
      setStatus(
        text(
          "Checking the saved upload on chain…",
          "正在核对链上的未完成上传…",
        ),
      );
      const completed = await reconcileCompletedSolanaUpload(draft);
      if (completed) {
        downloadCard(completed.card);
        openRecord(completed.record);
        setPrepared(null);
        setStatus(
          text(
            "This upload was already sealed. No new transaction was sent.",
            "这份上传已封存，没有发送新交易。",
          ),
        );
        return;
      }
      const bytes = decodeSolanaUploadDraftPayload(draft);
      const quote = await createSolanaSealQuote({
        owner: draft.owner,
        payloadBytes: bytes,
        mode: draft.mode,
        publicTitle: draft.publicTitle,
        unlockAt: draft.unlockAt,
        capsuleId: draft.capsuleId,
      });
      if (ownerRef.current !== draft.owner)
        throw new Error("The wallet changed.");
      setPrepared({
        owner: draft.owner,
        payload: {
          payloadBytes: bytes,
          payloadHash: draft.payloadHash as `0x${string}`,
        },
        quote,
        mode: draft.mode,
        title: draft.publicTitle,
        unlockAt: draft.unlockAt,
        draft,
      });
      setStatus("");
    });
  }
  function publish() {
    void run(async () => {
      if (
        !prepared ||
        prepared.owner !== wallet.owner ||
        !wallet.provider.current
      )
        throw new Error("Reconnect the reviewed Phantom account.");
      const result = await submitSolanaCapsule({
        owner: prepared.owner,
        provider: wallet.provider.current,
        quote: prepared.quote,
        unlockAt: prepared.unlockAt,
        mode: prepared.mode,
        payloadBytes: prepared.payload.payloadBytes,
        payloadHash: prepared.payload.payloadHash,
        publicTitle: prepared.title,
        resumeDraft: prepared.draft,
        onStatus: setStatus,
      });
      downloadCard(result.card);
      setPrepared(null);
      setMessage("");
      setPassword("");
      setTitle("");
      setStatus(
        text(
          "Your capsule is sealed. Keep its recovery card.",
          "胶囊已封存，请保管好恢复卡。",
        ),
      );
      openRecord(result.record);
      setRevision((value) => value + 1);
    });
  }
  function recover() {
    void run(async () => {
      const record = await fetchSolanaCapsule({ capsulePda: pda.trim() });
      openRecord(record);
    });
  }

  const navigation = [
    text("Home", "首页"),
    text("Seal a memory", "封存记忆"),
    text("My capsules", "我的胶囊"),
    text("Explore", "公开广场"),
    text("Recover", "恢复胶囊"),
  ];
  return (
    <>
      <a className="skip-link" href="#content">
        {text("Skip to content", "跳到主要内容")}
      </a>
      <header className="site-header">
        <div className="nav-shell">
          <a className="brand" href="#home">
            <img
              src="/timecapsule-icon-rounded.png"
              alt=""
              width="34"
              height="34"
            />
            <span>
              TIME<span className="cyan">CAPSULE</span>
              <small>SOLANA EDITION</small>
            </span>
          </a>
          <nav aria-label={text("Main navigation", "主导航")}>
            {pages.map((item, index) => (
              <a
                key={item}
                href={`#${item}`}
                aria-current={page === item ? "page" : undefined}
              >
                {navigation[index]}
              </a>
            ))}
          </nav>
          <div className="nav-actions">
            <button
              className="language-button"
              onClick={() => setZh(!zh)}
              aria-label={text("Switch to Chinese", "切换到英文")}
            >
              <Globe2 size={16} />
              {zh ? "EN" : "中文"}
            </button>
            <button
              className="wallet-button"
              disabled={busy || wallet.connecting}
              onClick={() =>
                wallet.owner ? wallet.disconnect() : void wallet.connect()
              }
            >
              <Wallet size={16} />
              {wallet.owner
                ? shortAddress(wallet.owner)
                : wallet.connecting
                  ? text("Connecting…", "连接中…")
                  : text("Connect wallet", "连接钱包")}
            </button>
          </div>
        </div>
      </header>
      <main id="content">
        {!selected && (error || wallet.error) && (
          <div className="notice error" role="alert">
            {error || wallet.error}
          </div>
        )}
        {status && (
          <div className="notice" role="status">
            {status}
          </div>
        )}
        {page === "home" && (
          <div className="home-page">
            <section className="hero">
              <div className="hero-copy">
                <div className="eyebrow">
                  <span className="network-dot" /> SOLANA DEVNET <span>·</span>{" "}
                  {text("A little piece of tomorrow", "把此刻，寄给未来")}
                </div>
                <h1>
                  {text("Some words deserve", "有些话，")}
                  <br />
                  <span className="gradient-text">
                    {text("their own moment.", "值得留给未来。")}
                  </span>
                </h1>
                <p className="hero-description">
                  {text(
                    "Write it today. Seal it on Solana. Let the future open it.",
                    "今天写下，在 Solana 上封存，让未来的自己打开。",
                  )}
                  <br />
                  {text(
                    "Your memory stays encrypted, your story stays yours.",
                    "记忆在浏览器中加密，故事始终属于你。",
                  )}
                </p>
                <div className="hero-actions">
                  <button
                    className="btn-primary"
                    onClick={() => navigate("create")}
                  >
                    {text("Seal a memory", "封存一段记忆")}
                    <ArrowRight size={18} />
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => navigate("recover")}
                  >
                    {text("Open a capsule", "打开时间胶囊")}
                  </button>
                </div>
                <div className="hero-trust">
                  <ShieldCheck size={16} />
                  {text(
                    "Encrypted in your browser. Stored entirely on chain.",
                    "浏览器本地加密 · 完整内容保存在链上",
                  )}
                </div>
              </div>
              <div className="hero-art">
                <img
                  src="/images/home-flow-seal.webp"
                  alt={text(
                    "A glowing time capsule floating among the stars",
                    "星空中发光的时间胶囊",
                  )}
                />
                <div className="orbit-label">
                  <Sparkles size={15} />
                  {text("FOR YOUR FUTURE SELF", "写给未来的你")}
                </div>
                <div className="art-caption">
                  <LockKeyhole size={17} />
                  <div>
                    <strong>
                      {text("A moment, preserved.", "让一个瞬间，穿越时间。")}
                    </strong>
                    <span>
                      {text(
                        "Not everything needs to be opened today.",
                        "不是所有的话，都需要今天打开。",
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </section>
            <section className="feature-strip">
              <div>
                <ShieldCheck size={19} />
                <span>
                  {text("Browser-only encryption", "仅在浏览器中加密")}
                </span>
              </div>
              <div>
                <LockKeyhole size={19} />
                <span>{text("Time-release with drand", "drand 时间锁")}</span>
              </div>
              <div>
                <Check size={19} />
                <span>
                  {text("Direct Solana recovery", "从 Solana 直接恢复")}
                </span>
              </div>
            </section>
            <section className="section">
              <div className="section-heading">
                <p className="eyebrow">
                  {text(
                    "SMALL WORDS. LASTING MEANING.",
                    "将此刻的心意，留到未来。",
                  )}
                </p>
                <h2>
                  {text(
                    "What will you send forward?",
                    "你想给未来留下些什么？",
                  )}
                </h2>
              </div>
              <div className="usecase-grid">
                {[
                  [
                    "usecase-future-self.webp",
                    text("A letter to yourself", "给未来的自己"),
                    text(
                      "The dreams, hopes and small things you want to remember.",
                      "记住今天的期待、梦想，以及那些微小的美好。",
                    ),
                  ],
                  [
                    "usecase-private-thought.webp",
                    text("A thought, just for you", "一份私密的心事"),
                    text(
                      "A private capsule adds your own passphrase to the time lock.",
                      "私密胶囊在时间锁之外，再加上一层独立口令。",
                    ),
                  ],
                  [
                    "usecase-public-mark.webp",
                    text("A message to the world", "留给世界的一句话"),
                    text(
                      "Let everyone discover your words when the time is right.",
                      "等到约定的时刻，让更多人读到你的故事。",
                    ),
                  ],
                ].map(([image, heading, body]) => (
                  <article className="usecase" key={image}>
                    <img src={`/images/${image}`} alt="" loading="lazy" />
                    <div>
                      <h3>{heading}</h3>
                      <p>{body}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        )}
        {page === "create" && (
          <section className="workspace">
            <div className="section-heading">
              <p className="eyebrow">
                {text("A NOTE TO THE FUTURE", "寄一封信，给未来")}
              </p>
              <h1>{text("Make this moment last.", "让这一刻，留得更久。")}</h1>
              <p>
                {text(
                  "Text only · Solana Devnet · no account required",
                  "仅支持文字 · Solana Devnet · 无需注册账号",
                )}
              </p>
            </div>
            {pending && (
              <div className="notice">
                <p>
                  {text(
                    "An encrypted upload is saved in this browser.",
                    "此浏览器保存了一份未完成的加密上传。",
                  )}{" "}
                  <span className="mono">
                    {shortAddress(pending.capsulePda)}
                  </span>
                </p>
                <div className="button-row">
                  <button
                    className="btn-secondary"
                    disabled={busy || wallet.owner !== pending.owner}
                    onClick={resume}
                  >
                    {text("Review & resume", "确认费用并继续")}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || wallet.owner !== pending.owner}
                    onClick={() =>
                      void run(async () => {
                        if (!wallet.provider.current)
                          throw new Error("Connect Phantom first.");
                        await cancelSolanaUpload(
                          wallet.owner,
                          pending.capsulePda,
                          wallet.provider.current,
                          setStatus,
                        );
                        setPrepared(null);
                        setStatus(
                          text(
                            "Upload canceled; account rent returned to the owner.",
                            "上传已取消，账户租金已返还原钱包。",
                          ),
                        );
                      })
                    }
                  >
                    {text("Cancel unfinished upload", "取消未完成上传")}
                  </button>
                </div>
                {wallet.owner !== pending.owner && (
                  <small>
                    {text(
                      "Connect the original wallet to continue.",
                      "请连接原钱包后继续。",
                    )}
                  </small>
                )}
              </div>
            )}
            <div className="create-grid">
              <form
                className="panel form-panel"
                onSubmit={(event) => {
                  event.preventDefault();
                  review();
                }}
              >
                <fieldset
                  disabled={busy || !!prepared || !!pending || !wallet.owner}
                >
                  <label>
                    {text("Visibility", "可见范围")}
                    <select
                      value={mode}
                      onChange={(event) =>
                        setMode(event.target.value as CapsuleMode)
                      }
                    >
                      <option value="private">
                        {text(
                          "Private · time lock + passphrase",
                          "私密 · 时间锁 + 独立口令",
                        )}
                      </option>
                      <option value="public">
                        {text(
                          "Public · opens for everyone later",
                          "公开 · 到时所有人可读",
                        )}
                      </option>
                    </select>
                  </label>
                  {mode === "public" && (
                    <label>
                      {text("Public title", "公开标题")}
                      <input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        maxLength={512}
                        required
                        placeholder={text(
                          "A small promise to the future",
                          "给未来的一个小约定",
                        )}
                      />
                      <small>
                        {text(
                          "The title is public immediately.",
                          "标题会立即公开显示。",
                        )}
                      </small>
                    </label>
                  )}
                  <label>
                    {text("Your memory", "此刻想说的话")}
                    <textarea
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      rows={8}
                      maxLength={8000}
                      required
                      placeholder={text("Dear future me,", "亲爱的未来的我，")}
                    />
                    <small>
                      {text(
                        "Encrypted content plus public title must fit within 8,192 bytes. Long text may need shortening.",
                        "加密后的内容与公开标题合计不超过 8,192 字节，过长的文字需要缩短。",
                      )}
                    </small>
                  </label>
                  <label>
                    {text("Open after", "约定开启时间")}
                    <input
                      type="datetime-local"
                      value={unlock}
                      onChange={(event) => setUnlock(event.target.value)}
                      min={localDate(new Date(Date.now() + 600_000))}
                      required
                    />
                    <small>
                      {text(
                        "Displayed in your local timezone. Leave at least 10 minutes for upload.",
                        "使用你的本地时区，请至少预留 10 分钟完成上传。",
                      )}
                    </small>
                  </label>
                  {mode === "private" && (
                    <label>
                      {text("Independent passphrase", "独立口令")}
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        minLength={12}
                        required
                        placeholder={text(
                          "At least 12 characters",
                          "至少 12 个字符",
                        )}
                      />
                      <small>
                        {text(
                          "Keep this separately. It cannot be reset or recovered.",
                          "请另行妥善保管，口令无法重置或找回。",
                        )}
                      </small>
                    </label>
                  )}
                  <button
                    className="btn-primary full"
                    disabled={!wallet.owner}
                    type="submit"
                  >
                    <LockKeyhole size={17} />
                    {text("Encrypt & review cost", "加密并查看费用")}
                  </button>
                </fieldset>
                {!wallet.owner && (
                  <button
                    type="button"
                    className="text-button connect-hint"
                    onClick={() => void wallet.connect()}
                  >
                    {text(
                      "Connect Phantom to get started →",
                      "连接 Phantom 钱包开始 →",
                    )}
                  </button>
                )}
              </form>
              <aside className="panel review-panel">
                <ShieldCheck size={25} className="cyan" />
                <h2>
                  {text("Your memory. Your keys.", "你的记忆，由你保管。")}
                </h2>
                <p>
                  {text(
                    "Encryption happens here in your browser. Only ciphertext is uploaded. The recovery card contains public identifiers, never your passphrase.",
                    "加密在当前浏览器中完成，仅上传密文。恢复卡只记录公开标识，不包含独立口令。",
                  )}
                </p>
                <div className="callout">
                  {text(
                    "Use a Devnet wallet with test SOL. No real-money network is enabled.",
                    "请使用含测试 SOL 的 Devnet 钱包。此版本仅连接测试网。",
                  )}
                </div>
                {prepared && (
                  <div className="cost-review">
                    <h3>{text("Review before signing", "签名前确认")}</h3>
                    <dl>
                      <dt>{text("Protocol fee", "协议费")}</dt>
                      <dd>
                        {formatLamports(prepared.quote.protocolFeeLamports, 9)}{" "}
                        SOL
                      </dd>
                      <dt>{text("Signed fee cap", "签名费用上限")}</dt>
                      <dd>
                        {formatLamports(
                          prepared.quote.feeReview.maxProtocolFeeLamports,
                          9,
                        )}{" "}
                        SOL
                      </dd>
                      <dt>{text("Storage rent", "存储租金")}</dt>
                      <dd>
                        {formatLamports(prepared.quote.accountRentLamports, 9)}{" "}
                        SOL
                      </dd>
                      {prepared.quote.nonceSetupRequired && (
                        <>
                          <dt>
                            {text("Reusable nonce rent", "可复用 nonce 租金")}
                          </dt>
                          <dd>
                            {formatLamports(
                              prepared.quote.nonceAccountRentLamports,
                              9,
                            )}{" "}
                            SOL
                          </dd>
                        </>
                      )}
                      <dt>{text("Estimated network fee", "预估网络费")}</dt>
                      <dd>
                        {formatLamports(
                          prepared.quote.estimatedNetworkFeeLamports,
                          9,
                        )}{" "}
                        SOL
                      </dd>
                      <dt>{text("Encrypted bytes", "加密字节数")}</dt>
                      <dd>
                        {prepared.quote.payloadBytes +
                          prepared.quote.titleBytes}{" "}
                        / 8,192
                      </dd>
                      <dt>{text("Wallet approvals", "钱包确认次数")}</dt>
                      <dd>{prepared.quote.walletApprovalCount}</dd>
                    </dl>
                    <button
                      className="btn-primary full"
                      onClick={publish}
                      disabled={busy || prepared.owner !== wallet.owner}
                    >
                      {text("Confirm in Phantom", "在 Phantom 中确认")}
                      <ArrowRight size={17} />
                    </button>
                    <button
                      className="text-button full"
                      disabled={busy}
                      onClick={() => setPrepared(null)}
                    >
                      {text("Back to editing", "返回编辑")}
                    </button>
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}
        {(page === "my" || page === "explore") && (
          <section className="workspace">
            <div className="section-heading">
              <p className="eyebrow">
                {page === "my"
                  ? text("YOUR ON-CHAIN KEEPSAKES", "你的链上记忆")
                  : text(
                      "LETTERS WAITING FOR THEIR MOMENT",
                      "等待时间开启的故事",
                    )}
              </p>
              <h1>
                {page === "my"
                  ? text("My capsules", "我的时间胶囊")
                  : text(
                      "A little window into tomorrow.",
                      "从这里，看见未来。",
                    )}
              </h1>
              <p>
                {text(
                  "V1 text capsules, verified directly from Solana.",
                  "直接从 Solana 读取并验证 V1 文字胶囊。",
                )}
              </p>
            </div>
            {page === "my" && !wallet.owner ? (
              <div className="panel empty-state">
                <Wallet size={30} />
                <h2>
                  {text(
                    "Your memories start with your wallet.",
                    "连接钱包，找到你的记忆。",
                  )}
                </h2>
                <button
                  className="btn-primary"
                  onClick={() => void wallet.connect()}
                >
                  {text("Connect Phantom", "连接 Phantom")}
                </button>
              </div>
            ) : (
              <>
                <div className="list-toolbar">
                  <span className="muted">
                    {loading
                      ? text("Reading Solana…", "正在读取 Solana…")
                      : `${records.length} ${text("verified capsules", "个已验证胶囊")}`}
                  </span>
                  <button
                    className="text-button"
                    disabled={loading || busy}
                    onClick={() => setRevision((value) => value + 1)}
                  >
                    {text("Refresh", "刷新")}
                  </button>
                </div>
                {listError ? (
                  <div className="notice error" role="alert">
                    {listError}
                    <p>
                      {text(
                        "Public RPCs may restrict account scans. You can still recover a capsule using its PDA.",
                        "公共 RPC 可能限制账户扫描，你仍可通过 PDA 地址直接恢复胶囊。",
                      )}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => navigate("recover")}
                    >
                      {text("Direct recovery →", "直接恢复 →")}
                    </button>
                  </div>
                ) : loading ? (
                  <div className="panel empty-state" role="status">
                    {text(
                      "Verifying capsule accounts…",
                      "正在验证链上胶囊账户…",
                    )}
                  </div>
                ) : records.length ? (
                  <div className="capsule-grid">
                    {records.map((record) => (
                      <CapsuleCard
                        key={record.capsulePda}
                        record={record}
                        onOpen={openRecord}
                        zh={zh}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="panel empty-state">
                    <Sparkles size={30} />
                    <h2>
                      {text(
                        "A story is waiting to be written.",
                        "下一段故事，等你写下。",
                      )}
                    </h2>
                    <button
                      className="btn-primary"
                      onClick={() => navigate("create")}
                    >
                      {text("Seal your first memory", "封存第一段记忆")}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
        {page === "recover" && (
          <section className="workspace narrow">
            <div className="section-heading">
              <p className="eyebrow">
                {text("YOUR STORY HAS A WAY HOME", "让记忆，找到回家的路")}
              </p>
              <h1>{text("Open your time capsule.", "打开你的时间胶囊。")}</h1>
              <p>
                {text(
                  "No login. No wallet required. Read and verify your capsule directly from Solana.",
                  "无需登录或连接钱包，直接从 Solana 读取并验证你的胶囊。",
                )}
              </p>
            </div>
            <div className="panel form-panel">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  recover();
                }}
              >
                <label>
                  {text("Capsule account address (PDA)", "胶囊账户地址（PDA）")}
                  <input
                    value={pda}
                    onChange={(event) => setPda(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    required
                    placeholder={text(
                      "Paste the address from your recovery card",
                      "粘贴恢复卡上的胶囊账户地址",
                    )}
                  />
                </label>
                <button
                  className="btn-primary full"
                  type="submit"
                  disabled={busy}
                >
                  {text("Read from Solana", "从 Solana 读取")}
                  <ArrowRight size={17} />
                </button>
              </form>
              <div className="divider">
                {text("or use your recovery card", "或使用恢复卡")}
              </div>
              <label className="file-label">
                {text("Choose recovery card (.json)", "选择恢复卡（.json）")}
                <input
                  type="file"
                  accept=".json,application/json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void run(async () => {
                      if (file.size > 65_536)
                        throw new Error("Recovery card is too large.");
                      const card = JSON.parse(
                        await file.text(),
                      ) as SolanaRecoveryCard;
                      const record = await readSolanaRecoveryCard(card);
                      openRecord(record);
                    });
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="recovery-note">
              {text(
                "The recovery card never includes a private passphrase. Public and private V1 text capsules are supported; V2 shared memories belong to the full application.",
                "恢复卡不会包含私密口令。此版本支持公开与私密 V1 文字胶囊；V2 共享记忆请使用完整应用。",
              )}
            </p>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <div>
          <strong>
            TIME<span className="cyan">CAPSULE</span>
          </strong>
          <p>
            {text(
              "A memory today. A gift for tomorrow.",
              "今天的一段记忆，送给未来的一份礼物。",
            )}
          </p>
        </div>
        <div className="footer-links">
          <span className="pill">
            <span className="network-dot" />
            Solana Devnet
          </span>
          <a
            href={explorerUrl(SOLANA_PROGRAM_ID)}
            target="_blank"
            rel="noreferrer"
          >
            {text("Program", "链上合约")}
            <ExternalLink size={13} />
          </a>
          <a
            href="https://github.com/jiushi506/TimeCapsule-Sol"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
            <ExternalLink size={13} />
          </a>
        </div>
      </footer>
      {selected && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) closeRecord();
          }}
        >
          <section
            ref={dialogRef}
            tabIndex={-1}
            data-accessible-dialog="true"
            className="panel capsule-detail"
            role="dialog"
            aria-modal="true"
            aria-labelledby="capsule-heading"
          >
            <button
              data-dialog-initial-focus
              className="modal-close"
              aria-label={text("Close capsule", "关闭胶囊")}
              onClick={closeRecord}
              disabled={busy}
            >
              <X size={22} />
            </button>
            <div className="eyebrow">
              {text("VERIFIED ON SOLANA", "已通过 Solana 验证")}
            </div>
            <h2 id="capsule-heading">
              {selected.publicTitle ||
                text("A letter to the future", "一封写给未来的信")}
            </h2>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {busy && (
              <p className="modal-status" role="status">
                {text("Processing in this browser…", "正在浏览器中处理…")}
              </p>
            )}
            <dl className="detail-list">
              <dt>PDA</dt>
              <dd>
                <a
                  href={explorerUrl(selected.capsulePda)}
                  target="_blank"
                  rel="noreferrer"
                  className="mono"
                >
                  {selected.capsulePda}
                </a>
              </dd>
              <dt>{text("Opens", "开启时间")}</dt>
              <dd>{new Date(selected.unlockAt * 1000).toLocaleString()}</dd>
              <dt>{text("Mode", "模式")}</dt>
              <dd>
                {selected.mode} · V{selected.formatVersion}
              </dd>
              <dt>SHA-256</dt>
              <dd className="mono">{selected.payloadHash}</dd>
            </dl>
            {plaintext ? (
              <div className="plaintext">{plaintext}</div>
            ) : selected.formatVersion !== 1 ? (
              <div className="callout">
                {text(
                  "This is a V2 memory. Use the full application to open it.",
                  "这是 V2 记忆，请使用完整应用开启。",
                )}
              </div>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const record = selected;
                  const version = selectionVersion.current;
                  void run(async () => {
                    const result = await decryptSolanaCapsule(
                      record,
                      openPassword || undefined,
                    );
                    if (version === selectionVersion.current) {
                      setPlaintext(result);
                      setOpenPassword("");
                    }
                  });
                }}
              >
                {selected.mode === "private" && (
                  <label>
                    {text("Independent passphrase", "独立口令")}
                    <input
                      type="password"
                      autoComplete="off"
                      value={openPassword}
                      onChange={(event) => setOpenPassword(event.target.value)}
                      required
                      disabled={busy}
                    />
                  </label>
                )}
                <button
                  className="btn-primary full"
                  disabled={busy || Date.now() < selected.unlockAt * 1000}
                  type="submit"
                >
                  <LockKeyhole size={16} />
                  {Date.now() < selected.unlockAt * 1000
                    ? text("Waiting for the unlock time", "等待约定的开启时间")
                    : text("Decrypt in this browser", "在浏览器中解密")}
                </button>
              </form>
            )}
            <button
              className="text-button full"
              disabled={busy || selected.formatVersion !== 1}
              onClick={() =>
                void run(async () =>
                  downloadCard(
                    await exportSolanaRecoveryCard(selected.capsulePda),
                  ),
                )
              }
            >
              <Download size={15} />
              {text("Download recovery card", "下载恢复卡")}
            </button>
          </section>
        </div>
      )}
    </>
  );
}
