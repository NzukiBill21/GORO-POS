import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Warehouse,
  Package,
  Boxes,
  DollarSign,
  AlertTriangle,
  Download,
  SlidersHorizontal,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toastSuccess } from '@/lib/toast';
import { formatCurrency, cn } from '@/lib/utils';
import { exportToCSV } from '@/lib/permissions';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

interface InventorySummary {
  totalItems: number;
  totalUnits: number;
  totalValue: number;
  lowStock: number;
}

interface StockItem {
  id: string;
  name: string;
  sku?: string | null;
  category?: string | null;
  costPrice: number;
  sellingPrice: number;
  minStock: number;
  stock: number;
  value: number;
  warehouses: Array<{ name: string; quantity: number }>;
}

interface PaginatedStock {
  data: StockItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface WarehouseOption {
  id: string;
  name: string;
  isDefault: boolean;
}

interface AdjustForm {
  productId: string;
  productName: string;
  warehouseId: string;
  type: 'IN' | 'OUT' | 'ADJUSTMENT';
  quantity: string;
  notes: string;
}

const emptyAdjustForm: AdjustForm = {
  productId: '',
  productName: '',
  warehouseId: '',
  type: 'IN',
  quantity: '1',
  notes: '',
};

export default function InventoryPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustForm, setAdjustForm] = useState<AdjustForm>(emptyAdjustForm);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<InventorySummary>({
    queryKey: ['inventory-summary'],
    queryFn: () => api.get('/inventory/summary'),
    enabled: can('inventory.view'),
  });

  const { data: warehouses = [] } = useQuery<WarehouseOption[]>({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/inventory/warehouses'),
    enabled: can('inventory.view'),
  });

  const {
    data: stockData,
    isLoading: stockLoading,
    error: stockError,
    refetch: refetchStock,
  } = useQuery<PaginatedStock>({
    queryKey: ['inventory-stock', page, debouncedSearch, sortBy, sortOrder, lowStockOnly],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (lowStockOnly) params.set('lowStock', 'true');
      return api.get(`/inventory/stock?${params}`);
    },
    enabled: can('inventory.view'),
  });

  const adjustMutation = useMutation({
    mutationFn: (payload: {
      productId: string;
      warehouseId: string;
      quantity: number;
      type: 'IN' | 'OUT' | 'ADJUSTMENT';
      notes?: string;
    }) => api.post('/inventory/adjust', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-stock'] });
      queryClient.invalidateQueries({ queryKey: ['inventory-summary'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setAdjustOpen(false);
      setAdjustForm(emptyAdjustForm);
      setAdjustError(null);
      toastSuccess('Stock updated');
    },
    onError: (err: Error) => setAdjustError(err.message),
  });

  const openAdjust = (item: StockItem) => {
    const defaultWarehouse =
      warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '';
    setAdjustForm({
      productId: item.id,
      productName: item.name,
      warehouseId: defaultWarehouse,
      type: 'IN',
      quantity: '1',
      notes: '',
    });
    setAdjustError(null);
    setAdjustOpen(true);
  };

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const handleExport = () => {
    const items = stockData?.data ?? [];
    if (!items.length) return;
    exportToCSV(
      items.map((item) => ({
        name: item.name,
        sku: item.sku ?? '',
        category: item.category ?? '',
        stock: item.stock,
        minStock: item.minStock,
        costPrice: item.costPrice,
        value: item.value,
        warehouses: item.warehouses.map((w) => `${w.name}: ${w.quantity}`).join('; '),
      })),
      `inventory-${new Date().toISOString().slice(0, 10)}`,
      [
        { key: 'name', label: 'Product' },
        { key: 'sku', label: 'SKU' },
        { key: 'category', label: 'Category' },
        { key: 'stock', label: 'Stock' },
        { key: 'minStock', label: 'Min Stock' },
        { key: 'costPrice', label: 'Cost Price' },
        { key: 'value', label: 'Value' },
        { key: 'warehouses', label: 'Warehouses' },
      ]
    );
  };

  const handleAdjustSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const quantity = parseInt(adjustForm.quantity, 10);
    if (!adjustForm.productId || !adjustForm.warehouseId) {
      setAdjustError('Product and warehouse are required');
      return;
    }
    if (!quantity || quantity <= 0) {
      setAdjustError('Quantity must be greater than zero');
      return;
    }
    adjustMutation.mutate({
      productId: adjustForm.productId,
      warehouseId: adjustForm.warehouseId,
      quantity,
      type: adjustForm.type,
      notes: adjustForm.notes.trim() || undefined,
    });
  };

  const columns: Column<StockItem>[] = [
    {
      key: 'name',
      label: 'Product',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.sku && <p className="text-xs text-muted-foreground">{row.sku}</p>}
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (row) => row.category ?? '—',
    },
    {
      key: 'stock',
      label: 'Stock',
      sortable: true,
      className: 'text-right',
      render: (row) => {
        const isLow = row.stock <= row.minStock;
        return (
          <Badge variant={isLow ? 'warning' : 'secondary'}>
            {row.stock}
            {isLow && ' · Low'}
          </Badge>
        );
      },
    },
    {
      key: 'minStock',
      label: 'Min',
      className: 'text-right',
      render: (row) => row.minStock,
    },
    {
      key: 'value',
      label: 'Value',
      className: 'text-right',
      render: (row) => <span className="font-medium">{formatCurrency(row.value)}</span>,
    },
    {
      key: 'warehouses',
      label: 'Warehouses',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.warehouses.map((w) => (
            <span
              key={w.name}
              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs"
            >
              {w.name}: {w.quantity}
            </span>
          ))}
        </div>
      ),
    },
    ...(can('inventory.edit')
      ? [
          {
            key: 'actions',
            label: '',
            className: 'w-28',
            render: (row: StockItem) => (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  openAdjust(row);
                }}
              >
                <SlidersHorizontal className="h-3.5 w-3.5 mr-1" />
                Adjust
              </Button>
            ),
          } as Column<StockItem>,
        ]
      : []),
  ];

  if (!can('inventory.view')) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Warehouse}
          title="Access Denied"
          description="You don't have permission to view inventory."
        />
      </div>
    );
  }

  const stockItems = stockData?.data ?? [];
  const pagination = stockData?.pagination;

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <PageHeader
        title="Inventory"
        description="Track stock levels, values, and warehouse quantities."
        icon={Warehouse}
        actions={
          <Button variant="outline" onClick={handleExport} disabled={!stockItems.length}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        }
      />

      {summaryLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-sm" />
          ))}
        </div>
      ) : summaryError ? (
        <div className="rounded-sm border bg-card p-6 text-center">
          <p className="text-destructive font-medium mb-3">Failed to load inventory summary</p>
          <Button variant="outline" size="sm" onClick={() => refetchSummary()}>
            Try Again
          </Button>
        </div>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Tracked Products"
            value={summary.totalItems}
            format="number"
            icon={Package}
          />
          <StatCard
            title="Total Units"
            value={summary.totalUnits}
            format="number"
            icon={Boxes}
          />
          <StatCard
            title="Inventory Value"
            value={summary.totalValue}
            format="currency"
            icon={DollarSign}
          />
          <StatCard
            title="Low Stock Items"
            value={summary.lowStock}
            format="number"
            icon={AlertTriangle}
            variant={summary.lowStock > 0 ? 'warning' : 'default'}
          />
        </div>
      ) : null}

      <DataTable
        columns={columns}
        data={stockItems}
        loading={stockLoading}
        error={stockError?.message ?? null}
        onRetry={() => refetchStock()}
        emptyIcon={Warehouse}
        emptyTitle="No stock items found"
        emptyDescription={
          debouncedSearch || lowStockOnly
            ? 'Try adjusting your search or filters.'
            : 'Products with stock tracking enabled will appear here.'
        }
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by name or SKU..."
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        pagination={
          pagination
            ? { page: pagination.page, totalPages: pagination.totalPages, total: pagination.total }
            : undefined
        }
        onPageChange={setPage}
        rowKey={(row) => row.id}
        onRowClick={can('inventory.edit') ? openAdjust : undefined}
        filters={
          <Button
            variant={lowStockOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setLowStockOnly((v) => !v);
              setPage(1);
            }}
            className={cn(lowStockOnly && 'shadow-sm')}
          >
            <AlertTriangle className="h-4 w-4 mr-2" />
            Low Stock Only
          </Button>
        }
      />

      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Stock</DialogTitle>
            <DialogDescription>
              {adjustForm.productName
                ? `Update stock for ${adjustForm.productName}`
                : 'Add, remove, or set stock quantity.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAdjustSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <Select
                value={adjustForm.warehouseId}
                onValueChange={(v) => setAdjustForm({ ...adjustForm, warehouseId: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.name}
                      {wh.isDefault ? ' (Default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <Select
                value={adjustForm.type}
                onValueChange={(v) =>
                  setAdjustForm({ ...adjustForm, type: v as AdjustForm['type'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="IN">Stock In (+)</SelectItem>
                  <SelectItem value="OUT">Stock Out (−)</SelectItem>
                  <SelectItem value="ADJUSTMENT">Set Exact Quantity</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="quantity">
                {adjustForm.type === 'ADJUSTMENT' ? 'New Quantity' : 'Quantity'}
              </Label>
              <Input
                id="quantity"
                type="number"
                min="1"
                value={adjustForm.quantity}
                onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                value={adjustForm.notes}
                onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })}
                placeholder="Reason for adjustment"
              />
            </div>

            {adjustError && <p className="text-sm text-destructive">{adjustError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdjustOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={adjustMutation.isPending}>
                {adjustMutation.isPending ? 'Saving...' : 'Apply Adjustment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
