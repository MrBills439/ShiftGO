'use client';
import { useState } from 'react';
import { GraduationCapIcon, PlusIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { FieldShell, Select as UiSelect, Input as UiInput, Textarea as UiTextarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  useUserTraining, useCreateTraining, useUpdateTraining,
  type Training, type TrainingStatus,
} from '@/hooks/useEmployeeCompliance';

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

const STATUSES: TrainingStatus[] = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'EXPIRED'];
const VARIANT: Record<TrainingStatus, 'success' | 'warning' | 'info' | 'danger'> = {
  COMPLETED: 'success', IN_PROGRESS: 'info', PENDING: 'warning', EXPIRED: 'danger',
};

type FormState = { title: string; description: string; status: TrainingStatus; completedAt: string; expiresAt: string };
const BLANK: FormState = { title: '', description: '', status: 'PENDING', completedAt: '', expiresAt: '' };

export function EmployeeTrainingTab({ userId, canManage }: { userId: string; canManage: boolean }) {
  const { data: rows = [], isLoading, isError } = useUserTraining(userId);
  const create = useCreateTraining(userId);
  const update = useUpdateTraining(userId);
  const toast = useToast();

  const [open, setOpen] = useState<null | { mode: 'create' } | { mode: 'edit'; row: Training }>(null);
  const [form, setForm] = useState<FormState>(BLANK);
  const pending = create.isPending || update.isPending;

  function startCreate() { setForm(BLANK); setOpen({ mode: 'create' }); }
  function startEdit(row: Training) {
    setForm({
      title: row.title,
      description: row.description ?? '',
      status: row.status,
      completedAt: toDateInput(row.completedAt),
      expiresAt: toDateInput(row.expiresAt),
    });
    setOpen({ mode: 'edit', row });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      status: form.status,
      completedAt: form.completedAt || null,
      expiresAt: form.expiresAt || null,
    };
    try {
      if (open?.mode === 'edit') await update.mutateAsync({ id: open.row.id, ...body });
      else await create.mutateAsync(body);
      setOpen(null);
      toast.success('Training record saved');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not save the training record');
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <GraduationCapIcon size={18} className="text-brand-600" />
        <h3 className="text-sm font-semibold text-fg">Training records</h3>
        {canManage && (
          <Button variant="primary" size="sm" className="ml-auto" icon={<PlusIcon size={14} />} onClick={startCreate}>
            Add Training
          </Button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-fg-muted">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-danger">Couldn’t load training records.</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={GraduationCapIcon}
          title="No training records"
          description="Add courses this employee has completed or needs to complete."
        />
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-fg">{t.title}</p>
                <p className="text-xs text-fg-muted">
                  Completed {fmt(t.completedAt)} · Expires {fmt(t.expiresAt)}
                </p>
              </div>
              <Badge variant={VARIANT[t.status]} label={t.status.replace('_', ' ')} />
              {canManage && (
                <button
                  onClick={() => startEdit(t)}
                  className="rounded p-1.5 text-fg-muted transition-colors hover:bg-brand-600/10 hover:text-brand-600"
                  aria-label={`Edit ${t.title}`}
                >
                  <PencilSimpleIcon size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.mode === 'edit' ? 'Edit training' : 'Add training'}>
        <form onSubmit={submit} className="space-y-4">
          <LoadingOverlay show={pending} label="Saving…" />
          <FieldShell label="Title *">
            <UiInput type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </FieldShell>
          <FieldShell label="Description">
            <UiTextarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </FieldShell>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FieldShell label="Status">
              <UiSelect value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TrainingStatus })}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Completed">
              <UiInput type="date" value={form.completedAt} onChange={(e) => setForm({ ...form, completedAt: e.target.value })} />
            </FieldShell>
            <FieldShell label="Expires">
              <UiInput type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </FieldShell>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={pending || form.title.trim().length < 2}>Save</Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
