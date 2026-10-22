import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Download,
  FileJson,
  DollarSign,
  Package,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { exportToCSV, exportToJSON } from '@/lib/permissions';
import { formatCurrency, formatDate, formatDateTime, cn } from '@/lib/utils';
import { formatPaymentMethod } from '@/lib/paymentMethods';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable, Column } from '@/components/shared/DataTable';

type ReportType = 'sales' | 'inventory' | 'profit';

interface InventoryRow {
  name: string;
  sku?: string;
  category?: string;
  costPrice: number;
  sellingPrice: number;
  stock: number;
  value: number;
  minStock: number;
}

interface SalesReport {
  sales: Array<{
    id: string;
    invoiceNumber: string;
    total: number;
    subtotal: number;
    createdAt: string;
    customer?: { firstName: string; lastName: string };
    user?: { firstName: string; lastName: string };
  }>;
  summary: {
    totalSales: number;
    totalOrders: number;
    avgOrder: number;
    byPayment: Record<string, number>;
    byDay: Record<string, number>;
  };
}

interface ProfitReport {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  profit: number;
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

export default function ReportsPage() {
  const { can } = usePermissions();
  const canView = can('reports.view');

  const defaults = getDefaultDateRange();
  const [reportType, setReportType] = useState<ReportType>('sales');
  const [startDate, setStartDate] = useState(defaults.startDate);
  const [endDate, setEndDate] = useState(defaults.endDate);
  const [generated, setGenerated] = useState(false);
  const [dateError, setDateError] = useState('');

  const {
    data: salesData,
    isLoading: salesLoading,
    error: salesError,
    refetch: refetchSales,
    isFetching: salesFetching,
  } = useQuery<SalesReport>({
    queryKey: ['report-sales', startDate, endDate],
    queryFn: () =>
      api.get(`/reports/sales?startDate=${startDate}&endDate=${endDate}`),
    enabled: canView && generated && reportType === 'sales',
  });

  const {
    data: inventoryData,
    isLoading: inventoryLoading,
    error: inventoryError,
    refetch: refetchInventory,
    isFetching: inventoryFetching,
  } = useQuery<InventoryRow[]>({
    queryKey: ['report-inventory'],
    queryFn: () => api.get('/reports/inventory'),
    enabled: canView && generated && reportType === 'inventory',
  });

  const {
    data: profitData,
    isLoading: profitLoading,
    error: profitError,
    refetch: refetchProfit,
    isFetching: profitFetching,
  } = useQuery<ProfitReport>({
    queryKey: ['report-profit', startDate, endDate],
    queryFn: () =>
      api.get(`/reports/profit?startDate=${startDate}&endDate=${endDate}`),
    enabled: canView && generated && reportType === 'profit',
  });

  const isLoading =
    (reportType === 'sales' && salesLoading) ||
    (reportType === 'inventory' && inventoryLoading) ||
    (reportType === 'profit' && profitLoading);

  const isFetching =
    (reportType === 'sales' && salesFetching) ||
    (reportType === 'inventory' && inventoryFetching) ||
    (reportType === 'profit' && profitFetching);

  const error =
    (reportType === 'sales' && salesError?.message) ||
    (reportType === 'inventory' && inventoryError?.message) ||
    (reportType === 'profit' && profitError?.message) ||
    null;

  const handleGenerate = () => {
    if (reportType !== 'inventory') {
      if (!startDate || !endDate) {
        setDateError('Start and end dates are required.');
        return;
      }
      if (new Date(startDate) > new Date(endDate)) {
        setDateError('Start date must be before end date.');
        return;
      }
    }
    setDateError('');
    setGenerated(true);
    if (reportType === 'sales') refetchSales();
    else if (reportType === 'inventory') refetchInventory();
    else refetchProfit();
  };

  const handleExportCSV = () => {
    if (reportType === 'sales' && salesData) {
      exportToCSV(
        salesData.sales.map((s) => ({
          invoice: s.invoiceNumber,
          total: s.total,
          subtotal: s.subtotal,
          customer: s.customer ? `${s.customer.firstName} ${s.customer.lastName}` : 'Walk-in',
          cashier: s.user ? `${s.user.firstName} ${s.user.lastName}` : '',
          date: formatDateTime(s.createdAt),
        })),
        `sales-report-${startDate}-${endDate}`,
        [
          { key: 'invoice', label: 'Invoice' },
          { key: 'total', label: 'Total' },
          { key: 'subtotal', label: 'Subtotal' },
          { key: 'customer', label: 'Customer' },
          { key: 'cashier', label: 'Cashier' },
          { key: 'date', label: 'Date' },
        ]
      );
    } else if (reportType === 'inventory' && inventoryData) {
      exportToCSV(
        inventoryData.map((r) => ({
          name: r.name,
          sku: r.sku ?? '',
          category: r.category ?? '',
          stock: r.stock,
          minStock: r.minStock,
          costPrice: r.costPrice,
          sellingPrice: r.sellingPrice,
          value: r.value,
        })),
        'inventory-report',
        [
          { key: 'name', label: 'Product' },
          { key: 'sku', label: 'SKU' },
          { key: 'category', label: 'Category' },
          { key: 'stock', label: 'Stock' },
          { key: 'minStock', label: 'Min Stock' },
          { key: 'costPrice', label: 'Cost Price' },
          { key: 'sellingPrice', label: 'Selling Price' },
          { key: 'value', label: 'Value' },
        ]
      );
    } else if (reportType === 'profit' && profitData) {
      exportToCSV(
        [
          {
            revenue: profitData.revenue,
            cogs: profitData.cogs,
            grossProfit: profitData.grossProfit,
            expenses: profitData.expenses,
            profit: profitData.profit,
            period: `${startDate} to ${endDate}`,
          },
        ],
        `profit-report-${startDate}-${endDate}`,
        [
          { key: 'period', label: 'Period' },
          { key: 'revenue', label: 'Revenue' },
          { key: 'cogs', label: 'COGS' },
          { key: 'grossProfit', label: 'Gross profit' },
          { key: 'expenses', label: 'Operating expenses' },
          { key: 'profit', label: 'Net profit' },
        ]
      );
    }
  };

  const handleExportJSON = () => {
    if (reportType === 'sales' && salesData) {
      exportToJSON([salesData], `sales-report-${startDate}-${endDate}`);
    } else if (reportType === 'inventory' && inventoryData) {
      exportToJSON(inventoryData, 'inventory-report');
    } else if (reportType === 'profit' && profitData) {
      exportToJSON([{ ...profitData, startDate, endDate }], `profit-report-${startDate}-${endDate}`);
    }
  };

  const hasExportData =
    (reportType === 'sales' && salesData?.sales.length) ||
    (reportType === 'inventory' && inventoryData?.length) ||
    (reportType === 'profit' && profitData);

  const inventoryColumns: Column<InventoryRow>[] = [
    { key: 'name', label: 'Product' },
    { key: 'sku', label: 'SKU', render: (r) => r.sku ?? '—' },
    { key: 'category', label: 'Category', render: (r) => r.category ?? '—' },
    {
      key: 'stock',
      label: 'Stock',
      render: (r) => (
        <Badge variant={r.stock <= r.minStock ? 'warning' : 'success'}>
          {r.stock}
        </Badge>
      ),
    },
    { key: 'costPrice', label: 'Cost', render: (r) => formatCurrency(r.costPrice) },
    { key: 'sellingPrice', label: 'Price', render: (r) => formatCurrency(r.sellingPrice) },
    { key: 'value', label: 'Value', render: (r) => formatCurrency(r.value) },
  ];

  const tabs: { id: ReportType; label: string; icon: typeof BarChart3 }[] = [
    { id: 'sales', label: 'Sales', icon: DollarSign },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'profit', label: 'Profit', icon: TrendingUp },
  ];

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={BarChart3}
          title="Access Denied"
          description="You don't have permission to view reports."
        />
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Reports"
        description="Generate and export business reports."
        icon={BarChart3}
        actions={
          generated && hasExportData ? (
            <>
              <Button variant="outline" onClick={handleExportCSV}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={handleExportJSON}>
                <FileJson className="h-4 w-4 mr-2" />
                Export JSON
              </Button>
            </>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-2 mb-6">
            {tabs.map(({ id, label, icon: Icon }) => (
              <Button
                key={id}
                variant={reportType === id ? 'default' : 'outline'}
                onClick={() => { setReportType(id); setGenerated(false); }}
              >
                <Icon className="h-4 w-4 mr-2" />
                {label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-4">
            {reportType !== 'inventory' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="startDate">Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-44"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">End Date</Label>
                  <Input
                    id="endDate"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-44"
                  />
                </div>
              </>
            )}

            <Button onClick={handleGenerate} disabled={isFetching}>
              {isFetching ? (
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <BarChart3 className="h-4 w-4 mr-2" />
              )}
              Generate Report
            </Button>
          </div>

          {dateError && (
            <p className="text-sm text-destructive mt-3">{dateError}</p>
          )}
        </CardContent>
      </Card>

      {!generated ? (
        <EmptyState
          icon={BarChart3}
          title="No report generated"
          description="Select a report type, set your date range, and click Generate Report."
        />
      ) : isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-sm" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-sm" />
        </div>
      ) : error ? (
        <EmptyState
          icon={BarChart3}
          title="Failed to load report"
          description={error}
          action={{ label: 'Try Again', onClick: handleGenerate }}
        />
      ) : reportType === 'sales' && salesData ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Sales</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(salesData.summary.totalSales)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{salesData.summary.totalOrders}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Order Value</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{formatCurrency(salesData.summary.avgOrder)}</p>
              </CardContent>
            </Card>
          </div>

          {Object.keys(salesData.summary.byPayment).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Payment Methods</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {Object.entries(salesData.summary.byPayment).map(([method, amount]) => (
                    <div key={method} className="rounded-lg border px-4 py-2">
                      <p className="text-xs text-muted-foreground">{formatPaymentMethod(method)}</p>
                      <p className="font-semibold">{formatCurrency(amount)}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <DataTable
            columns={[
              { key: 'invoiceNumber', label: 'Invoice' },
              {
                key: 'customer',
                label: 'Customer',
                render: (r) =>
                  r.customer ? `${r.customer.firstName} ${r.customer.lastName}` : 'Walk-in',
              },
              {
                key: 'user',
                label: 'Cashier',
                render: (r) =>
                  r.user ? `${r.user.firstName} ${r.user.lastName}` : '—',
              },
              {
                key: 'total',
                label: 'Total',
                render: (r) => formatCurrency(r.total),
              },
              {
                key: 'createdAt',
                label: 'Date',
                render: (r) => formatDateTime(r.createdAt),
              },
            ]}
            data={salesData.sales}
            emptyTitle="No sales in this period"
            rowKey={(r) => r.id}
          />
        </div>
      ) : reportType === 'inventory' && inventoryData ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Products</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{inventoryData.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Stock Value</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {formatCurrency(inventoryData.reduce((s, r) => s + r.value, 0))}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">Low Stock Items</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {inventoryData.filter((r) => r.stock <= r.minStock).length}
                </p>
              </CardContent>
            </Card>
          </div>

          <DataTable
            columns={inventoryColumns}
            data={inventoryData}
            emptyTitle="No inventory data"
            rowKey={(r) => r.sku ?? r.name}
          />
        </div>
      ) : reportType === 'profit' && profitData ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 max-w-5xl">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-success">{formatCurrency(profitData.revenue)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {formatDate(startDate)} – {formatDate(endDate)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">COGS</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(profitData.cogs)}</p>
              <p className="text-xs text-muted-foreground mt-1">From sale line cost at checkout</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Gross profit</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatCurrency(profitData.grossProfit)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Operating expenses</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">{formatCurrency(profitData.expenses)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Net profit</CardTitle>
            </CardHeader>
            <CardContent>
              <p className={cn('text-2xl font-bold', profitData.profit >= 0 ? 'text-success' : 'text-destructive')}>
                {formatCurrency(profitData.profit)}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
