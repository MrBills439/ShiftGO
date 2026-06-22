'use client';
import { BellIcon, CheckCircleIcon, ClockCountdownIcon, CalendarBlankIcon, ShieldCheckIcon, InfoIcon } from '@phosphor-icons/react';
import { Header } from '@/components/layout/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { NotificationsSkeleton } from '@/components/ui/Skeleton';
import { useNotifications, useMarkRead, useMarkAllRead, type AppNotification } from '@/hooks/useNotifications';
import { useToast } from '@/hooks/useToast';
import { clsx } from 'clsx';

const TYPE_MAP: Record<string, { icon: React.ElementType; bg: string; color: string }> = {
  SHIFT_ASSIGNED:   { icon: CalendarBlankIcon, bg: 'bg-[#e3f0f8]', color: 'text-[#1a6b8a]' },
  SHIFT_REMOVED:    { icon: CalendarBlankIcon, bg: 'bg-error-container',  color: 'text-error-DEFAULT' },
  SHIFT_REMINDER:   { icon: ClockCountdownIcon, bg: 'bg-[#fff8e1]',  color: 'text-[#784a00]' },
  MISSED_CLOCK_IN:  { icon: ClockCountdownIcon, bg: 'bg-error-container', color: 'text-error-DEFAULT' },
  CLOCK_OUT_PROMPT: { icon: CheckCircleIcon,  bg: 'bg-[#e6f4f0]',   color: 'text-primary-DEFAULT' },
  GENERAL:          { icon: InfoIcon,          bg: 'bg-surface-high', color: 'text-on-surface-variant' },
};

function NotificationItem({ notif, onRead }: { notif: AppNotification; onRead: (id: string) => void }) {
  const t = TYPE_MAP[notif.type] ?? TYPE_MAP.GENERAL;
  const Icon = t.icon;

  return (
    <div
      className={clsx(
        'flex items-start gap-4 px-5 py-4 border-b border-outline-variant/30 last:border-0 transition-colors',
        !notif.read ? 'bg-[#f0faf7]' : 'bg-white hover:bg-surface-low/60'
      )}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${t.bg}`}>
        <Icon size={17} className={t.color} weight="regular" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p className={clsx('text-sm leading-snug', notif.read ? 'text-on-surface font-normal' : 'text-on-surface font-semibold')}>
            {notif.title}
          </p>
          {!notif.read && (
            <button
              onClick={() => onRead(notif.id)}
              className="text-[11px] text-primary-DEFAULT hover:underline font-inter flex-shrink-0"
            >
              Mark read
            </button>
          )}
        </div>
        <p className="text-xs text-on-surface-variant mt-0.5 leading-relaxed">{notif.body}</p>
        <p className="text-[11px] text-outline-DEFAULT font-inter mt-1.5">
          {new Date(notif.createdAt).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
          })}
        </p>
      </div>
      {!notif.read && <div className="w-2 h-2 rounded-full bg-primary-DEFAULT flex-shrink-0 mt-2" />}
    </div>
  );
}

export default function NotificationsPage() {
  const { data: notifs = [], isLoading } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();
  const toast = useToast();

  const unread = notifs.filter((n) => !n.read).length;

  function handleMarkRead(id: string) {
    markRead.mutate(id);
  }

  function handleMarkAll() {
    markAllRead.mutate(undefined, {
      onSuccess: () => toast.success('All notifications marked as read'),
      onError: () => toast.error('Failed to mark notifications as read'),
    });
  }

  return (
    <div>
      <Header
        title="Notifications"
        subtitle="Your alerts, shift updates, and system messages"
        action={unread > 0 && (
          <button onClick={handleMarkAll} disabled={markAllRead.isPending} className="btn-secondary">
            <CheckCircleIcon size={15} />
            {markAllRead.isPending ? 'Marking…' : `Mark all read (${unread})`}
          </button>
        )}
      />

      {isLoading ? (
        <NotificationsSkeleton count={6} />
      ) : notifs.length === 0 ? (
        <EmptyState
          icon={BellIcon}
          title="No notifications yet"
          description="Shift assignments, clock-in alerts, and timesheet confirmations will appear here."
        />
      ) : (
        <div className="glass-card overflow-hidden">
          {notifs.map((n) => (
            <NotificationItem key={n.id} notif={n} onRead={handleMarkRead} />
          ))}
        </div>
      )}
    </div>
  );
}
