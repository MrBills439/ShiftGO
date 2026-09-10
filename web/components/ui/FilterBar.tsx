'use client';
import { Children, useState } from 'react';
import { FunnelSimpleIcon, XIcon, CaretDownIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { Button } from './Button';

interface FilterBarProps {
  /** Always-visible field (typically a search input). Optional. */
  search?: React.ReactNode;
  /** Filter fields — hidden behind the "Filters" toggle until opened. */
  children?: React.ReactNode;
  activeCount?: number;
  onClear?: () => void;
}

/**
 * Search stays visible; the rest of the filters collapse behind a "Filters"
 * button that carries the active count. Starts open when filters are already
 * applied, otherwise closed; once opened it stays open for the session.
 */
export function FilterBar({ search, children, activeCount = 0, onClear }: FilterBarProps) {
  const hasFilters = Children.toArray(children).length > 0;
  const [open, setOpen] = useState(() => activeCount > 0);

  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        {search ? <div className="min-w-0 flex-1 sm:max-w-xs">{search}</div> : <div className="hidden sm:block" />}

        <div className="flex items-center gap-2">
          {hasFilters && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className={clsx(
                'inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold transition-colors',
                open || activeCount > 0
                  ? 'border-brand-600/30 bg-brand-600/10 text-brand-600'
                  : 'border-border bg-surface-subtle text-fg-muted hover:text-fg',
              )}
            >
              <FunnelSimpleIcon size={14} />
              Filters
              {activeCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                  {activeCount}
                </span>
              )}
              <CaretDownIcon size={12} className={clsx('transition-transform', open && 'rotate-180')} />
            </button>
          )}
          {onClear && activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} icon={<XIcon size={14} />}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {hasFilters && open && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 md:grid-cols-2 xl:grid-cols-4">
          {children}
        </div>
      )}
    </section>
  );
}
