'use client';
import { useMemo, useState } from 'react';
import { XIcon, CheckIcon, CheckCircleIcon, BellIcon } from '@phosphor-icons/react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useNotifications, useUnreadCount, useMarkRead, useMarkAllRead } from '@/hooks/useNotifications';

type CategoryFilter = 'all' | 'shift' | 'leave' | 'attendance' | 'system' | 'emergency';
type PriorityFilter = 'all' | 'low' | 'medium' | 'high' | 'critical';

export function NotificationCentre() {
  const { data: notifications = [] } = useNotifications();
  const { data: unreadCount = 0 } = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      const matchCategory = categoryFilter === 'all' || n.type === categoryFilter;
      const matchPriority = priorityFilter === 'all' || n.data?.priority === priorityFilter;
      const matchSearch = searchTerm === '' ||
        n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        n.body.toLowerCase().includes(searchTerm.toLowerCase());
      return matchCategory && matchPriority && matchSearch;
    });
  }, [notifications, categoryFilter, priorityFilter, searchTerm]);

  const getCategoryLabel = (type: string) => {
    const labels: Record<string, string> = {
      shift: 'Shift',
      leave: 'Leave',
      attendance: 'Attendance',
      system: 'System',
      emergency: 'Emergency',
    };
    return labels[type] || type;
  };

  const getPriorityColor = (priority: string): 'danger' | 'warning' | 'info' | 'success' => {
    switch (priority) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return 'info';
      default: return 'success';
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Notifications</h1>
        {unreadCount > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
          >
            Mark all read
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div>
          <p className="text-xs font-semibold text-fg-muted uppercase mb-2">Category</p>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'shift', 'leave', 'attendance', 'system', 'emergency'] as const).map((cat) => (
              <Button
                key={cat}
                size="sm"
                variant={categoryFilter === cat ? 'primary' : 'secondary'}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat === 'all' ? 'All' : getCategoryLabel(cat)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-fg-muted uppercase mb-2">Priority</p>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'low', 'medium', 'high', 'critical'] as const).map((pri) => (
              <Button
                key={pri}
                size="sm"
                variant={priorityFilter === pri ? 'primary' : 'secondary'}
                onClick={() => setPriorityFilter(pri)}
              >
                {pri === 'all' ? 'All' : pri.charAt(0).toUpperCase() + pri.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div>
          <input
            type="text"
            placeholder="Search notifications…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Notifications List */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <Card className="p-8 text-center">
            <BellIcon size={32} className="mx-auto text-fg-muted mb-3" weight="regular" />
            <p className="text-fg font-medium">No notifications</p>
            <p className="text-sm text-fg-muted mt-1">You're all caught up</p>
          </Card>
        ) : (
          filtered.map((n) => (
            <Card
              key={n.id}
              className={`p-4 cursor-pointer transition-colors ${!n.read ? 'bg-primary/5 border-primary/20' : 'hover:bg-neutral-50'}`}
              onClick={() => !n.read && markRead.mutate(n.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-semibold text-fg">{n.title}</p>
                    <Badge
                      variant={getPriorityColor(n.data?.priority as string || 'low')}
                      label={String(n.data?.priority || 'Low')}
                      dot={false}
                    />
                    <Badge
                      variant="info"
                      label={getCategoryLabel(n.type)}
                      dot={false}
                    />
                  </div>
                  <p className="text-sm text-fg-muted">{n.body}</p>
                  <p className="text-xs text-fg-muted mt-2">
                    {new Date(n.createdAt).toLocaleString('en-GB')}
                  </p>
                </div>
                {!n.read && (
                  <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                )}
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
