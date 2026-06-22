'use client';
import { WarningCircleIcon } from '@phosphor-icons/react';
import { Modal } from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  isPending?: boolean;
}

export function ConfirmModal({
  open, onClose, onConfirm, title, message,
  confirmLabel = 'Delete', isPending = false,
}: Props) {
  return (
    <Modal open={open} onClose={onClose} title={title} width="max-w-sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-error-container/50 rounded-lg border border-error-DEFAULT/15">
          <WarningCircleIcon size={18} className="text-error-DEFAULT flex-shrink-0 mt-0.5" weight="fill" />
          <p className="text-sm text-on-surface leading-relaxed">{message}</p>
        </div>
        <div className="flex gap-3 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="btn-danger flex-1 justify-center"
          >
            {isPending ? 'Deleting…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
