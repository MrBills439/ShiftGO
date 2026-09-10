'use client';
import {
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, DataTableColumn } from '@/components/ui/DataTable';
import { FieldShell, Input, Select, Textarea } from '@/components/ui/Input';
import { FilterBar } from '@/components/ui/FilterBar';
import { Header } from '@/components/layout/Header';

type GalleryRow = {
  id: string;
  worker: string;
  house: string;
  status: 'Approved' | 'Pending' | 'Conflict';
  hours: number;
};

const rows: GalleryRow[] = [
  { id: '1', worker: 'Amara Hughes', house: 'Willow House', status: 'Approved', hours: 8 },
  { id: '2', worker: 'Ben Carter', house: 'Oak Lodge', status: 'Pending', hours: 10 },
  { id: '3', worker: 'Priya Shah', house: 'Maple Court', status: 'Conflict', hours: 6 },
];

const columns: DataTableColumn<GalleryRow>[] = [
  { id: 'worker', header: 'Worker', accessor: (row) => row.worker, sortValue: (row) => row.worker },
  { id: 'house', header: 'House', accessor: (row) => row.house, sortValue: (row) => row.house },
  {
    id: 'status',
    header: 'Status',
    accessor: (row) => (
      <Badge
        variant={row.status === 'Approved' ? 'success' : row.status === 'Pending' ? 'warning' : 'danger'}
        label={row.status}
      />
    ),
    sortValue: (row) => row.status,
  },
  { id: 'hours', header: 'Hours', accessor: (row) => <span className="font-inter tabular-nums">{row.hours.toFixed(1)}</span>, sortValue: (row) => row.hours },
];

const swatches = [
  ['Brand', 'bg-brand-600', '#007A70'],
  ['Success', 'bg-success-solid', '#168A45'],
  ['Warning', 'bg-warning-solid', '#B77900'],
  ['Danger', 'bg-danger-solid', '#C9333E'],
  ['Info', 'bg-info-solid', '#2C6ECB'],
  ['Neutral', 'bg-fg', '#111816'],
];

export default function DesignSystemPage() {
  return (
    <div className="space-y-8">
      <Header
        title="Design System"
        subtitle="ShiftGO unified Linear/Stripe-flat foundation for web and mobile"
        action={<Button variant="primary" icon={<CheckCircleIcon size={16} />}>Primary action</Button>}
      />

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-fg">Tokens</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Teal is the only brand/action colour. Status colours are semantic and reserved for state.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {swatches.map(([label, className, value]) => (
            <div key={label} className="rounded-lg border border-border bg-surface-subtle p-3">
              <div className={`h-10 rounded-md ${className}`} />
              <div className="mt-3 text-sm font-semibold text-fg">{label}</div>
              <div className="font-inter text-xs tabular-nums text-fg-muted">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-fg">Buttons, Badges, Inputs</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary">Approve rota</Button>
            <Button variant="secondary">Export</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="danger">Reject</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge variant="success" label="Approved" />
            <Badge variant="warning" label="Pending" />
            <Badge variant="danger" label="Conflict" />
            <Badge variant="info" label="In progress" />
            <Badge variant="neutral" label="Draft" />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <FieldShell label="Worker">
              <Input placeholder="Search worker" />
            </FieldShell>
            <FieldShell label="Shift type">
              <Select defaultValue="DAY">
                <option value="DAY">Day</option>
                <option value="WAKE_NIGHT">Wake night</option>
              </Select>
            </FieldShell>
            <FieldShell label="Reason" error="Reason is required">
              <Textarea placeholder="Explain the decision" />
            </FieldShell>
            <FieldShell label="Readonly data" hint="Inter tabular figures are used for data.">
              <Input value="08:00-16:00" readOnly />
            </FieldShell>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold text-fg">States</h2>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-info-border bg-info-bg p-3 text-sm text-info-text">
              <div className="flex items-center gap-2 font-semibold"><ClockIcon size={16} /> Loading state</div>
              <p className="mt-1">Use skeleton rows for tables and dense lists.</p>
            </div>
            <div className="rounded-lg border border-warning-border bg-warning-bg p-3 text-sm text-warning-text">
              <div className="flex items-center gap-2 font-semibold"><WarningCircleIcon size={16} /> Coverage warning</div>
              <p className="mt-1">Warnings are explicit and never colour-only.</p>
            </div>
            <div className="rounded-lg border border-danger-border bg-danger-bg p-3 text-sm text-danger-text">
              <div className="font-semibold">Error state</div>
              <p className="mt-1">Validation and 409 conflicts explain the next action.</p>
            </div>
          </div>
        </div>
      </section>

      <FilterBar
        activeCount={2}
        onClear={() => undefined}
        search={
          <FieldShell label="Search">
            <Input placeholder="Worker, house, rota note" />
          </FieldShell>
        }
      >
        <FieldShell label="Status">
          <Select defaultValue="PENDING">
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
          </Select>
        </FieldShell>
        <FieldShell label="House">
          <Select defaultValue="">
            <option value="">All houses</option>
            <option>Willow House</option>
          </Select>
        </FieldShell>
        <FieldShell label="From">
          <Input type="date" defaultValue="2026-06-28" />
        </FieldShell>
      </FilterBar>

      <DataTable
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        emptyTitle="No records found"
        emptyIcon={CalendarBlankIcon}
        bulkSelectable
        actions={<Button size="sm" variant="secondary">Bulk approve</Button>}
      />
    </div>
  );
}
