'use client';
import { useEffect } from 'react';
import { XIcon } from '@phosphor-icons/react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
}

export function Modal({ open, onClose, title, children, width = 'max-w-lg' }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-inverse-surface/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${width} bg-white rounded-xl border border-[#E1F5EE] shadow-[0_24px_60px_rgba(26,34,50,0.15)] z-10`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/50">
          <h2 className="text-base font-semibold text-on-surface font-sans">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-on-surface-variant hover:bg-surface-low transition-colors"
          >
            <XIcon size={18} />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
