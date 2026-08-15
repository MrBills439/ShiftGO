'use client';
import { CaretDownIcon, CaretUpIcon } from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { TableSkeleton } from './Skeleton';

export interface DataTableColumn<T> {
  id: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | Date | null | undefined;
  className?: string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  loading?: boolean;
  error?: string;
  emptyTitle: string;
  emptyIcon: React.ComponentType<any>;
  bulkSelectable?: boolean;
  actions?: React.ReactNode;
}

type Density = 'compact' | 'comfortable';

export function DataTable<T>({
  rows,
  columns,
  getRowId,
  loading,
  error,
  emptyTitle,
  emptyIcon,
  bulkSelectable = false,
  actions,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null);
  const [density, setDensity] = useState<Density>('compact');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((c) => c.id === sort.id);
    if (!column?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = column.sortValue?.(a);
      const bv = column.sortValue?.(b);
      const result = String(av ?? '').localeCompare(String(bv ?? ''), 'en-GB', { numeric: true });
      return sort.dir === 'asc' ? result : -result;
    });
  }, [columns, rows, sort]);

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(rows.map(getRowId)) : new Set());
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (loading) return <TableSkeleton cols={columns.length + (bulkSelectable ? 1 : 0)} rows={6} />;
  if (error) return <div className="rounded-lg border border-danger-border bg-danger-bg p-4 text-sm font-medium text-danger-text">{error}</div>;
  if (rows.length === 0) return <EmptyState icon={emptyIcon as any} title={emptyTitle} />;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="text-xs font-medium text-fg-muted">
          {selected.size > 0 ? `${selected.size} selected` : `${rows.length} records`}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDensity((value) => value === 'compact' ? 'comfortable' : 'compact')}
          >
            {density === 'compact' ? 'Comfortable' : 'Compact'}
          </Button>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-surface-subtle">
            <tr>
              {bulkSelectable && (
                <th className="w-10 border-b border-border px-3 py-2 text-left">
                  <input
                    aria-label="Select all rows"
                    type="checkbox"
                    checked={selected.size === rows.length}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-600"
                  />
                </th>
              )}
              {columns.map((column) => {
                const active = sort?.id === column.id;
                return (
                  <th key={column.id} className={clsx('border-b border-border px-3 py-2 text-left text-xs font-semibold text-fg-muted', column.className)}>
                    {column.sortValue ? (
                      <button
                        className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20"
                        onClick={() => setSort(active && sort.dir === 'asc' ? { id: column.id, dir: 'desc' } : { id: column.id, dir: 'asc' })}
                        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        {column.header}
                        {active ? (sort.dir === 'asc' ? <CaretUpIcon size={12} /> : <CaretDownIcon size={12} />) : null}
                      </button>
                    ) : column.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => {
              const rowId = getRowId(row);
              return (
                <tr key={rowId} className="hover:bg-surface-subtle/70">
                  {bulkSelectable && (
                    <td className={clsx('border-b border-border px-3', density === 'compact' ? 'py-2' : 'py-3.5')}>
                      <input
                        aria-label={`Select row ${rowId}`}
                        type="checkbox"
                        checked={selected.has(rowId)}
                        onChange={() => toggleRow(rowId)}
                        className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-600"
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.id} className={clsx('border-b border-border px-3 text-sm text-fg', density === 'compact' ? 'py-2' : 'py-3.5', column.className)}>
                      {column.accessor(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
