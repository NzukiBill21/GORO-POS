import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt,
  Download,
  XCircle,
  Calendar,
  CreditCard,
  Banknote,
  User,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import { exportToCSV } from '@/lib/permissions';
import { useDebounce } from '@/hooks/useDebounce';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

type SaleTab = 'all' | 'held' | 'completed';

interface SaleItem {
  id: string;
  name: string;
  sku?: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxAmount: number;
  total: number;
}

interface Payment {
  id: string;
  method: string;
  amount: number;
  reference?: string | null;
}

interface Sale {
  id: string;
  invoiceNumber: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  amountPaid: number;
  changeAmount: number;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  customer?: { firstName: string; lastName?: string | null } | null;
  user?: { firstName: string; lastName: string };
  items?: SaleItem[];
  payments?: Payment[];
}

interface SaleDetail extends Sale {
  items: SaleItem[];
  payments: Payment[];
  discounts?: Array<{ id: string; name: string; amount: number }>;
}

interface PaginatedSales {
  data: Sale[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const TABS: { id: SaleTab; label: string }[] = [
  { id: 'all', label: 'All Sales' },
  { id: 'held', label: 'Held' },
  { id: 'completed', label: 'Completed' },
];

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'HELD', label: 'Held' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'RETURNED', label: 'Returned' },
  { value: 'DRAFT', label: 'Draft' },
];

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'COMPLETED': return 'success';
    case 'HELD': return 'warning';
    case 'CANCELLED': return 'destructive';
    case 'RETURNED': return 'secondary';
    default: return 'default';
  }
}

function customerLabel(customer?: Sale['customer']) {
  if (!customer) return 'Walk-in';
  return [customer.firstName, customer.lastName].filter(Boolean).join(' ');
}

function cashierLabel(user?: Sale['user']) {
  if (!user) return '—';
  return `${user.firstName} ${user.lastName}`;
}

function paymentIcon(method: string) {
  switch (method) {
    case 'CARD': return CreditCard;
    default: return Banknote;
  }
}

