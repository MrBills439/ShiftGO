'use client';
import { Fragment, useRef, useState } from 'react';
import Link from 'next/link';
import {
  EnvelopeIcon, PhoneIcon, MapPinIcon, PencilIcon, CameraIcon,
  BookOpenIcon, ShieldCheckIcon, IdentificationCardIcon, UserIcon,
  CheckCircleIcon, ClockIcon, WarningCircleIcon, CaretRightIcon, CalendarDotsIcon,
} from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { LeaveBalanceCard } from '@/components/leave/LeaveBalanceCard';
import { useProfile, useUpdateProfile, useUploadAvatar, useMyTraining, useMyDbs } from '@/hooks/useProfile';
import { useMyTimesheets } from '@/hooks/useTimesheets';
import { useLeaveBalance } from '@/hooks/useLeaveRequests';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { API_BASE } from '@/lib/api';
import { clsx } from 'clsx';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function avatarUrl(path?: string | null) {
  if (!path) return null;
  return path.startsWith('http') ? path : `${API_BASE}${path}`;
}

function hoursWorkedThisMonth(timesheets: { totalHours: number | null; clockInAt: string | null; status: string }[]) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  return Math.round(
    timesheets
      .filter((t) => t.status !== 'REJECTED' && t.clockInAt && new Date(t.clockInAt).getTime() >= monthStart)
      .reduce((sum, t) => sum + (t.totalHours || 0), 0) * 10
  ) / 10;
}

const ROLE_LABELS: Record<string, string> = {
  HR: 'HR / Super Admin',
  MANAGER: 'Manager',
  TEAM_LEADER: 'Team Leader',
  WORKER: 'Care Support Worker',
};

const TRAINING_STATUS_MAP = {
  COMPLETED:   { label: 'Completed',   color: 'bg-success-bg text-success-text',  icon: CheckCircleIcon },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-warning-bg text-warning-text',  icon: ClockIcon },
  PENDING:     { label: 'Pending',     color: 'bg-surface-high text-fg-muted',    icon: ClockIcon },
  EXPIRED:     { label: 'Expired',     color: 'bg-danger-bg text-danger-text',    icon: WarningCircleIcon },
};

const DBS_STATUS_MAP = {
  CLEAR:   { label: 'Verified', color: 'bg-brand-50 text-brand-700' },
  PENDING: { label: 'Pending',  color: 'bg-surface-high text-fg-muted' },
  FLAGGED: { label: 'Flagged',  color: 'bg-danger-bg text-danger-text' },
  EXPIRED: { label: 'Expired',  color: 'bg-warning-bg text-warning-text' },
};

// ─── Sectioned menu row (mirrors the mobile profile) ─────────────────────────
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-widest text-fg-subtle">{label}</p>
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">{children}</div>
    </div>
  );
}

function ActionRow({
  icon, iconClass, title, subtitle, badge, href, onClick, last,
}: {
  icon: React.ReactNode;
  iconClass: string;
  title: string;
  subtitle: string;
  badge?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  last?: boolean;
}) {
  const inner = (
    <>
      <span className={clsx('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', iconClass)}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        <span className="block truncate text-xs text-fg-muted">{subtitle}</span>
      </span>
      {badge}
      <CaretRightIcon size={15} weight="bold" className="flex-shrink-0 text-fg-subtle" />
    </>
  );
  const cls = clsx(
    'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-subtle',
    !last && 'border-b border-border'
  );
  return href
    ? <Link href={href} className={cls}>{inner}</Link>
    : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}

