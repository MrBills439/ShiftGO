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
  success: 'border-primary/30 bg-[#1c2e2a]/90 text-white',
  error:   'border-error/30 bg-[#2e1c1c]/90 text-white',
  info:    'border-outline-variant/30 bg-inverse-surface/90 text-inverse-on-surface',
};

const DOT = {
  success: 'text-[#7dd6c8]',
  error:   'text-error-container',
  info:    'text-outline-variant',
};

// Errors need more reading time than confirmations (WCAG 2.2.1); every toast
// pauses while hovered or focused and can be dismissed with its close button.
const DURATION_MS = { success: 4000, info: 5000, error: 8000 };

function Toast({ toast, onDismiss }: { toast: ToastData; onDismiss: () => void }) {
  const Icon = ICON[toast.type];
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(onDismiss, DURATION_MS[toast.type]);
    return () => clearTimeout(t);
  }, [paused]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={clsx(
        'flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-md min-w-[280px] max-w-sm shadow-[0_8px_32px_rgba(0,0,0,0.3)]',
        'animate-in slide-in-from-bottom-2 fade-in duration-200',
        STYLE[toast.type]
      )}
    >
      <Icon size={18} weight="fill" className={DOT[toast.type]} aria-hidden="true" />
      <p className="text-sm font-medium flex-1 leading-snug">{toast.message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity ml-1 rounded p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
      >
        <XIcon size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * Two live regions that are ALWAYS mounted (a region added at the same moment
 * as its message is often not announced): errors are assertive, everything
 * else polite.
 */
export function ToastContainer({ toasts, onDismiss }: Props) {
  const errors = toasts.filter((t) => t.type === 'error');
  const others = toasts.filter((t) => t.type !== 'error');
  const render = (list: ToastData[]) =>
    list.map((t) => (
      <div key={t.id} className="pointer-events-auto">
        <Toast toast={t} onDismiss={() => onDismiss(t.id)} />
      </div>
    ));
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 items-end pointer-events-none">
      <div role="alert" aria-live="assertive" aria-atomic="false" className="flex flex-col gap-2 items-end">{render(errors)}</div>
      <div role="status" aria-live="polite" aria-atomic="false" className="flex flex-col gap-2 items-end">{render(others)}</div>
    </div>
  );
}
