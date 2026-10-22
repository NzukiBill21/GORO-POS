import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  CheckCheck,
  Check,
  Package,
  Clock,
  CreditCard,
  Database,
  AlertCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime, cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const TYPE_CONFIG: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary'; icon: typeof Bell }> = {
  LOW_STOCK: { label: 'Low Stock', variant: 'warning', icon: Package },
  EXPIRY: { label: 'Expiry', variant: 'destructive', icon: Clock },
  REFUND: { label: 'Refund', variant: 'secondary', icon: CreditCard },
  PAYMENT: { label: 'Payment', variant: 'success', icon: CreditCard },
  BACKUP: { label: 'Backup', variant: 'default', icon: Database },
  SYSTEM: { label: 'System', variant: 'secondary', icon: AlertCircle },
};

function getTypeConfig(type: string) {
  return TYPE_CONFIG[type] ?? { label: type, variant: 'secondary' as const, icon: Bell };
}

export default function NotificationsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canView = can('notifications.view');

  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['notifications-unread-count'],
    queryFn: () => api.get('/notifications/unread-count'),
    enabled: canView,
    refetchInterval: 30000,
  });

  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<PaginatedResult<Notification>>({
    queryKey: ['notifications', page, unreadOnly],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
      });
      if (unreadOnly) params.set('unreadOnly', 'true');
      return api.get(`/notifications?${params}`);
    },
    enabled: canView,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const unreadCount = unreadData?.count ?? 0;
  const notifications = data?.data ?? [];
  const pagination = data?.pagination;

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Bell}
          title="Access Denied"
          description="You don't have permission to view notifications."
        />
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Notifications"
        description="View alerts for stock, expiry, and system events."
        icon={Bell}
        actions={
          unreadCount > 0 ? (
            <Button
              variant="outline"
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              {markAllReadMutation.isPending ? 'Marking...' : 'Mark All Read'}
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center gap-3 mb-6">
        <Button
          variant={!unreadOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setUnreadOnly(false); setPage(1); }}
        >
          All
        </Button>
        <Button
          variant={unreadOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setUnreadOnly(true); setPage(1); }}
        >
          Unread
          {unreadCount > 0 && (
            <Badge variant="destructive" className="ml-2 px-1.5 py-0">
              {unreadCount}
            </Badge>
          )}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-sm" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          icon={Bell}
          title="Failed to load notifications"
          description={error.message}
          action={{ label: 'Try Again', onClick: () => refetch() }}
        />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={unreadOnly ? 'No unread notifications' : 'No notifications'}
          description={
            unreadOnly
              ? 'You are all caught up!'
              : 'Alerts for stock, expiry, and system events will appear here.'
          }
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const config = getTypeConfig(notification.type);
            const Icon = config.icon;

            return (
              <Card
                key={notification.id}
                className={cn(
                  'transition-colors',
                  !notification.isRead && 'border-primary/30 bg-primary/5'
                )}
              >
                <CardContent className="flex items-start gap-4 py-4">
                  <div className={cn(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                    notification.isRead ? 'bg-muted' : 'bg-primary/10'
                  )}>
                    <Icon className={cn('h-5 w-5', notification.isRead ? 'text-muted-foreground' : 'text-primary')} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <p className={cn('font-medium', !notification.isRead && 'text-foreground')}>
                        {notification.title}
                      </p>
                      <Badge variant={config.variant}>{config.label}</Badge>
                      {!notification.isRead && (
                        <Badge variant="default">New</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{notification.message}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDateTime(notification.createdAt)}
                    </p>
                  </div>

                  {!notification.isRead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => markReadMutation.mutate(notification.id)}
                      disabled={markReadMutation.isPending}
                      title="Mark as read"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-6 text-sm text-muted-foreground">
          <span>{pagination.total} notifications</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>Page {page} of {pagination.totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
