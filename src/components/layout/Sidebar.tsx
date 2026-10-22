import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Warehouse,
  Users,
  Receipt,
  Truck,
  DollarSign,
  UserCog,
  BarChart3,
  Bell,
  Settings,
  CreditCard,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { TenantBrandMark } from '@/components/shared/TenantBrandMark';
import { useAuthStore } from '@/stores/authStore';
import { cn } from '@/lib/utils';
import { themeLabel, useThemeStore } from '@/stores/themeStore';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', permission: 'dashboard.view' },
  { to: '/pos', icon: ShoppingCart, label: 'Sell', permission: 'pos.access' },
  { to: '/products', icon: Package, label: 'Products', permission: 'products.view' },
  { to: '/inventory', icon: Warehouse, label: 'Stock levels', permission: 'inventory.view' },
  { to: '/customers', icon: Users, label: 'Customers', permission: 'customers.view' },
  { to: '/sales', icon: Receipt, label: 'Sales history', permission: 'sales.view' },
  { to: '/purchases', icon: Truck, label: 'Receive stock', permission: 'purchases.view' },
  { to: '/financials', icon: DollarSign, label: 'Financials', permission: 'financials.view' },
  { to: '/payments/manual', icon: CreditCard, label: 'M-Pesa review', permission: 'reports.financial' },
  { to: '/employees', icon: UserCog, label: 'Staff', permission: 'staff.view' },
  { to: '/reports', icon: BarChart3, label: 'Reports', permission: 'reports.view' },
  { to: '/billing', icon: CreditCard, label: 'Billing', permission: 'billing.view' },
  { to: '/notifications', icon: Bell, label: 'Notifications', permission: 'notifications.view' },
  { to: '/settings', icon: Settings, label: 'Settings', permission: 'settings.view' },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const { theme, cycleTheme } = useThemeStore();
  const { can } = usePermissions();
  const { user } = useAuthStore();

  const visibleItems = navItems.filter((item) => can(item.permission));

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          'flex h-full flex-col border-r bg-card transition-all duration-300',
          collapsed ? 'w-[68px]' : 'w-64'
        )}
      >
        <div className="flex h-16 items-center gap-3 border-b px-4">
          <TenantBrandMark variant="sidebar" />
          {!collapsed && (
            <div className="overflow-hidden">
              <h1 className="truncate text-sm font-bold">Goro</h1>
              <p className="truncate text-xs text-muted-foreground">{user?.branchName ?? 'Your store'}</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3 scrollbar-thin">
          {visibleItems.map((item) => {
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname.startsWith(item.to);

            const link = (
              <NavLink
                key={item.to}
                to={item.to}
                className={cn(
                  'flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>{link}</TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              );
            }

            return link;
          })}
        </nav>

        <div className="border-t p-3 space-y-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => cycleTheme()}
          >
            {theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : theme === 'system' ? '🖥️' : '◆'}
            {!collapsed && <span className="ml-2">{themeLabel(theme)} theme</span>}
          </Button>
          <Button variant="ghost" size="icon" className="w-full" onClick={onToggle}>
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </Button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
