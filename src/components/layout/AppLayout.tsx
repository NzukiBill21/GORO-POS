import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Bell, LogOut, Command } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { CommandPalette } from '@/components/CommandPalette';
import { api } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { OwnerSetupBanner } from '@/components/onboarding/OwnerSetupBanner';

export function AppLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const { user, logout, isAuthenticated, accessToken, authReady } = useAuthStore();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const isPosRoute = location.pathname.startsWith('/pos');

  const notificationsEnabled =
    authReady && isAuthenticated && !!accessToken && can('notifications.view');

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ['notifications-unread'],
    queryFn: () => api.get('/notifications/unread-count'),
    enabled: notificationsEnabled,
    refetchInterval: notificationsEnabled ? 60_000 : false,
    retry: false,
    refetchOnWindowFocus: notificationsEnabled,
  });

  const initials = user
    ? `${user.firstName[0]}${user.lastName[0]}`.toUpperCase()
    : 'U';

  const unreadCount = unreadData?.count ?? 0;

  useGlobalShortcuts(() => setCommandOpen(true));

  const showManagerNotifications =
    can('notifications.view') &&
    (user?.role?.toLowerCase() === 'manager' || user?.role?.toLowerCase() === 'administrator');

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {!isPosRoute && (
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      )}

      <div className="flex flex-1 flex-col overflow-hidden min-h-0">
        <header className="flex h-16 shrink-0 items-center justify-between border-b bg-card px-6">
          {!isPosRoute && (
            <div className="flex items-center gap-4 flex-1 max-w-md">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search products, customers, sales..."
                  className="pl-9 bg-background"
                  onFocus={() => setCommandOpen(true)}
                  readOnly
                />
              </div>
              <Button variant="outline" size="sm" className="hidden md:flex gap-2 text-muted-foreground" onClick={() => setCommandOpen(true)}>
                <Command className="h-3 w-3" />
                <kbd className="text-xs">Ctrl+K</kbd>
              </Button>
            </div>
          )}
          {isPosRoute && <div className="flex-1" />}

          <div className="flex items-center gap-3">
            {showManagerNotifications && (
              <Button variant="ghost" size="icon" className="relative" onClick={() => navigate('/notifications')}>
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-destructive text-[10px] font-bold text-white flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </Button>
            )}

            <div className="flex items-center gap-3 border-l pl-3">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-medium">{user?.firstName} {user?.lastName}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
              </div>
              <Avatar>
                <AvatarFallback className="bg-primary/10 text-primary text-sm">{initials}</AvatarFallback>
              </Avatar>
              <Button variant="ghost" size="icon" onClick={() => { logout(); navigate('/login'); }}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        <main
          className={cn(
            'flex-1 min-h-0',
            isPosRoute ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden scrollbar-thin'
          )}
        >
          {!isPosRoute && (
            <div className="p-4 pb-0 max-w-6xl mx-auto w-full">
              <OwnerSetupBanner />
            </div>
          )}
          <Outlet />
        </main>
      </div>

      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}