export default function ProfilePage() {
  const { user } = useAuthStore();
  const { data: profile } = useProfile();
  const { data: trainings = [] } = useMyTraining();
  const { data: dbs } = useMyDbs();
  const { data: timesheets = [] } = useMyTimesheets();
  const { data: leaveBalance, isLoading: leaveBalanceLoading } = useLeaveBalance();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useUploadAvatar();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', bio: '', address: '' });

  const displayUser = profile ?? user;
  const initials = displayUser?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U';
  const roleLabel = ROLE_LABELS[displayUser?.role ?? ''] ?? displayUser?.role ?? 'Staff';
  const photo = avatarUrl(profile?.profilePicture);

  function pickAvatar() {
    fileInputRef.current?.click();
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Image must be 5MB or smaller');
      return;
    }
    try {
      await uploadAvatar.mutateAsync(file);
      toast.success('Photo updated');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Failed to upload photo');
    }
  }

  const completedTraining = trainings.filter((t) => t.status === 'COMPLETED').length;
  const dbsInfo = dbs ? DBS_STATUS_MAP[dbs.status] ?? DBS_STATUS_MAP.PENDING : null;
  const monthHours = hoursWorkedThisMonth(timesheets as any);
  const leaveConfigured = !!leaveBalance?.hasConfiguredProfile;
  const leaveValue = leaveConfigured
    ? `${Number.isInteger(leaveBalance!.netUsableBalance) ? leaveBalance!.netUsableBalance : leaveBalance!.netUsableBalance.toFixed(1)}h`
    : '—';

  const stats = [
    { label: 'Leave balance', value: leaveValue },
    { label: 'Hours this month', value: `${monthHours}h` },
    { label: 'Trainings', value: `${completedTraining}/${trainings.length}` },
    { label: 'DBS status', value: dbsInfo?.label ?? 'Pending' },
  ];

  function openEdit() {
    setForm({
      name:    profile?.name    ?? '',
      phone:   profile?.phone   ?? '',
      bio:     profile?.bio     ?? '',
      address: profile?.address ?? '',
    });
    setEditOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await updateProfile.mutateAsync({
        name:    form.name    || undefined,
        phone:   form.phone   || undefined,
        bio:     form.bio     || undefined,
        address: form.address || undefined,
      });
      setEditOpen(false);
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Header
        title="My Profile"
        subtitle="Manage your personal information and account"
        action={
          <button onClick={openEdit} className="btn-secondary">
            <PencilIcon size={15} /> Edit
          </button>
        }
      />

      <div className="space-y-6">
        {/* ── Identity card ── */}
        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="flex items-start gap-4">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <button
              type="button"
              onClick={pickAvatar}
              disabled={uploadAvatar.isPending}
              className="group relative flex-shrink-0 rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-600/25 disabled:opacity-60"
              aria-label="Change profile photo"
            >
              {photo ? (
                <img src={photo} alt="" className="h-16 w-16 rounded-2xl object-cover" />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600">
                  <span className="text-xl font-bold text-white">{initials}</span>
                </div>
              )}
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-lg border-2 border-surface bg-brand-600">
                <CameraIcon size={11} className="text-white" weight="fill" />
              </span>
              <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                {uploadAvatar.isPending && (
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-base font-bold text-fg">{displayUser?.name ?? '—'}</p>
                  <p className="text-xs font-semibold text-brand-700">{roleLabel}</p>
                </div>
                <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-1 text-[11px] font-semibold text-success-text">
                  <span className="h-1.5 w-1.5 rounded-full bg-success-solid" />
                  Active
                </span>
              </div>

              <div className="mt-3 space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-fg-muted">
                  <EnvelopeIcon size={13} className="flex-shrink-0" />
                  <span className="truncate">{displayUser?.email ?? '—'}</span>
                </div>
                {profile?.phone && (
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <PhoneIcon size={13} className="flex-shrink-0" />
                    <span>{profile.phone}</span>
                  </div>
                )}
                {profile?.address && (
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <MapPinIcon size={13} className="flex-shrink-0" />
                    <span>{profile.address}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {profile?.bio && (
            <p className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-fg-muted">{profile.bio}</p>
          )}
        </div>

        {/* ── Stats strip ── */}
        <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 px-4 py-5">
          <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/5" />
          <div className="pointer-events-none absolute -bottom-10 -left-6 h-24 w-24 rounded-full bg-white/5" />
          <div className="relative flex items-center">
            {stats.map((s, i) => (
              <Fragment key={s.label}>
                <div className="flex-1 text-center">
                  <p className="text-lg font-bold tracking-tight text-white">{s.value}</p>
                  <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-white/60">{s.label}</p>
                </div>
                {i < stats.length - 1 && <div className="h-9 w-px bg-white/15" />}
              </Fragment>
            ))}
          </div>
        </div>

        {/* ── Work ── */}
        <Section label="Work">
          <ActionRow
            icon={<UserIcon size={18} className="text-brand-700" />}
            iconClass="bg-brand-50"
            title="Personal Information"
            subtitle="Name, phone, address and bio"
            onClick={openEdit}
          />
          <ActionRow
            icon={<CalendarDotsIcon size={18} className="text-brand-700" />}
            iconClass="bg-brand-50"
            title="Time Off"
            subtitle={leaveConfigured ? `${leaveValue} available · book and track leave` : 'Book and track your leave'}
            href="/dashboard/leave"
            last
          />
        </Section>

        {/* ── Training records ── */}
        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-warning-bg">
              <BookOpenIcon size={18} className="text-warning-text" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg">Training Records</h2>
              <p className="text-xs text-fg-muted">{completedTraining} of {trainings.length} completed</p>
            </div>
          </div>

          {trainings.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">No training records assigned</p>
          ) : (
            <div>
              {trainings.map((t) => {
                const sm = TRAINING_STATUS_MAP[t.status] ?? TRAINING_STATUS_MAP.PENDING;
                const StatusIcon = sm.icon;
                return (
                  <div key={t.id} className="flex items-center justify-between border-b border-border py-3 last:border-0">
                    <div className="flex items-center gap-3">
                      <StatusIcon
                        size={15}
                        className={t.status === 'COMPLETED' ? 'text-success-solid' : 'text-fg-subtle'}
                        weight={t.status === 'COMPLETED' ? 'fill' : 'regular'}
                      />
                      <div>
                        <p className="text-sm font-medium text-fg">{t.title}</p>
                        {t.description && <p className="mt-0.5 text-xs text-fg-muted">{t.description}</p>}
                      </div>
                    </div>
                    <span className={clsx('rounded-full px-2.5 py-1 text-[11px] font-semibold', sm.color)}>{sm.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── DBS check ── */}
        <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50">
              <IdentificationCardIcon size={18} className="text-brand-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-fg">DBS Check</h2>
              <p className="text-xs text-fg-muted">Disclosure and Barring Service</p>
            </div>
            {dbsInfo && (
              <span className={clsx('ml-auto rounded-full px-2.5 py-1 text-[11px] font-semibold', dbsInfo.color)}>
                {dbsInfo.label}
              </span>
            )}
          </div>

          {!dbs ? (
            <div className="flex items-start gap-3 rounded-lg bg-surface-subtle p-3">
              <ShieldCheckIcon size={16} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
              <p className="text-xs leading-relaxed text-fg-muted">
                No DBS record on file. Contact your HR administrator to submit your DBS check.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {[
                ['Reference', dbs.reference ?? '—'],
                ['Issued', dbs.issuedAt ? new Date(dbs.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'],
                ['Expires', dbs.expiresAt ? new Date(dbs.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between border-b border-border py-2 last:border-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{label}</p>
                  <p className="text-xs text-fg">{value}</p>
                </div>
              ))}
              {dbs.notes && <p className="pt-2 text-xs leading-relaxed text-fg-muted">{dbs.notes}</p>}
            </div>
          )}
        </div>

        {/* ── Leave balance breakdown ── */}
        <div>
          <p className="mb-2 ml-1 text-[11px] font-semibold uppercase tracking-widest text-fg-subtle">Leave balance</p>
          <LeaveBalanceCard balance={leaveBalance} isLoading={leaveBalanceLoading} />
        </div>
      </div>

      {/* Edit profile modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Profile">
        <form onSubmit={handleSave} className="space-y-4">
          {[
            ['name', 'Full Name', 'text', 'Jane Smith'],
            ['phone', 'Phone', 'tel', '+44 7700 900000'],
            ['address', 'Address', 'text', '12 Oak Street, London'],
          ].map(([field, label, type, placeholder]) => (
            <div key={field}>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">{label}</label>
              <input
                type={type}
                placeholder={placeholder}
                className="input-field"
                value={(form as any)[field]}
                onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              />
            </div>
          ))}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-fg-muted">Bio</label>
            <textarea
              rows={3}
              placeholder="Tell us a bit about yourself…"
              className="input-field resize-none"
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setEditOpen(false)} className="btn-secondary flex-1 justify-center">Cancel</button>
            <button type="submit" disabled={updateProfile.isPending} className="btn-primary flex-1 justify-center">
              {updateProfile.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
