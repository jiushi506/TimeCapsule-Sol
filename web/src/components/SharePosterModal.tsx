import { formatUtcDateTime } from '../utils/dateTime';
import React, { useEffect, useMemo, useState } from 'react';
import { X, Download, Copy, Check, Send, RefreshCw } from 'lucide-react';
import { SUPPORTED_CHAINS } from '../contracts/config';
import { LoadingText } from './LoadingText';
import { useLanguage } from '../context/LanguageContext';
import type { CapsuleMode } from '../codec';
import { useAccessibleModal } from '../utils/useAccessibleModal';
import { PUBLIC_APP_URL } from '../../publicAppUrl';
import {
  POSTER_SHARE_UI,
  SHARE_HOOK_COUNT,
  buildShareCaption,
  selectShareHook,
} from '../utils/shareHooks';

export interface PosterData {
  capsuleId: number | string;
  owner: string;
  unlockAt: number;
  mode: CapsuleMode;
  payloadHash: string;
  chainId?: number;
  networkName?: string;
  messageSnippet?: string;
  txHash?: string;
  /** A verified V3 Public title only; personal labels must never be passed here. */
  publicTitle?: string;
  registryAddress?: string;
}

interface SharePosterModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: PosterData;
}

function usesCompactWordBoundaries(text: string): boolean {
  return /[\u0E00-\u0E7F\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(text);
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const compact = usesCompactWordBoundaries(text);
  const chunks = compact ? Array.from(text) : text.split(/\s+/).filter(Boolean);

  const lines: string[] = [];
  let line = '';
  let truncated = false;

  chunks.forEach((chunk) => {
    if (truncated) return;
    const candidate = line ? (compact ? `${line}${chunk}` : `${line} ${chunk}`) : chunk;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = chunk;
      if (lines.length >= maxLines) truncated = true;
    } else {
      line = candidate;
    }
  });

  if (line && lines.length < maxLines && !truncated) lines.push(line);

  if (lines.length) {
    let lastLine = lines[lines.length - 1];
    const needsEllipsis = truncated || ctx.measureText(lastLine).width > maxWidth;
    if (needsEllipsis) {
      while (lastLine && ctx.measureText(`${lastLine}…`).width > maxWidth) {
        lastLine = Array.from(lastLine).slice(0, -1).join('');
      }
      lines[lines.length - 1] = `${lastLine.trimEnd()}…`;
    }
  }

  lines.forEach((textLine, index) => ctx.fillText(textLine, x, y + index * lineHeight));
}

function loadTunnelImage(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to load the poster illustration.'));
    image.src = `${import.meta.env.BASE_URL}images/time-tunnel.webp`;
  });
}

