'use client';
import { useEffect, useRef, useState } from 'react';
import { PlusIcon, MegaphoneIcon, PushPinIcon, TrashIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { LoadingOverlay } from '@/components/ui/LoadingOverlay';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { FieldShell, Input, Textarea } from '@/components/ui/Input';
import { useAnnouncements, useCreateAnnouncement, useDeleteAnnouncement, useMarkAnnouncementRead } from '@/hooks/useAnnouncements';
import { useAuthStore } from '@/store/authStore';
import { useToast } from '@/hooks/useToast';
import { ROLE_META, initials } from '@/lib/roles';
import { clsx } from 'clsx';

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AnnouncementsPage() {
  const user = useAuthStore((s) => s.user);
  const toast = useToast();
  const canPost = ['HR', 'MANAGER'].includes(user?.role ?? '');

  const { data: announcements = [], isLoading } = useAnnouncements();
  const createAnnouncement = useCreateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();
  const markRead = useMarkAnnouncementRead();

  // Opening this page counts as reading — clear the unread markers so the
  // worker home / bell don't keep flagging announcements already seen here.
  const markedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const a of announcements) {
      if (a.read === false && !markedRef.current.has(a.id)) {
        markedRef.current.add(a.id);
        markRead.mutate(a.id);
      }
    }
  }, [announcements, markRead]);

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', pinned: false });
  const [error, setError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);

  function close() {
    setOpen(false);
    setForm({ title: '', body: '', pinned: false });
    setError('');
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await createAnnouncement.mutateAsync(form);
      toast.success('Announcement posted');
      close();
    } catch (e: any) {
      const fields = e.response?.data?.error?.fields;
      setError(fields ? Object.values(fields).join('. ') : e.response?.data?.message ?? 'Failed to post announcement');
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await deleteAnnouncement.mutateAsync(deleteTarget.id);
      toast.success('Announcement removed');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to remove announcement');
    }
  }

  return (
    <div>
      <Header
        title="Announcements"
        subtitle="Agency-wide updates and news"
        action={canPost && (
          <Button variant="primary" icon={<PlusIcon size={16} />} onClick={() => setOpen(true)}>
            New Announcement
          </Button>
        )}
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-surface p-4">
              <Skeleton className="h-4 w-40 mb-2" />
              <Skeleton className="h-3 w-full mb-1" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={MegaphoneIcon}
          title="No announcements yet"
          description={canPost ? 'Post an update for your team to see it here.' : 'Check back later for updates from your agency.'}
          action={canPost && <Button variant="primary" onClick={() => setOpen(true)}>New Announcement</Button>}
        />
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className={clsx('rounded-lg border bg-surface p-4', a.pinned ? 'border-brand-300 bg-brand-50/40' : 'border-border')}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    {a.pinned && <PushPinIcon size={14} weight="fill" className="text-brand-600" />}
                    <h3 className="font-semibold text-fg">{a.title}</h3>
                  </div>
                  <p className="text-sm text-fg-muted whitespace-pre-wrap">{a.body}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className={clsx('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0', ROLE_META[a.author.role].avatarClass)}>
                      {initials(a.author.name)}
                    </div>
                    <p className="text-xs text-fg-subtle">
                      {a.author.name} · {timeAgo(a.createdAt)}
                    </p>
                  </div>
                </div>
                {canPost && (
                  <button
                    onClick={() => setDeleteTarget({ id: a.id, title: a.title })}
                    className="p-1.5 rounded text-fg-muted hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0"
                    aria-label={`Delete ${a.title}`}
                    title="Delete announcement"
                  >
                    <TrashIcon size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onClose={close} title="New Announcement">
        <form onSubmit={handleCreate} className="space-y-4">
          <LoadingOverlay show={createAnnouncement.isPending} label="Posting…" />
          <FieldShell label="Title *">
            <Input
              type="text"
              placeholder="e.g. Bank holiday rota changes"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </FieldShell>
          <FieldShell label="Message *">
            <Textarea
              placeholder="Write your update…"
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              maxLength={3000}
              required
            />
          </FieldShell>
          <label className="flex items-center gap-2 text-sm text-fg-muted">
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(e) => setForm({ ...form, pinned: e.target.checked })}
              className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-600"
            />
            Pin to top
          </label>
          {error && (
            <div className="bg-danger/10 border border-danger/20 rounded-lg p-3 text-sm text-danger">{error}</div>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={createAnnouncement.isPending}>
              {createAnnouncement.isPending ? 'Posting…' : 'Post Announcement'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Announcement">
        <div className="space-y-4">
          <LoadingOverlay show={deleteAnnouncement.isPending} label="Deleting…" />
          <p className="text-sm text-fg-muted">
            Delete <span className="font-semibold text-fg">{deleteTarget?.title}</span>? This cannot be undone.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleteAnnouncement.isPending}>
              {deleteAnnouncement.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
