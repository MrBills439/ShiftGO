'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsClockwiseIcon, HandHeartIcon, CheckIcon, XIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import {
  usePendingShiftChanges, useApproveShiftChange, useRejectShiftChange,
  type ShiftChangeRequest, type ShiftChangeShift,
} from '@/hooks/useShiftChange';

const TABS = [
  { key: 'PENDING_MANAGER', label: 'Pending approval' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
] as const;

function fmtShift(s: ShiftChangeShift | null) {
  if (!s) return '—';
  const d = new Date(s.startTime);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const start = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const end = new Date(s.endTime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${day} ${start}–${end} · ${s.house?.name ?? 'a service'}`;
}

function OverBadge({ req }: { req: ShiftChangeRequest }) {
  const over = Object.values(req.projectedHours ?? {}).some((p) => p.exceedsMax);
  if (!over) return null;
  return <Badge variant="warning" label="Weekly limit" />;
}

function RequestCard({ req, tab }: { req: ShiftChangeRequest; tab: string }) {
  const toast = useToast();
  const approve = useApproveShiftChange();
  const reject = useRejectShiftChange();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  const needsOverride = Object.values(req.projectedHours ?? {}).some((p) => p.exceedsMax);
  const isPending = tab === 'PENDING_MANAGER';

  async function onApprove() {
    try {
      await approve.mutateAsync({
        id: req.id,
        overrideWeeklyHours: needsOverride ? override : undefined,
        overrideReason: needsOverride && override ? overrideReason.trim() : undefined,
      });
      toast.success('Shift change approved');
    } catch (e: any) {
      const code = e?.response?.data?.code;
      if (code === 'APPROVAL_REQUIRED' || code === 'OVERRIDE_REASON_REQUIRED') {
        setOverride(true);
        toast.error('This exceeds the weekly hours limit — tick the override and give a reason.');
      } else {
        toast.error(e?.response?.data?.message ?? 'Could not approve');
      }
    }
  }

  async function onReject() {
    try {
      await reject.mutateAsync({ id: req.id, reason: reason.trim() || undefined });
      toast.success('Request rejected');
      setRejecting(false);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not reject');
    }
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {req.type === 'SWAP'
            ? <ArrowsClockwiseIcon size={18} className="text-primary" />
            : <HandHeartIcon size={18} className="text-primary" />}
          <span className="text-sm font-semibold text-on-surface">{req.type === 'SWAP' ? 'Shift swap' : 'Shift cover'}</span>
          <OverBadge req={req} />
          {req.expired && <Badge variant="danger" label="Shift started" />}
        </div>
        <span className="text-xs text-on-surface-variant font-inter">
          {new Date(req.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>

      <div className="mt-3 grid gap-1.5 text-sm">
        <p><span className="text-on-surface-variant">Requester:</span> <span className="font-medium">{req.requester?.name ?? '—'}</span></p>
        <p><span className="text-on-surface-variant">Recipient:</span> <span className="font-medium">{req.targetWorker?.name ?? '—'}</span></p>
        <p><span className="text-on-surface-variant">{req.type === 'SWAP' ? `${req.requester?.name}'s shift` : 'Shift'}:</span> {fmtShift(req.primaryShift)}</p>
        {req.type === 'SWAP' && (
          <p><span className="text-on-surface-variant">{req.targetWorker?.name}'s shift:</span> {fmtShift(req.swapShift)}</p>
        )}
        {req.requesterReason && (
          <p className="text-on-surface-variant italic">“{req.requesterReason}”</p>
        )}
      </div>

      {isPending && req.projectedHours && (
        <div className="mt-3 rounded-lg bg-surface-high p-3 text-xs font-inter space-y-1">
          {Object.entries(req.projectedHours).map(([wid, p]) => (
            <div key={wid} className="flex items-center justify-between">
              <span className="text-on-surface-variant">
                {wid === req.targetWorker?.id ? req.targetWorker?.name : req.requester?.name} projected week
              </span>
              <span className={p.exceedsMax ? 'font-semibold text-warning' : 'font-medium'}>
                {p.projectedHours}h / {p.maxWeeklyScheduledHours}h
              </span>
            </div>
          ))}
        </div>
      )}

      {isPending && !req.expired && (
        <div className="mt-4 space-y-2">
          {needsOverride && (
            <label className="flex items-start gap-2 text-xs text-on-surface-variant">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
              <span>Override the weekly hours limit for this approval</span>
            </label>
          )}
          {needsOverride && override && (
            <input
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Reason for the override (required)"
              className="input-field w-full text-sm"
            />
          )}
          {!rejecting ? (
            <div className="flex gap-2">
              <Button
                variant="primary" size="sm" icon={<CheckIcon size={15} />}
                disabled={approve.isPending || (needsOverride && override && overrideReason.trim().length < 3)}
                onClick={onApprove}
              >
                {approve.isPending ? 'Approving…' : 'Approve'}
              </Button>
              <Button variant="secondary" size="sm" icon={<XIcon size={15} />} onClick={() => setRejecting(true)}>
                Reject
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)" className="input-field flex-1 text-sm"
              />
              <Button variant="primary" size="sm" disabled={reject.isPending} onClick={onReject}>Confirm reject</Button>
              <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>Cancel</Button>
            </div>
          )}
        </div>
      )}

      {!isPending && (
        <p className="mt-3 text-xs text-on-surface-variant">
          {req.status === 'APPROVED' ? 'Approved' : 'Rejected'}
          {req.managerReason ? ` — “${req.managerReason}”` : ''}
        </p>
      )}
    </Card>
  );
}

export default function ShiftRequestsPage() {
  const { user, isLoading } = useAuthStore();
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('PENDING_MANAGER');
  const { data, isLoading: loading } = usePendingShiftChanges(tab);

  useEffect(() => {
    if (!isLoading && user && !['HR', 'MANAGER'].includes(user.role)) router.replace('/dashboard');
  }, [user, isLoading, router]);

  if (isLoading || !user) return null;
  if (!['HR', 'MANAGER'].includes(user.role)) return null;

  const items = data?.items ?? [];

  return (
    <div>
      <Header title="Shift Requests" subtitle="Cover and swap requests from your team" />

      <div className="flex gap-1 mb-5 border-b border-outline-variant/40">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-on-surface-variant">Loading…</p>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-on-surface-variant">
          No {TABS.find((t) => t.key === tab)?.label.toLowerCase()} requests.
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {items.map((req) => <RequestCard key={req.id} req={req} tab={tab} />)}
        </div>
      )}
    </div>
  );
}
