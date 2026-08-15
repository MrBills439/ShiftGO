import { clsx } from 'clsx';
import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
  label?: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}

export function FieldShell({ label, error, hint, children }: FieldShellProps) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs font-semibold text-fg-muted">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1.5 block text-xs font-medium text-danger-text">{error}</span>
      ) : hint ? (
        <span className="mt-1.5 block text-xs text-fg-subtle">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx('sg-input', className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx('sg-input appearance-none bg-[right_0.75rem_center] pr-9', className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx('sg-input min-h-24 resize-y', className)} {...props} />;
}
