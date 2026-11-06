import { ArrowUpRight, LockKeyhole, UnlockKeyhole } from "lucide-react";
import type { SolanaCapsuleRecord } from "../services/solanaCapsuleService";

export const shortAddress = (value: string) =>
  `${value.slice(0, 6)}…${value.slice(-5)}`;
export const explorerUrl = (address: string) =>
  `https://explorer.solana.com/address/${encodeURIComponent(address)}?cluster=devnet`;

export function CapsuleCard({
  record,
  onOpen,
  zh,
}: {
  record: SolanaCapsuleRecord;
  onOpen: (record: SolanaCapsuleRecord) => void;
  zh: boolean;
}) {
  const unlocked = Date.now() >= record.unlockAt * 1000;
  return (
    <article className="capsule-tile">
      <div className="tile-meta">
        <span className={`pill ${unlocked ? "ready" : ""}`}>
          {unlocked ? <UnlockKeyhole size={13} /> : <LockKeyhole size={13} />}
          {unlocked
            ? zh
              ? "已到开启时间"
              : "Ready to open"
            : zh
              ? "等待未来"
              : "Sealed for later"}
        </span>
        <span>
          {record.mode === "private"
            ? zh
              ? "私密"
              : "Private"
            : zh
              ? "公开"
              : "Public"}
        </span>
      </div>
      <h3>
        {record.publicTitle ||
          (zh ? "一封写给未来的信" : "A letter to the future")}
      </h3>
      <p className="muted">
        {zh ? "开启时间" : "Opens"} ·{" "}
        {new Date(record.unlockAt * 1000).toLocaleString()}
      </p>
      <div className="tile-bottom">
        <a
          href={explorerUrl(record.capsulePda)}
          target="_blank"
          rel="noreferrer"
          className="mono"
        >
          {shortAddress(record.capsulePda)} <ArrowUpRight size={13} />
        </a>
        <button className="text-button" onClick={() => onOpen(record)}>
          {zh ? "查看胶囊" : "View capsule"} →
        </button>
      </div>
    </article>
  );
}