export default function SalesPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<SaleTab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const debouncedSearch = useDebounce(search);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Sale | null>(null);
  const [exporting, setExporting] = useState(false);

  const canView = can('sales.view');
  const canEdit = can('sales.edit');

  const listStatus = useMemo(() => {
    if (tab === 'completed') return 'COMPLETED';
    if (tab === 'held') return undefined;
    return statusFilter !== 'ALL' ? statusFilter : undefined;
  }, [tab, statusFilter]);

  const { data, isLoading, error, refetch } = useQuery<PaginatedSales | Sale[]>({
    queryKey: ['sales', tab, page, debouncedSearch, sortBy, sortOrder, listStatus, startDate, endDate],
    queryFn: async () => {
      if (tab === 'held') {
        return api.get<Sale[]>('/sales/held');
      }
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (listStatus) params.set('status', listStatus);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      return api.get<PaginatedSales>(`/sales?${params}`);
    },
    enabled: canView,
  });

  const sales = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.data;
  }, [data]);

  const pagination = useMemo(() => {
    if (!data || Array.isArray(data)) return undefined;
    return data.pagination;
  }, [data]);

  const { data: detail, isLoading: detailLoading } = useQuery<SaleDetail>({
    queryKey: ['sale', detailId],
    queryFn: () => api.get(`/sales/${detailId}`),
    enabled: !!detailId && canView,
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/sales/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      if (detailId) queryClient.invalidateQueries({ queryKey: ['sale', detailId] });
      setCancelTarget(null);
    },
  });

  const handleTabChange = (newTab: SaleTab) => {
    setTab(newTab);
    setPage(1);
    if (newTab === 'completed') setStatusFilter('ALL');
  };

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      let exportData: Sale[];
      if (tab === 'held') {
        exportData = await api.get<Sale[]>('/sales/held');
      } else {
        const params = new URLSearchParams({ page: '1', limit: '1000', sortBy, sortOrder });
        if (debouncedSearch) params.set('search', debouncedSearch);
        if (listStatus) params.set('status', listStatus);
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        const result = await api.get<PaginatedSales>(`/sales?${params}`);
        exportData = result.data;
      }
      exportToCSV(
        exportData.map((s) => ({
          invoiceNumber: s.invoiceNumber,
          status: s.status,
          customer: customerLabel(s.customer),
          cashier: cashierLabel(s.user),
          subtotal: s.subtotal,
          discount: s.discountAmount,
          tax: s.taxAmount,
          total: s.total,
          amountPaid: s.amountPaid,
          date: formatDateTime(s.createdAt),
        })),
        `sales-${tab}-${new Date().toISOString().slice(0, 10)}`,
        [
          { key: 'invoiceNumber', label: 'Invoice' },
          { key: 'status', label: 'Status' },
          { key: 'customer', label: 'Customer' },
          { key: 'cashier', label: 'Cashier' },
          { key: 'subtotal', label: 'Subtotal' },
          { key: 'discount', label: 'Discount' },
          { key: 'tax', label: 'Tax' },
          { key: 'total', label: 'Total' },
          { key: 'amountPaid', label: 'Amount Paid' },
          { key: 'date', label: 'Date' },
        ]
      );
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Sale>[] = [
    {
      key: 'invoiceNumber',
      label: 'Invoice',
      sortable: tab !== 'held',
      render: (row) => <span className="font-medium">{row.invoiceNumber}</span>,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'customer',
      label: 'Customer',
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-muted-foreground" />
          {customerLabel(row.customer)}
        </span>
      ),
    },
    {
      key: 'total',
      label: 'Total',
      sortable: tab !== 'held',
      render: (row) => <span className="font-semibold">{formatCurrency(row.total)}</span>,
    },
    {
      key: 'user',
      label: 'Cashier',
      render: (row) => cashierLabel(row.user),
    },
    {
      key: 'createdAt',
      label: 'Date',
      sortable: tab !== 'held',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'actions',
      label: '',
      className: 'w-16',
      render: (row) =>
        canEdit && row.status !== 'CANCELLED' ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setCancelTarget(row)}
              title="Cancel sale"
            >
              <XCircle className="h-4 w-4" />
            </Button>
          </div>
        ) : null,
    },
  ];

  if (!canView) {
    return (
      <div className="p-6 animate-fade-in">
        <EmptyState
          icon={Receipt}
          title="Access Denied"
          description="You don't have permission to view sales."
        />
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Sales"
        description="View sales history, invoices, and held transactions."
        icon={Receipt}
        actions={
          <Button variant="outline" onClick={handleExport} disabled={exporting || sales.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            {exporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg bg-muted/50 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => handleTabChange(t.id)}
            className={cn(
              'px-4 py-2 rounded-md text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={sales}
        loading={isLoading}
        error={error?.message ?? null}
        onRetry={() => refetch()}
        emptyIcon={Receipt}
        emptyTitle="No sales found"
        emptyDescription={
          debouncedSearch || startDate || endDate
            ? 'Try adjusting your filters.'
            : 'Sales will appear here once transactions are completed.'
        }
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search by invoice number..."
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={tab !== 'held' ? handleSort : undefined}
        pagination={pagination}
        onPageChange={setPage}
        rowKey={(row) => row.id}
        onRowClick={(row) => setDetailId(row.id)}
        filters={
          tab !== 'held' ? (
            <div className="flex flex-wrap items-end gap-3">
              {tab === 'all' && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <Select
                    value={statusFilter}
                    onValueChange={(v) => { setStatusFilter(v); setPage(1); }}
                  >
                    <SelectTrigger className="w-40 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> From
                </Label>
                <Input
                  type="date"
                  className="w-36 h-9"
                  value={startDate}
                  onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> To
                </Label>
                <Input
                  type="date"
                  className="w-36 h-9"
                  value={endDate}
                  onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
                />
              </div>
              {(startDate || endDate || (tab === 'all' && statusFilter !== 'ALL')) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setStatusFilter('ALL');
                    setPage(1);
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Sale Details</DialogTitle>
            <DialogDescription>Invoice items, payments, and totals.</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : detail ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xl font-bold">{detail.invoiceNumber}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {formatDateTime(detail.createdAt)} · {cashierLabel(detail.user)}
                  </p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-0.5">
                    <User className="h-3.5 w-3.5" />
                    {customerLabel(detail.customer)}
                  </p>
                </div>
                <Badge variant={statusVariant(detail.status)} className="text-sm px-3 py-1">
                  {detail.status}
                </Badge>
              </div>

              <div>
                <p className="font-medium mb-2 text-sm">Line Items</p>
                <ScrollArea className="h-52 rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="px-3 py-2 text-left font-medium text-muted-foreground">Item</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Qty</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Price</th>
                        <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.map((item) => (
                        <tr key={item.id} className="border-b">
                          <td className="px-3 py-2">
                            <p className="font-medium">{item.name}</p>
                            {item.sku && <p className="text-xs text-muted-foreground">{item.sku}</p>}
                          </td>
                          <td className="px-3 py-2 text-right">{item.quantity}</td>
                          <td className="px-3 py-2 text-right">{formatCurrency(item.unitPrice)}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatCurrency(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="font-medium mb-2 text-sm">Payments</p>
                  <div className="rounded-lg border divide-y">
                    {detail.payments.length === 0 ? (
                      <p className="text-sm text-muted-foreground p-3">No payments recorded</p>
                    ) : (
                      detail.payments.map((payment) => {
                        const Icon = paymentIcon(payment.method);
                        return (
                          <div key={payment.id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              {payment.method}
                              {payment.reference && (
                                <span className="text-xs text-muted-foreground">({payment.reference})</span>
                              )}
                            </span>
                            <span className="font-medium">{formatCurrency(payment.amount)}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(detail.subtotal)}</span>
                  </div>
                  {detail.discountAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Discount</span>
                      <span className="text-destructive">-{formatCurrency(detail.discountAmount)}</span>
                    </div>
                  )}
                  {detail.taxAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax</span>
                      <span>{formatCurrency(detail.taxAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-base border-t pt-2">
                    <span>Total</span>
                    <span>{formatCurrency(detail.total)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount Paid</span>
                    <span>{formatCurrency(detail.amountPaid)}</span>
                  </div>
                  {detail.changeAmount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Change</span>
                      <span>{formatCurrency(detail.changeAmount)}</span>
                    </div>
                  )}
                </div>
              </div>

              {detail.notes && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="font-medium mb-1">Notes</p>
                  <p className="text-muted-foreground">{detail.notes}</p>
                </div>
              )}

              <DialogFooter>
                {canEdit && detail.status !== 'CANCELLED' && (
                  <Button variant="destructive" onClick={() => setCancelTarget(detail)}>
                    <XCircle className="h-4 w-4 mr-2" /> Cancel Sale
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8">Sale not found</p>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        title="Cancel Sale"
        description={
          cancelTarget
            ? `Are you sure you want to cancel sale ${cancelTarget.invoiceNumber}? This will mark the sale as cancelled.`
            : undefined
        }
        confirmLabel="Cancel Sale"
        variant="destructive"
        loading={cancelMutation.isPending}
        onConfirm={() => cancelTarget && cancelMutation.mutate(cancelTarget.id)}
      />
    </div>
  );
}
