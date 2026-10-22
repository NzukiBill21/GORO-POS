import { useQuery } from '@tanstack/react-query';
import {
  DollarSign,
  TrendingUp,
  Package,
  AlertTriangle,
  ShoppingBag,
  Wallet,
  BarChart3,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import { api } from '@/lib/api';
import { formatCurrency, formatDateTime, formatCurrencyCompact } from '@/lib/utils';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/QueryState';
import { PageContainer } from '@/components/shared/PageContainer';
import { Link } from 'react-router-dom';
import { usePermissions } from '@/hooks/usePermissions';

interface DashboardStats {
  todaySales: number;
  todayOrders: number;
  todayProfit: number;
  weekSales: number;
  monthSales: number;
  inventoryValue: number;
  totalProducts: number;
  cashInDrawer: number;
  lowStock: Array<{ id: string; name: string; sku?: string; stock: number; minStock: number }>;
  topProducts: Array<{ id: string; name: string; quantity: number; revenue: number }>;
  recentTransactions: Array<{
    id: string;
    invoiceNumber: string;
    total: number;
    customer: string;
    cashier: string;
    createdAt: string;
  }>;
  chartData: Array<{ date: string; sales: number; orders: number }>;
}

interface BackupStatus {
  lastBackupAt: string | null;
  backupCount: number;
}

export default function DashboardPage() {
  const { can } = usePermissions();
  const canViewBackups = can('security.view');

  const { data: backupStatus } = useQuery<BackupStatus>({
    queryKey: ['backup-status'],
    queryFn: () => api.get('/security/backups/status'),
    enabled: canViewBackups,
    refetchInterval: canViewBackups ? 120000 : false,
  });

  const { data, isLoading, isError, error, refetch } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get('/dashboard/stats'),
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <PageContainer className="p-6">
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-sm" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-80 rounded-sm" />
            <Skeleton className="h-80 rounded-sm" />
          </div>
        </div>
      </PageContainer>
    );
  }

  if (isError || !data) {
    return (
      <PageContainer className="p-6">
        <ErrorState
          title="Could not load dashboard"
          message={error instanceof Error ? error.message : 'The API server may be offline. Run npm run dev:web, then refresh.'}
          onRetry={() => refetch()}
        />
      </PageContainer>
    );
  }

  const stats = data;

  return (
    <PageContainer className="p-6 space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back! Here&apos;s your business overview.</p>
      </div>

      {backupStatus && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Local backup</CardTitle>
          </CardHeader>
          <CardContent className="text-sm flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {backupStatus.lastBackupAt
                ? `Last backup ${formatDateTime(backupStatus.lastBackupAt)} · ${backupStatus.backupCount} on file`
                : 'No backups yet — close a cash shift or run backup in Settings.'}
            </span>
            <Link to="/diagnostics" className="text-primary underline-offset-4 hover:underline">
              Diagnostics
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Today's Sales"
          value={stats.todaySales}
          format="currency"
          subtitle={`${stats.todayOrders} orders`}
          icon={DollarSign}
          variant="default"
        />
        <StatCard
          title="Today's Profit"
          value={stats.todayProfit}
          format="currency"
          icon={TrendingUp}
          variant="success"
        />
        <StatCard
          title="Weekly Sales"
          value={stats.weekSales}
          format="currency"
          icon={BarChart3}
        />
        <StatCard
          title="Monthly Sales"
          value={stats.monthSales}
          format="currency"
          icon={ShoppingBag}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Inventory Value"
          value={stats.inventoryValue}
          format="currency"
          subtitle={`${stats.totalProducts} products`}
          icon={Package}
        />
        <StatCard
          title="Cash in Drawer"
          value={stats.cashInDrawer}
          format="currency"
          icon={Wallet}
          variant="success"
        />
        <StatCard
          title="Low Stock Items"
          value={stats.lowStock.length}
          format="number"
          icon={AlertTriangle}
          variant={stats.lowStock.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          title="Top Product Sales"
          value={stats.topProducts[0]?.quantity ?? 0}
          format="number"
          subtitle={stats.topProducts[0]?.name ?? 'No sales yet'}
          icon={TrendingUp}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={stats.chartData}>
                <defs>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { weekday: 'short' })}
                  className="text-xs"
                />
                <YAxis tickFormatter={(v) => formatCurrencyCompact(v)} className="text-xs" />
                <Tooltip
                  formatter={(value: number) => [formatCurrency(value), 'Sales']}
                  labelFormatter={(label) => new Date(label).toLocaleDateString()}
                />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="#2563EB"
                  fill="url(#salesGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders Chart</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { weekday: 'short' })}
                  className="text-xs"
                />
                <YAxis className="text-xs" />
                <Tooltip labelFormatter={(label) => new Date(label).toLocaleDateString()} />
                <Bar dataKey="orders" fill="#2563EB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-sm">{tx.invoiceNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {tx.customer} · {tx.cashier}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-sm">{formatCurrency(tx.total)}</p>
                    <p className="text-xs text-muted-foreground">{formatDateTime(tx.createdAt)}</p>
                  </div>
                </div>
              ))}
              {stats.recentTransactions.length === 0 && (
                <p className="text-center text-muted-foreground py-8">No transactions yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Low Stock Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.lowStock.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg bg-warning/5 p-2.5">
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </div>
                    <span className="text-sm font-bold text-warning">{item.stock} left</span>
                  </div>
                ))}
                {stats.lowStock.length === 0 && (
                  <p className="text-center text-muted-foreground py-4 text-sm">All stock levels OK</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Best Selling Products</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {stats.topProducts.map((product, i) => (
                  <div key={product.id} className="flex items-center gap-3 rounded-lg p-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.quantity} sold</p>
                    </div>
                    <span className="text-sm font-semibold">{formatCurrency(product.revenue)}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
