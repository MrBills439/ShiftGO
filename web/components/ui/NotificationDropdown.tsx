'use client';
import { useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  CalendarBlankIcon, ClockCountdownIcon, CheckCircleIcon,
  InfoIcon, XIcon, ArrowRightIcon,
} from '@phosphor-icons/react';
import { clsx } from 'clsx';
import { useNotifications, useMarkRead, useMarkAllRead, type AppNotification } from '@/hooks/useNotifications';
import { NotificationsSkeleton } from './Skeleton';

const TYPE_ICON: Record<string, { icon: React.ElementType; bg: string; color: string }> = {
  SHIFT_ASSIGNED:   { icon: CalendarBlankIcon,  bg: 'bg-[#e3f0f8]',      color: 'text-[#1a6b8a]' },
  SHIFT_REMOVED:    { icon: CalendarBlankIcon,  bg: 'bg-error-container', color: 'text-error-DEFAULT' },
  SHIFT_REMINDER:   { icon: ClockCountdownIcon, bg: 'bg-[#fff8e1]',       color: 'text-[#784a00]' },
  MISSED_CLOCK_IN:  { icon: ClockCountdownIcon, bg: 'bg-error-container', color: 'text-error-DEFAULT' },
  CLOCK_OUT_PROMPT: { icon: CheckCircleIcon,    bg: 'bg-[#e6f4f0]',       color: 'text-primary' },
  GENERAL:          { icon: InfoIcon,           bg: 'bg-surface-high',    color: 'text-on-surface-variant' },
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${d}d ago`;
}

interface Props {
  onClose: () => void;
}

export function NotificationDropdown({ onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { data: notifs = [], isLoading } = useNotifications();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const unread = notifs.filter((n) => !n.read).length;
  const recent = notifs.slice(0, 8);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  function handleMarkRead(id: string) {
    markRead.mutate(id);
  }

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-2 w-[380px] bg-white rounded-xl border border-[#E1F5EE] shadow-[0_16px_48px_rgba(26,34,50,0.14)] z-[200] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/30">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-on-surface">Notifications</p>
          {unread > 0 && (
            <span className="min-w-[18px] h-[18px] rounded-full bg-error-DEFAULT text-white text-[9px] font-bold flex items-center justify-center px-1">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button
              onClick={() => markAllRead.mutate(undefined)}
              disabled={markAllRead.isPending}
              className="text-[11px] text-primary hover:underline font-inter disabled:opacity-50"
            >
              Mark all read
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-low transition-colors"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="p-3">
            <NotificationsSkeleton count={4} />
          </div>
        ) : recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-surface-low flex items-center justify-center mb-3">
              <CheckCircleIcon size={20} className="text-outline" weight="regular" />
            </div>
            <p className="text-sm font-medium text-on-surface">All caught up</p>
            <p className="text-xs text-on-surface-variant mt-1">No notifications yet.</p>
          </div>
        ) : (
          recent.map((n) => <NotifRow key={n.id} notif={n} onRead={handleMarkRead} />)
        )}
      </div>

      {/* Footer */}
      {notifs.length > 0 && (
        <div className="border-t border-outline-variant/30">
          <Link
            href="/dashboard/notifications"
            onClick={onClose}
            className="flex items-center justify-center gap-1.5 py-3 text-xs font-semibold text-primary hover:bg-[#f0faf7] transition-colors"
          >
            View all notifications
            <ArrowRightIcon size={13} weight="bold" />
          </Link>
        </div>
      )}
    </div>
  );
}

function NotifRow({ notif, onRead }: { notif: AppNotification; onRead: (id: string) => void }) {
  const t = TYPE_ICON[notif.type] ?? TYPE_ICON.GENERAL;
  const Icon = t.icon;

  return (
    <div
      className={clsx(
        'flex items-start gap-3 px-4 py-3 border-b border-outline-variant/20 last:border-0 transition-colors',
        !notif.read ? 'bg-[#f8fdfb]' : 'hover:bg-surface-low/50'
      )}
    >
      {!notif.read && <div className="w-1.5 h-1.5 rounded-full bg-primary-DEFAULT flex-shrink-0 mt-2" />}
      {notif.read && <div className="w-1.5 flex-shrink-0" />}

      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${t.bg}`}>
        <Icon size={15} className={t.color} weight="regular" />
      </div>

      <div className="flex-1 min-w-0">
        <p className={clsx('text-xs leading-snug', notif.read ? 'text-on-surface' : 'text-on-surface font-semibold')}>
          {notif.title}
        </p>
        <p className="text-[11px] text-on-surface-variant mt-0.5 leading-relaxed line-clamp-2">
          {notif.body}
        </p>
        <p className="text-[10px] text-outline font-inter mt-1">{timeAgo(notif.createdAt)}</p>
      </div>

      {!notif.read && (
        <button
          onClick={() => onRead(notif.id)}
          className="text-[10px] text-outline hover:text-primary flex-shrink-0 mt-0.5 font-inter"
        >
          Mark read
        </button>
      )}
    </div>
  );
}
