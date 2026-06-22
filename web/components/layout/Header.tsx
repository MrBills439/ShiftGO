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
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">{title}</h1>
        {subtitle && <p className="text-sm text-on-surface-variant mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        {action}
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
            className="relative p-2 rounded-lg text-on-surface-variant hover:bg-surface-low transition-colors"
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
