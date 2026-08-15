'use client';
import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'border-brand-600 bg-brand-600 text-white hover:bg-brand-700 focus-visible:ring-brand-600/25',
  secondary: 'border-border bg-surface text-fg hover:bg-surface-subtle focus-visible:ring-brand-600/20',
  ghost: 'border-transparent bg-transparent text-fg-muted hover:bg-surface-subtle focus-visible:ring-brand-600/20',
  danger: 'border-danger-solid bg-danger-solid text-white hover:bg-danger-text focus-visible:ring-danger-solid/25',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md border font-medium transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-45',
        sizeClass[size],
        variantClass[variant],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
