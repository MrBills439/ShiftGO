'use client';
import { useEffect, useState } from 'react';
import { CheckCircleIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastData {
  id: string;
  type: ToastType;
  message: string;
}

interface Props {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

const ICON = {
  success: CheckCircleIcon,
  error:   WarningCircleIcon,
  info:    CheckCircleIcon,
};

const STYLE = {
  success: 'border-primary-DEFAULT/30 bg-[#1c2e2a]/90 text-white',
  error:   'border-error-DEFAULT/30 bg-[#2e1c1c]/90 text-white',
  info:    'border-outline-variant/30 bg-inverse-surface/90 text-inverse-on-surface',
};

const DOT = {
  success: 'text-[#7dd6c8]',
  error:   'text-error-container',
  info:    'text-outline-variant',
};

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const Icon = ICON[toast.type];

  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={clsx(
      'flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md min-w-[280px] max-w-sm shadow-[0_8px_32px_rgba(0,0,0,0.3)]',
      'animate-in slide-in-from-bottom-2 fade-in duration-200',
      STYLE[toast.type]
    )}>
      <Icon size={18} weight="fill" className={DOT[toast.type]} />
      <p className="text-sm font-medium flex-1 leading-snug">{toast.message}</p>
      <button onClick={onDismiss} className="opacity-60 hover:opacity-100 transition-opacity ml-1">
        <XIcon size={14} />
      </button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: Props) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={() => onDismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
