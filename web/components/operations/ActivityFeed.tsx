'use client';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { Card } from '@/components/ui/Card';
import { CheckCircleIcon, UserPlusIcon, UserMinusIcon, ClockIcon, WarningCircleIcon, CheckIcon } from '@phosphor-icons/react';

interface ActivityEventProps {
  event: {
    id: string;
    type: string;
    actor?: { id: string; name: string };
    subject?: { id: string; name: string; type: string };
    action: string;
    description: string;
    timestamp: string;
  };
}

function getEventIcon(type: string) {
  const iconProps = { size: 18, weight: 'regular' as const };
  switch (type) {
    case 'shift_start':
      return <CheckCircleIcon {...iconProps} />;
    case 'shift_end':
      return <ClockIcon {...iconProps} />;
    case 'leave_approved':
      return <CheckCircleIcon {...iconProps} />;
    case 'leave_rejected':
      return <WarningCircleIcon {...iconProps} />;
    case 'user_created':
      return <UserPlusIcon {...iconProps} />;
    case 'user_deactivated':
      return <UserMinusIcon {...iconProps} />;
    case 'shift_cancelled':
      return <WarningCircleIcon {...iconProps} />;
    default:
      return <CheckIcon {...iconProps} />;
  }
}

function getEventColor(type: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (type) {
    case 'shift_start':
    case 'leave_approved':
    case 'user_created':
      return 'success';
    case 'shift_end':
    case 'leave_rejected':
    case 'shift_cancelled':
    case 'user_deactivated':
      return 'warning';
    default:
      return 'info';
  }
}

function ActivityEvent({ event }: ActivityEventProps) {
  const color = getEventColor(event.type);
  const colorMap = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    info: 'bg-info/10 text-info',
  };

  return (
    <div className="flex gap-3">
      <div className={`w-10 h-10 rounded-lg ${colorMap[color]} flex items-center justify-center flex-shrink-0`}>
        {getEventIcon(event.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-fg">{event.action}</p>
        <p className="text-xs text-fg-muted mt-1">{event.description}</p>
        <p className="text-xs text-fg-muted mt-1">
          {new Date(event.timestamp).toLocaleString('en-GB')}
        </p>
      </div>
    </div>
  );
}

interface ActivityFeedProps {
  limit?: number;
  title?: string;
}

export function ActivityFeed({ limit = 20, title = 'Recent Activity' }: ActivityFeedProps) {
  const { data: events = [], isLoading } = useActivityFeed(limit);

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      <Card className="p-4">
        {isLoading ? (
          <div className="text-center py-8">
            <div className="w-6 h-6 rounded-full border-2 border-neutral-200 border-t-primary animate-spin mx-auto" />
          </div>
        ) : events.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-fg-muted">No recent activity</p>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <div key={event.id}>
                <ActivityEvent event={event} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
