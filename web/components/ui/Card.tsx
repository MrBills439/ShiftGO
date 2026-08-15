import { PropsWithChildren } from 'react';
import { clsx } from 'clsx';

interface CardProps extends PropsWithChildren {
  className?: string;
  onClick?: () => void;
}

export function Card({ children, className, onClick }: CardProps) {
  return (
    <div
      className={clsx(
        'rounded-lg border border-neutral-200 bg-white shadow-sm',
        'transition-shadow duration-150',
        onClick && 'cursor-pointer hover:shadow-md',
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
