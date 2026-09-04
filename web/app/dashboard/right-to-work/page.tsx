'use client';
import { useMemo, useState } from 'react';
import {
  ShieldCheckIcon, WarningCircleIcon, DownloadSimpleIcon, PencilIcon,
  FileArrowDownIcon, ArrowSquareOutIcon,
} from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import {
  useRightToWorkList, useUpdateRightToWork, downloadRightToWorkZip, downloadRightToWorkDoc,
} from '@/hooks/useRightToWork';
import { useToast } from '@/hooks/useToast';
import { clsx } from 'clsx';
import type { RightToWorkRow, RightToWorkStatus } from '@/types';

const STATUS_META: Record<RightToWorkStatus, { label: string; cls: string }> = {
  CURRENT: { label: 'Current', cls: 'bg-success-bg text-success-text border-success-border' },
  STALE:   { label: 'Needs update', cls: 'bg-warning-bg text-warning-text border-warning-border' },
  MISSING: { label: 'Not provided', cls: 'bg-danger-bg text-danger-text border-danger-border' },
};

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RightToWorkPage() {
  const { data, isLoading } = useRightToWorkList();
  const update = useUpdateRightToWork();
  const toast = useToast();

  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const [zipping, setZipping] = useState(false);
  const [edit, setEdit] = useState<RightToWorkRow | null>(null);
  const [form, setForm] = useState({ code: '', shareDate: '', notes: '' });
  const [formError, setFormError] = useState('');

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    return filter === 'attention' ? all.filter((r) => r.status !== 'CURRENT') : all;
  }, [data, filter]);

  function openEdit(row: RightToWorkRow) {
    setEdit(row);
    setFormError('');
    setForm({
      code: row.shareCode?.code ?? '',
      shareDate: row.shareCode?.shareDate ? row.shareCode.shareDate.slice(0, 10) : '',
      notes: row.shareCode?.notes ?? '',
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setFormError('');
    try {
      await update.mutateAsync({
        userId: edit.user.id,
        code: form.code,
        shareDate: new Date(form.shareDate).toISOString(),
        notes: form.notes || undefined,
      });
      toast.success(`Updated ${edit.user.name}'s share code`);
      setEdit(null);
    } catch (err: any) {
      setFormError(err.response?.data?.message ?? 'Failed to save');
    }
  }

  async function handleZip() {
    setZipping(true);
    try {
      await downloadRightToWorkZip();
    } catch {
      toast.error('Could not download the ZIP');
    } finally {
      setZipping(false);
    }
  }

  const counts = data?.counts;

  return (
    <div>
      <Header
        title="Right to Work"
        subtitle={`Share codes and proof documents · flagged when missing or over ${data?.staleAfterDays ?? 90} days old`}
        action={
          <button onClick={handleZip} disabled={zipping || !counts?.total} className="btn-secondary">
            <DownloadSimpleIcon size={16} /> {zipping ? 'Preparing…' : 'Download all (ZIP)'}
          </button>
        }
      />

      {counts && (
        <div className="mb-5 grid grid-cols-3 gap-4">
          {[
            { label: 'Current', value: counts.current, cls: 'text-success-text' },
            { label: 'Needs update', value: counts.stale, cls: 'text-warning-text' },
            { label: 'Not provided', value: counts.missing, cls: 'text-danger-text' },
          ].map((c) => (
            <div key={c.label} className="glass-card p-4 text-center">
              <p className={clsx('text-2xl font-bold', c.cls)}>{c.value}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{c.label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-5 inline-flex rounded-lg border border-border bg-surface p-1">
        {(['all', 'attention'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={clsx(
              'rounded-md px-4 py-1.5 text-sm font-semibold transition-colors',
              filter === f ? 'bg-brand-600 text-white' : 'text-fg-muted hover:text-fg'
            )}
          >
            {f === 'all' ? 'All workers' : `Needs attention${counts ? ` (${counts.stale + counts.missing})` : ''}`}
          </button>
        ))}
      </div>

      {isLoading ? (
        <TableSkeleton cols={6} rows={7} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheckIcon}
          title={filter === 'attention' ? 'Everyone is up to date' : 'No workers to show'}
          description={filter === 'attention' ? 'No missing or stale share codes right now.' : 'Active workers will appear here.'}
        />
      ) : (
        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                {['Worker', 'Status', 'Share code', 'Share date', 'Document', ''].map((h) => (
                  <th key={h} className="table-th">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const meta = STATUS_META[row.status];
                return (
                  <tr key={row.user.id} className="transition-colors hover:bg-surface-subtle">
                    <td className="table-td">
                      <p className="font-medium text-fg">{row.user.name}</p>
                      <p className="text-[11px] text-fg-muted">{row.user.email}</p>
                    </td>
                    <td className="table-td">
                      <span className={clsx('inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase', meta.cls)}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="table-td font-inter text-xs">{row.shareCode?.code ?? '—'}</td>
                    <td className="table-td font-inter text-xs">{fmtDate(row.shareCode?.shareDate)}</td>
                    <td className="table-td">
                      {row.shareCode?.hasDocument ? (
                        <button
                          onClick={() => downloadRightToWorkDoc(row.user.id, row.shareCode?.documentName ?? `${row.user.name}.pdf`)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
                        >
                          <FileArrowDownIcon size={14} /> Download
                        </button>
                      ) : (
                        <span className="text-xs text-fg-subtle">None</span>
                      )}
                    </td>
                    <td className="table-td text-right">
                      <button
                        onClick={() => openEdit(row)}
                        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-surface-muted hover:text-fg"
                      >
                        <PencilIcon size={14} /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.user.name} — Right to Work` : ''}>
        <form onSubmit={saveEdit} className="space-y-4">
          <a
            href="https://www.gov.uk/view-right-to-work"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline"
          >
            <ArrowSquareOutIcon size={13} /> Check a share code on gov.uk
          </a>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">Share code</label>
            <input
              className="input-field"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              placeholder="W3E W7A 5X2"
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">Share date</label>
            <input
              type="date"
              className="input-field"
              value={form.shareDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setForm({ ...form, shareDate: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">Notes (optional)</label>
            <textarea
              className="input-field resize-none"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {formError && <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">{formError}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setEdit(null)} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={update.isPending} className="btn-primary flex-1 justify-center">
              {update.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
