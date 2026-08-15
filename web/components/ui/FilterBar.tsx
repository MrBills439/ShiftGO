import { FunnelSimpleIcon, XIcon } from '@phosphor-icons/react';
import { Button } from './Button';

interface FilterBarProps {
  children: React.ReactNode;
  activeCount?: number;
  onClear?: () => void;
}

export function FilterBar({ children, activeCount = 0, onClear }: FilterBarProps) {
  return (
    <section className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">{children}</div>
        <div className="flex items-center justify-between gap-2 lg:justify-end">
          <div className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-surface-subtle px-3 text-xs font-medium text-fg-muted">
            <FunnelSimpleIcon size={14} />
            {activeCount} active
          </div>
          {onClear && activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} icon={<XIcon size={14} />}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
