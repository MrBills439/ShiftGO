'use client';
import { useState } from 'react';
import { MegaphoneIcon, PushPinIcon } from '@phosphor-icons/react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useUnreadAnnouncements, useMarkAnnouncementRead } from '@/hooks/useAnnouncements';
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

export function AnnouncementsPopup() {
  const { data: unread = [] } = useUnreadAnnouncements();
  const markRead = useMarkAnnouncementRead();
  const [dismissed, setDismissed] = useState(false);
  const [closing, setClosing] = useState(false);

  const open = !dismissed && unread.length > 0;

  function handleClose() {
    if (closing) return;
    setClosing(true);
    Promise.all(unread.map((a) => markRead.mutateAsync(a.id)))
      .catch(() => {})
      .finally(() => {
        setDismissed(true);
        setClosing(false);
      });
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={unread.length === 1 ? 'New Announcement' : `${unread.length} New Announcements`}
      width="max-w-xl"
    >
      <div className="space-y-4 max-h-[60vh] overflow-y-auto -mr-2 pr-2">
        {unread.map((a) => (
          <div key={a.id} className={clsx('rounded-lg border p-4', a.pinned ? 'border-brand-300 bg-brand-50/40' : 'border-border')}>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {a.pinned && <PushPinIcon size={13} weight="fill" className="text-brand-600" />}
              <h3 className="font-semibold text-fg text-sm">{a.title}</h3>
            </div>
            <p className="text-sm text-fg-muted whitespace-pre-wrap">{a.body}</p>
            <div className="mt-3 flex items-center gap-2">
              <div className={clsx('w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold flex-shrink-0', ROLE_META[a.author.role].avatarClass)}>
                {initials(a.author.name)}
              </div>
              <p className="text-xs text-fg-subtle">{a.author.name} · {timeAgo(a.createdAt)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 pt-4 mt-1 border-t border-border">
        <div className="flex items-center gap-1.5 text-xs text-fg-subtle">
          <MegaphoneIcon size={14} />
          Agency-wide update
        </div>
        <Button variant="primary" onClick={handleClose} disabled={closing}>
          {closing ? 'Closing…' : 'Got it'}
        </Button>
      </div>
    </Modal>
  );
}
