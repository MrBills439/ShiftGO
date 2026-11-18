import { PropsWithChildren, KeyboardEvent } from 'react';
import { clsx } from 'clsx';

interface CardProps extends PropsWithChildren {
  className?: string;
  onClick?: () => void;
  /** Accessible name when the whole card is clickable and its text alone isn't clear. */
  label?: string;
}

/** A clickable card is a real keyboard-operable button (Tab, Enter, Space). */
export function Card({ children, className, onClick, label }: CardProps) {
  const base = clsx(
    'rounded-lg border border-neutral-200 bg-white shadow-sm',
    'transition-shadow duration-150',
    onClick && 'cursor-pointer hover:shadow-md',
    className,
  );
  if (!onClick) return <div className={base}>{children}</div>;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  // A div (not <button>) because cards can contain block content and their own
  // links/buttons, which a <button> may not.
  return (
    <div role="button" tabIndex={0} aria-label={label} className={base} onClick={onClick} onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}
