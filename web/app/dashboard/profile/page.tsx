'use client';
import { useState } from 'react';
import {
  UserCircleIcon, EnvelopeIcon, PhoneIcon, MapPinIcon,
  PencilIcon, BookOpenIcon, ShieldCheckIcon, IdentificationCardIcon,
  CheckCircleIcon, ClockIcon, WarningCircleIcon,
} from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { useProfile, useUpdateProfile, useMyTraining, useMyDbs } from '@/hooks/useProfile';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { clsx } from 'clsx';

const ROLE_LABELS: Record<string, string> = {
  HR: 'HR / Super Admin',
  MANAGER: 'Manager',
  TEAM_LEADER: 'Team Leader',
  WORKER: 'Care Support Worker',
};

const TRAINING_STATUS_MAP = {
  COMPLETED:   { label: 'Completed',   color: 'bg-[#dcfce7] text-[#16a34a]',  icon: CheckCircleIcon },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-[#fff8e1] text-[#784a00]',  icon: ClockIcon },
  PENDING:     { label: 'Pending',     color: 'bg-surface-high text-on-surface-variant', icon: ClockIcon },
  EXPIRED:     { label: 'Expired',     color: 'bg-error-container text-error-DEFAULT', icon: WarningCircleIcon },
};

const DBS_STATUS_MAP = {
  CLEAR:   { label: 'Verified',  color: 'bg-[#e6f4f0] text-primary' },
  PENDING: { label: 'Pending',   color: 'bg-surface-high text-on-surface-variant' },
  FLAGGED: { label: 'Flagged',   color: 'bg-error-container text-error-DEFAULT' },
  EXPIRED: { label: 'Expired',   color: 'bg-[#fff8e1] text-[#784a00]' },
};

export default function ProfilePage() {
  const { user } = useAuthStore();
  const { data: profile, isLoading } = useProfile();
  const { data: trainings = [] } = useMyTraining();
  const { data: dbs } = useMyDbs();
  const updateProfile = useUpdateProfile();
  const toast = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', bio: '', address: '' });

  const displayUser = profile ?? user;
  const initials = displayUser?.name?.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase() ?? 'U';
  const roleLabel = ROLE_LABELS[displayUser?.role ?? ''] ?? displayUser?.role ?? 'Staff';

  const completedTraining = trainings.filter((t) => t.status === 'COMPLETED').length;
  const dbsInfo = dbs ? DBS_STATUS_MAP[dbs.status] ?? DBS_STATUS_MAP.PENDING : null;

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
    <div>
      <Header
        title="My Profile"
        subtitle="Manage your personal information and account details"
        action={
          <button onClick={openEdit} className="btn-secondary">
            <PencilIcon size={15} /> Edit Profile
          </button>
        }
      />

      <div className="grid lg:grid-cols-3 gap-6">
        {/* ── Left column: identity card ── */}
        <div className="lg:col-span-1 space-y-5">
          {/* Avatar + basic info */}
          <div className="glass-card p-6 flex flex-col items-center text-center">
            <div className="w-20 h-20 rounded-2xl bg-primary-DEFAULT flex items-center justify-center mb-4 flex-shrink-0">
              <span className="text-2xl font-bold text-white">{initials}</span>
            </div>
            <p className="text-lg font-bold text-on-surface">{displayUser?.name ?? '—'}</p>
            <p className="text-xs font-semibold text-primary mt-0.5 mb-3">{roleLabel}</p>

            <div className="w-full space-y-2 text-left">
              <div className="flex items-center gap-2.5 py-2 border-b border-outline-variant/30">
                <EnvelopeIcon size={14} className="text-on-surface-variant flex-shrink-0" />
                <p className="text-xs text-on-surface-variant font-inter truncate">{displayUser?.email ?? '—'}</p>
              </div>
              {profile?.phone && (
                <div className="flex items-center gap-2.5 py-2 border-b border-outline-variant/30">
                  <PhoneIcon size={14} className="text-on-surface-variant flex-shrink-0" />
                  <p className="text-xs text-on-surface-variant font-inter">{profile.phone}</p>
                </div>
              )}
              {profile?.address && (
                <div className="flex items-center gap-2.5 py-2">
                  <MapPinIcon size={14} className="text-on-surface-variant flex-shrink-0" />
                  <p className="text-xs text-on-surface-variant font-inter">{profile.address}</p>
                </div>
              )}
            </div>

            {profile?.bio && (
              <p className="text-xs text-on-surface-variant mt-4 pt-4 border-t border-outline-variant/30 w-full text-left leading-relaxed">
                {profile.bio}
              </p>
            )}
          </div>

          {/* Stats */}
          <div className="glass-card p-5">
            <h2 className="text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-4">Stats</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Trainings done', value: `${completedTraining}/${trainings.length}` },
                { label: 'DBS Status', value: dbsInfo?.label ?? 'Pending' },
                { label: 'Attendance', value: '98%' },
                { label: 'Rating', value: '4.9 ★' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-surface-low rounded-lg p-3 text-center">
                  <p className="text-base font-bold text-on-surface">{value}</p>
                  <p className="text-[10px] uppercase tracking-wider font-semibold text-on-surface-variant font-inter mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right column: training + DBS ── */}
        <div className="lg:col-span-2 space-y-5">
          {/* Training records */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#fff8e1] flex items-center justify-center flex-shrink-0">
                <BookOpenIcon size={18} className="text-[#784a00]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-on-surface">Training Records</h2>
                <p className="text-xs text-on-surface-variant font-inter">
                  {completedTraining} of {trainings.length} completed
                </p>
              </div>
            </div>

            {trainings.length === 0 ? (
              <p className="text-sm text-on-surface-variant text-center py-6">No training records assigned</p>
            ) : (
              <div className="space-y-0">
                {trainings.map((t) => {
                  const sm = TRAINING_STATUS_MAP[t.status] ?? TRAINING_STATUS_MAP.PENDING;
                  const StatusIcon = sm.icon;
                  return (
                    <div key={t.id} className="flex items-center justify-between py-3 border-b border-outline-variant/30 last:border-0">
                      <div className="flex items-center gap-3">
                        <StatusIcon size={15} className={t.status === 'COMPLETED' ? 'text-[#16a34a]' : 'text-on-surface-variant'} weight={t.status === 'COMPLETED' ? 'fill' : 'regular'} />
                        <div>
                          <p className="text-sm font-medium text-on-surface">{t.title}</p>
                          {t.description && <p className="text-xs text-on-surface-variant font-inter mt-0.5">{t.description}</p>}
                        </div>
                      </div>
                      <span className={clsx('px-2.5 py-1 rounded-full text-[11px] font-semibold font-inter', sm.color)}>
                        {sm.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* DBS Check */}
          <div className="glass-card p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-lg bg-[#dcfce7] flex items-center justify-center flex-shrink-0">
                <IdentificationCardIcon size={18} className="text-[#16a34a]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-on-surface">DBS Check</h2>
                <p className="text-xs text-on-surface-variant font-inter">Disclosure and Barring Service</p>
              </div>
              {dbsInfo && (
                <span className={clsx('ml-auto px-2.5 py-1 rounded-full text-[11px] font-semibold font-inter', dbsInfo.color)}>
                  {dbsInfo.label}
                </span>
              )}
            </div>

            {!dbs ? (
              <div className="flex items-start gap-3 p-3 bg-surface-low rounded-lg">
                <ShieldCheckIcon size={16} className="text-on-surface-variant flex-shrink-0 mt-0.5" />
                <p className="text-xs text-on-surface-variant leading-relaxed">
                  No DBS record on file. Contact your HR administrator to submit your DBS check.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5 text-sm">
                {[
                  ['Reference',   dbs.reference ?? '—'],
                  ['Issued',      dbs.issuedAt ? new Date(dbs.issuedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'],
                  ['Expires',     dbs.expiresAt ? new Date(dbs.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between py-2 border-b border-outline-variant/30 last:border-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-inter">{label}</p>
                    <p className="text-xs text-on-surface font-inter">{value}</p>
                  </div>
                ))}
                {dbs.notes && (
                  <p className="text-xs text-on-surface-variant pt-2 leading-relaxed">{dbs.notes}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit profile modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Profile">
        <form onSubmit={handleSave} className="space-y-4">
          {[
            ['name',    'Full Name',   'text',  'Jane Smith'],
            ['phone',   'Phone',       'tel',   '+44 7700 900000'],
            ['address', 'Address',     'text',  '12 Oak Street, London'],
          ].map(([field, label, type, placeholder]) => (
            <div key={field}>
              <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">
                {label}
              </label>
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
            <label className="block text-xs font-semibold tracking-wider uppercase text-on-surface-variant font-inter mb-1.5">Bio</label>
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
