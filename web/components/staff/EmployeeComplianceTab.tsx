'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheckIcon, IdentificationCardIcon, ArrowSquareOutIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { FieldShell, Select as UiSelect, Input as UiInput, Textarea as UiTextarea } from '@/components/ui/Input';
import { useToast } from '@/hooks/useToast';
import {
  useUserRightToWork, useUserDbs, useUpsertDbs,
  type DbsStatus,
} from '@/hooks/useEmployeeCompliance';

const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

const RTW_VARIANT = { CURRENT: 'success', STALE: 'warning', MISSING: 'danger' } as const;
const DBS_VARIANT: Record<DbsStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  CLEAR: 'success', PENDING: 'warning', FLAGGED: 'danger', EXPIRED: 'danger',
};
const DBS_STATUSES: DbsStatus[] = ['PENDING', 'CLEAR', 'FLAGGED', 'EXPIRED'];

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-fg-muted">{label}</span>
      <span className="text-right font-medium text-fg">{value || '—'}</span>
    </div>
  );
}

export function EmployeeComplianceTab({ userId, isHr }: { userId: string; isHr: boolean }) {
  const rtw = useUserRightToWork(userId);
  const dbs = useUserDbs(userId);
  const upsertDbs = useUpsertDbs(userId);
  const toast = useToast();

  const [dbsOpen, setDbsOpen] = useState(false);
  const [form, setForm] = useState({ status: 'PENDING' as DbsStatus, reference: '', issuedAt: '', expiresAt: '', notes: '' });

  function openDbs() {
    setForm({
      status: (dbs.data?.status ?? 'PENDING') as DbsStatus,
      reference: dbs.data?.reference ?? '',
      issuedAt: toDateInput(dbs.data?.issuedAt),
      expiresAt: toDateInput(dbs.data?.expiresAt),
      notes: dbs.data?.notes ?? '',
    });
    setDbsOpen(true);
  }

  async function saveDbs(e: React.FormEvent) {
    e.preventDefault();
    try {
      await upsertDbs.mutateAsync({
        status: form.status,
        reference: form.reference.trim() || null,
        issuedAt: form.issuedAt || null,
        expiresAt: form.expiresAt || null,
        notes: form.notes.trim() || null,
      });
      setDbsOpen(false);
      toast.success('DBS record updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Could not update the DBS record');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Right to Work ── */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheckIcon size={18} className="text-brand-600" />
          <h3 className="text-sm font-semibold text-fg">Right to Work</h3>
          {rtw.data && (
            <span className="ml-auto">
              <Badge variant={RTW_VARIANT[rtw.data.status]} label={rtw.data.status} />
            </span>
          )}
        </div>
        {rtw.isLoading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : rtw.isError ? (
          <p className="text-sm text-danger">Couldn’t load the Right to Work record.</p>
        ) : (
          <div className="divide-y divide-border/60">
            <Row label="Share code" value={rtw.data?.code ? '•••• on file' : 'Not provided'} />
            <Row label="Share date" value={fmt(rtw.data?.shareDate)} />
            <Row label="Proof document" value={rtw.data?.hasDocument ? (rtw.data.documentName ?? 'On file') : 'None'} />
            {rtw.data?.status === 'STALE' && rtw.data?.daysUntilStale != null && (
              <Row label="Re-check" value="Overdue — needs a fresh share code" />
            )}
            {rtw.data?.updatedBy?.name && <Row label="Last updated by" value={`${rtw.data.updatedBy.name} · ${fmt(rtw.data.updatedAt)}`} />}
          </div>
        )}
        <div className="mt-4">
          <Link
            href="/dashboard/right-to-work"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
          >
            Manage Right to Work <ArrowSquareOutIcon size={14} />
          </Link>
        </div>
      </Card>

      {/* ── DBS ── */}
      <Card className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <IdentificationCardIcon size={18} className="text-brand-600" />
          <h3 className="text-sm font-semibold text-fg">DBS Check</h3>
          {dbs.data && (
            <span className="ml-auto">
              <Badge variant={DBS_VARIANT[dbs.data.status]} label={dbs.data.status} />
            </span>
          )}
        </div>
        {dbs.isLoading ? (
          <p className="text-sm text-fg-muted">Loading…</p>
        ) : dbs.isError ? (
          <p className="text-sm text-danger">Couldn’t load the DBS record.</p>
        ) : !dbs.data ? (
          <div>
            <p className="text-sm text-fg-muted">No DBS record on file.</p>
            {isHr && (
              <Button variant="secondary" size="sm" className="mt-3" onClick={openDbs}>Add DBS record</Button>
            )}
          </div>
        ) : (
          <>
            <div className="divide-y divide-border/60">
              <Row label="Reference" value={dbs.data.reference} />
              <Row label="Issued" value={fmt(dbs.data.issuedAt)} />
              <Row label="Expires" value={fmt(dbs.data.expiresAt)} />
              {dbs.data.notes && <Row label="Notes" value={dbs.data.notes} />}
            </div>
            {isHr && (
              <Button variant="secondary" size="sm" className="mt-4" icon={<PencilSimpleIcon size={14} />} onClick={openDbs}>
                Edit DBS
              </Button>
            )}
          </>
        )}
      </Card>

      {/* ── Edit DBS modal (HR only) ── */}
      <Modal open={dbsOpen} onClose={() => setDbsOpen(false)} title="DBS record">
        <form onSubmit={saveDbs} className="space-y-4">
          <LoadingOverlay show={upsertDbs.isPending} label="Saving…" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldShell label="Status">
              <UiSelect value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as DbsStatus })}>
                {DBS_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </UiSelect>
            </FieldShell>
            <FieldShell label="Reference">
              <UiInput type="text" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
            </FieldShell>
            <FieldShell label="Issued date">
              <UiInput type="date" value={form.issuedAt} onChange={(e) => setForm({ ...form, issuedAt: e.target.value })} />
            </FieldShell>
            <FieldShell label="Expiry date">
              <UiInput type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
            </FieldShell>
          </div>
          <FieldShell label="Notes">
            <UiTextarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </FieldShell>
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={() => setDbsOpen(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={upsertDbs.isPending}>Save</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
