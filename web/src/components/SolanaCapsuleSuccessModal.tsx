import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { formatLamports, type SolanaRecoveryCard } from '../services/solanaCapsuleService';
import { CapsuleSuccessModal } from './CapsuleSuccessModal';
import { NotificationModal } from './NotificationModal';
import { SharePosterModal } from './SharePosterModal';

interface Props {
  card: SolanaRecoveryCard;
  publicTitle?: string;
  localLabelSaved?: boolean;
  localLabelSaveError?: string;
  confirmationTimeMs?: number | null;
  protocolFeePaidLamports?: bigint;
  onClose: () => void;
  onViewMy: () => void;
  onCoCreate?: () => void;
}

function saveRecoveryCard(card: SolanaRecoveryCard): void {
  const blob = new Blob([`${JSON.stringify(card, null, 2)}\n`], { type: 'application/json' });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = `timecapsule-solana-${card.capsuleId}-recovery-card.json`;
  anchor.click();
  URL.revokeObjectURL(href);
}

export function SolanaCapsuleSuccessModal({
  card, publicTitle, localLabelSaved, localLabelSaveError, confirmationTimeMs, protocolFeePaidLamports, onClose, onViewMy, onCoCreate,
}: Props) {
  const { t } = useLanguage();
  const [isPosterModalOpen, setIsPosterModalOpen] = useState(false);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  return (
    <>
      <CapsuleSuccessModal
        capsuleId={card.capsuleId}
        unlockAt={card.unlockAt}
        description={`${t('solana.successVerifiedOn')} Solana Devnet.${protocolFeePaidLamports !== undefined ? ` ${t('solFee.paid')}: ${formatLamports(protocolFeePaidLamports, 9)} SOL.` : ''}`}
        publicTitle={card.mode === 'public' ? publicTitle : undefined}
        localLabelSaved={localLabelSaved}
        localLabelSaveError={localLabelSaveError}
        confirmationTimeMs={confirmationTimeMs}
        transaction={{ hash: card.finalizeSignature, url: `https://explorer.solana.com/tx/${encodeURIComponent(card.finalizeSignature)}?cluster=devnet` }}
        onClose={onClose}
        onShare={() => setIsPosterModalOpen(true)}
        onRemind={() => setIsNotificationModalOpen(true)}
        onDownload={() => saveRecoveryCard(card)}
        onViewMy={onViewMy}
        onCoCreate={onCoCreate}
      />
      <SharePosterModal
        isOpen={isPosterModalOpen}
        onClose={() => setIsPosterModalOpen(false)}
        data={{
          capsuleId: card.capsuleId,
          owner: card.owner,
          unlockAt: card.unlockAt,
          mode: card.mode,
          payloadHash: card.payloadHash,
          networkName: 'Solana Devnet',
          txHash: card.finalizeSignature,
          publicTitle: card.mode === 'public' ? publicTitle : undefined,
          registryAddress: card.programId,
        }}
      />
      <NotificationModal
        isOpen={isNotificationModalOpen}
        onClose={() => setIsNotificationModalOpen(false)}
        capsuleId={card.capsuleId}
        unlockAt={card.unlockAt}
        networkName="Solana Devnet"
        mode={card.mode}
      />
    </>
  );
}