async function createSpacetimePoster(
  data: PosterData,
  networkName: string,
  unlockFormatted: string,
  unlockYear: number,
  hook: string,
  ui: (typeof POSTER_SHARE_UI)[keyof typeof POSTER_SHARE_UI],
  copy: (key: string) => string,
): Promise<string> {
  const canvas = document.createElement('canvas');
  const width = 1000;
  const height = 1250;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser.');
  const illustration = await loadTunnelImage();

  ctx.fillStyle = '#070b1c';
  ctx.fillRect(0, 0, width, height);

  const imageHeight = 620;
  const scale = Math.max(width / illustration.width, imageHeight / illustration.height);
  const drawWidth = illustration.width * scale;
  const drawHeight = illustration.height * scale;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(30, 30, width - 60, imageHeight, 30);
  ctx.clip();
  ctx.drawImage(
    illustration,
    (width - drawWidth) / 2,
    30 + (imageHeight - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  const veil = ctx.createLinearGradient(0, 70, 0, imageHeight);
  veil.addColorStop(0, 'rgba(5, 9, 24, 0.48)');
  veil.addColorStop(0.36, 'rgba(5, 9, 24, 0.18)');
  veil.addColorStop(1, 'rgba(5, 9, 24, 0.98)');
  ctx.fillStyle = veil;
  ctx.fillRect(30, 30, width - 60, imageHeight);
  ctx.restore();

  ctx.strokeStyle = 'rgba(103, 232, 249, 0.52)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(28, 28, width - 56, height - 56, 30);
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.font = '700 27px "Space Grotesk", sans-serif';
  ctx.fillText('TimeCapsule', 74, 96);
  ctx.fillStyle = '#b8c7df';
  ctx.font = '14px "Inter", sans-serif';
  ctx.fillText(copy('poster.artSubtitle'), 76, 126);

  const privateMode = data.mode === 'private';
  const modeLabel = copy(privateMode ? 'poster.privateMode' : 'poster.publicMode');
  ctx.font = '700 14px "Inter", sans-serif';
  const badgeWidth = Math.min(560, ctx.measureText(modeLabel).width + 42);
  ctx.fillStyle = privateMode ? 'rgba(76, 29, 149, 0.78)' : 'rgba(8, 91, 111, 0.78)';
  ctx.strokeStyle = privateMode ? 'rgba(196, 181, 253, 0.72)' : 'rgba(103, 232, 249, 0.72)';
  ctx.beginPath();
  ctx.roundRect(74, 168, badgeWidth, 42, 21);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = privateMode ? '#e9d5ff' : '#a5f3fc';
  ctx.fillText(modeLabel, 94, 195);

  const hookFontSize = hook.length > 105 ? 39 : hook.length > 72 ? 45 : 51;
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${hookFontSize}px "Space Grotesk", sans-serif`;
  ctx.letterSpacing = '-1px';
  drawWrappedText(ctx, hook, 74, 292, 826, Math.round(hookFontSize * 1.18), 3);
  ctx.letterSpacing = '0px';

  const publicTitle = !privateMode ? data.publicTitle?.normalize('NFC').trim() : undefined;
  if (publicTitle) {
    ctx.fillStyle = '#67e8f9';
    ctx.font = '700 12px "Inter", sans-serif';
    ctx.letterSpacing = '1.4px';
    ctx.fillText(ui.publicTitleLabel.toUpperCase(), 76, 510);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = '#dce8f8';
    ctx.font = '600 21px "Inter", sans-serif';
    drawWrappedText(ctx, publicTitle, 76, 542, 820, 28, 1);
  }

  const panelTop = 610;
  ctx.fillStyle = 'rgba(8, 13, 34, 0.96)';
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.28)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(58, panelTop, 884, 410, 28);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#91a3c2';
  ctx.font = '700 13px "Inter", sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillText(copy('poster.targetLabel'), 96, panelTop + 50);

  const yearGradient = ctx.createLinearGradient(90, panelTop + 62, 460, panelTop + 170);
  yearGradient.addColorStop(0, '#ffffff');
  yearGradient.addColorStop(0.65, '#67e8f9');
  yearGradient.addColorStop(1, '#a78bfa');
  ctx.fillStyle = yearGradient;
  ctx.font = '700 106px "Space Grotesk", sans-serif';
  ctx.letterSpacing = '-4px';
  ctx.fillText(String(unlockYear), 90, panelTop + 164);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#dbe5f5';
  ctx.font = '600 18px "Inter", sans-serif';
  ctx.fillText(unlockFormatted, 96, panelTop + 202);
  ctx.fillStyle = '#a5b4fc';
  ctx.font = '14px "Inter", sans-serif';
  drawWrappedText(ctx, copy('poster.targetNote'), 96, panelTop + 232, 790, 23, 2);

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.beginPath();
  ctx.moveTo(96, panelTop + 270);
  ctx.lineTo(904, panelTop + 270);
  ctx.stroke();

  ctx.fillStyle = privateMode ? '#d8b4fe' : '#67e8f9';
  ctx.font = '700 27px "Space Grotesk", sans-serif';
  drawWrappedText(
    ctx,
    copy(privateMode ? 'poster.privatePanelTitle' : 'poster.publicPanelTitle'),
    96,
    panelTop + 318,
    790,
    35,
    2,
  );
  ctx.fillStyle = '#b8c7df';
  ctx.font = '16px "Inter", sans-serif';
  drawWrappedText(
    ctx,
    copy(privateMode ? 'poster.privatePanelDesc' : 'poster.publicPanelDesc'),
    98,
    panelTop + 356,
    780,
    25,
    2,
  );

  const question = privateMode ? ui.sharePromptPrivate : ui.sharePromptPublic;
  ctx.fillStyle = '#eef6ff';
  ctx.font = '700 21px "Inter", sans-serif';
  drawWrappedText(ctx, question, 110, 1080, 780, 30, 2);

  ctx.fillStyle = '#67e8f9';
  ctx.font = '700 15px "Space Grotesk", sans-serif';
  ctx.letterSpacing = '0.8px';
  ctx.textAlign = 'center';
  ctx.fillText(`${ui.posterFooter}  ·  #${data.capsuleId}`, width / 2, 1160);
  ctx.fillStyle = '#8192ad';
  ctx.font = '600 13px "Inter", sans-serif';
  ctx.letterSpacing = '0.5px';
  ctx.fillText(`timecapsule.web3luma.com  ·  ${networkName}`, width / 2, 1192);
  ctx.textAlign = 'left';
  ctx.letterSpacing = '0px';

  return canvas.toDataURL('image/png');
}

export const SharePosterModal: React.FC<SharePosterModalProps> = ({ isOpen, onClose, data }) => {
  const { t, language } = useLanguage();
  const dialogRef = useAccessibleModal<HTMLDivElement>(isOpen, onClose);
  const ui = POSTER_SHARE_UI[language] || POSTER_SHARE_UI.en;
  const [hookRevision, setHookRevision] = useState(() => Math.floor(Math.random() * 1_000_000_000));
  const [posterResult, setPosterResult] = useState<{ key: string; url: string; error: string } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedImage, setCopiedImage] = useState(false);

  const networkName = data.networkName ?? (data.chainId === undefined ? undefined : SUPPORTED_CHAINS[data.chainId]?.name) ?? t('home.networkUnsupported');
  const unlockDate = new Date(data.unlockAt * 1000);
  const unlockYear = unlockDate.getUTCFullYear();
  const unlockFormatted = formatUtcDateTime(unlockDate);

  const basePosterKey = `${networkName}:${data.chainId ?? ''}:${data.registryAddress ?? ''}:${data.capsuleId}:${data.unlockAt}:${data.mode}:${data.publicTitle ?? ''}:${language}`;
  const selectedHook = useMemo(
    () => selectShareHook(language, data.mode, data.unlockAt, `${basePosterKey}:${hookRevision}`),
    [language, data.mode, data.unlockAt, basePosterKey, hookRevision],
  );
  const posterKey = `${basePosterKey}:${selectedHook.id}`;
  const shareUrl = PUBLIC_APP_URL;
  const posterUrl = posterResult?.key === posterKey ? posterResult.url : '';
  const posterError = posterResult?.key === posterKey ? posterResult.error : '';

  useEffect(() => {
    if (!isOpen) return;
    setHookRevision((value) => value + 1);
  }, [isOpen, basePosterKey]);

  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    const copy = (key: string) => t(key);
    void createSpacetimePoster(
      data,
      networkName,
      unlockFormatted,
      unlockYear,
      selectedHook.text,
      ui,
      copy,
    )
      .then((url) => {
        if (!cancelled) setPosterResult({ key: posterKey, url, error: '' });
      })
      .catch(() => {
        if (!cancelled) setPosterResult({ key: posterKey, url: '', error: copy('poster.generating') });
      });
    return () => {
      cancelled = true;
    };
  }, [
    isOpen,
    data,
    networkName,
    unlockFormatted,
    unlockYear,
    selectedHook.text,
    posterKey,
    t,
    ui,
  ]);

  if (!isOpen) return null;

  const shareText = buildShareCaption(language, data.mode, selectedHook.text);
  const shareQuestion = data.mode === 'private' ? ui.sharePromptPrivate : ui.sharePromptPublic;

  const handleRerollHook = () => {
    setHookRevision((current) => {
      let next = current + 1;
      while (
        next < current + 8 &&
        selectShareHook(language, data.mode, data.unlockAt, `${basePosterKey}:${next}`).id === selectedHook.id
      ) {
        next += 1;
      }
      return next;
    });
  };

  const handleDownload = () => {
    if (!posterUrl) return;
    const anchor = document.createElement('a');
    anchor.href = posterUrl;
    anchor.download = `TimeCapsule-${data.capsuleId}-${unlockYear}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const handleShareX = () => {
    const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      `${shareText}\n\n${shareUrl}\n\n#TimeCapsule`,
    )}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleShareTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleCopyImage = async () => {
    try {
      if (!posterUrl) return;
      const response = await fetch(posterUrl);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopiedImage(true);
      window.setTimeout(() => setCopiedImage(false), 2000);
    } catch {
      handleDownload();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        data-accessible-dialog="true"
        className="glass-panel poster-share-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="poster-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          data-dialog-initial-focus
          className="poster-close-button"
          onClick={onClose}
          aria-label={t('poster.close')}
        >
          <X size={18} />
        </button>

        <header className="poster-modal-header">
          <div className="poster-badges">
            <span className="badge badge-cyan">{t('poster.shareEyebrow')}</span>
            <span className="badge badge-purple">{t('poster.posterBadge')}</span>
          </div>
          <h2 id="poster-modal-title">{selectedHook.text}</h2>
          <p>{shareQuestion}</p>
        </header>

        <div className="poster-modal-grid">
          <div className="poster-preview-frame">
            {posterUrl ? (
              <img
                src={posterUrl}
                alt={`${t('poster.title')} · ${unlockYear}`}
                className="poster-preview-image"
              />
            ) : posterError ? (
              <div className="poster-generating" role="alert">{posterError}</div>
            ) : (
              <div className="poster-generating" role="status"><LoadingText>{t('poster.generating')}</LoadingText></div>
            )}
          </div>

          <div className="poster-share-actions">
            <div className="poster-summary-card">
              <div className="poster-hook-toolbar">
                <span className="poster-summary-eyebrow">
                  {ui.hookLabel} · {SHARE_HOOK_COUNT}
                </span>
                <button
                  type="button"
                  className="poster-reroll-button"
                  onClick={handleRerollHook}
                  aria-label={ui.reroll}
                  title={ui.reroll}
                >
                  <RefreshCw size={14} />
                  {ui.reroll}
                </button>
              </div>

              <div className="poster-summary-hook">“{selectedHook.text}”</div>

              {data.mode === 'public' && data.publicTitle?.trim() ? (
                <div className="poster-public-title">
                  <span>{ui.publicTitleLabel}</span>
                  <p>{data.publicTitle.trim()}</p>
                </div>
              ) : null}

              <p className="poster-summary-copy">{shareQuestion}</p>
              <div className="poster-summary-meta">
                <span>#{data.capsuleId}</span>
                <span>{data.mode === 'private' ? t('poster.privateMode') : t('poster.publicMode')}</span>
                <span>{networkName} · {unlockYear}</span>
              </div>
            </div>

            <button
              id="btn-download-poster-png"
              className="btn-primary"
              onClick={handleDownload}
              disabled={!posterUrl}
            >
              <Download size={18} />
              {t('poster.downloadPng')}
            </button>
            <button
              id="btn-copy-poster-image"
              className="btn-secondary"
              onClick={handleCopyImage}
              disabled={!posterUrl}
            >
              {copiedImage ? <Check size={16} color="#34d399" /> : <Copy size={16} />}
              {copiedImage ? t('poster.copied') : t('poster.copyImage')}
            </button>
            <button id="btn-share-twitter" className="poster-social-button poster-social-x" onClick={handleShareX}>
              <span aria-hidden="true">𝕏</span>
              {t('poster.shareX')}
            </button>
            <button
              id="btn-share-telegram"
              className="poster-social-button poster-social-telegram"
              onClick={handleShareTelegram}
            >
              <Send size={18} />
              {t('poster.shareTg')}
            </button>
            <button id="btn-copy-share-link" className="btn-secondary" onClick={() => void handleCopyLink()}>
              {copiedLink ? <Check size={14} color="#34d399" /> : <Copy size={14} />}
              {copiedLink ? t('poster.linkCopied') : t('poster.copyLink')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
