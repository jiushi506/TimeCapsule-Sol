import type { ReactNode } from 'react';
import { useAccessibleModal } from '../utils/useAccessibleModal';

/** Chain adapters supply their own fees and wallet instructions in a common dialog. */
export function WalletReviewDialog({ titleId, onClose, children }: { titleId: string; onClose: () => void; children: ReactNode }) {
  const ref = useAccessibleModal<HTMLDivElement>(true, onClose);
  return <div className="modal-backdrop" onClick={onClose}>
    <div ref={ref} data-accessible-dialog="true" role="dialog" aria-modal="true" aria-labelledby={titleId} className="glass-panel capsule-content-modal" onClick={(event) => event.stopPropagation()}>{children}</div>
  </div>;
}
