'use client';
import { useId } from 'react';
import { XIcon } from '@phosphor-icons/react';
import { useFocusTrap } from '@/hooks/useFocusTrap';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

/**
 * Accessible modal dialog: role="dialog" + aria-modal, labelled by its title,
 * focus kept inside while open and returned afterwards, Escape and the close
 * button both close it. Clicking the backdrop is a mouse convenience only —
 * keyboard users have Escape and the close button.
 */
export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: Props) {
  const titleId = useId();
  const dialogRef = useFocusTrap<HTMLDivElement>(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative flex w-full ${width} max-h-[90vh] flex-col overflow-hidden rounded-xl border border-[#E1F5EE] bg-white shadow-[0_24px_60px_rgba(26,34,50,0.15)] z-10 focus:outline-none`}
      >
        <div className="flex shrink-0 items-center justify-between px-6 py-4 border-b border-outline-variant/50">
          <h2 id={titleId} className="text-base font-semibold text-on-surface font-sans">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-md text-on-surface-variant hover:bg-surface-low transition-colors"
          >
            <XIcon size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
