'use client';
import { useState } from 'react';
import { BellIcon } from '@phosphor-icons/react';
import { useUnreadCount } from '@/hooks/useNotifications';
import { NotificationDropdown } from '@/components/ui/NotificationDropdown';

interface Props {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function Header({ title, subtitle, action }: Props) {
  const { data: unreadCount = 0 } = useUnreadCount();
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6 flex items-start justify-between gap-4 border-b border-border pb-5">
      <div>
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {action}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
            className="relative rounded-md p-2 text-fg-muted transition-colors hover:bg-surface-subtle focus-visible:ring-4 focus-visible:ring-brand-600/20"
          >
            <BellIcon size={20} weight="regular" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[17px] h-[17px] rounded-full bg-error-DEFAULT text-white text-[9px] font-bold flex items-center justify-center px-1 leading-none border-2 border-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          {open && <NotificationDropdown onClose={() => setOpen(false)} />}
        </div>
      </div>
    </div>
  );
}
