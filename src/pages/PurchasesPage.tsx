import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Truck,
  Plus,
  Download,
  PackageCheck,
  Building2,
  Trash2,
  ShoppingCart,
} from 'lucide-react';
import { api } from '@/lib/api';
import { exportToCSV } from '@/lib/permissions';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

interface Product {
  id: string;
  name: string;
  sku?: string;
  costPrice: number;
}

interface PurchaseItem {
  id: string;
  productId: string;
  quantity: number;
  unitCost: number;
  total: number;
  receivedQty: number;
}

interface Purchase {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  total: number;
  notes?: string;
  expectedDate?: string;
  receivedDate?: string;
  createdAt: string;
  supplier: { name: string };
  user: { firstName: string; lastName: string };
  items: PurchaseItem[];
}

interface LineItem {
  productId: string;
  quantity: string;
  unitCost: string;
}

interface PurchaseForm {
  supplierId: string;
  notes: string;
  expectedDate: string;
  items: LineItem[];
}

interface SupplierForm {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

const emptyLineItem: LineItem = { productId: '', quantity: '1', unitCost: '0' };

const emptyPurchaseForm: PurchaseForm = {
  supplierId: '',
  notes: '',
  expectedDate: '',
  items: [{ ...emptyLineItem }],
};

const emptySupplierForm: SupplierForm = {
  name: '',
  contactName: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
};

type Tab = 'orders' | 'suppliers';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'RECEIVED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'CANCELLED':
      return 'destructive';
    case 'PARTIAL':
      return 'secondary';
    default:
      return 'default';
  }
}

export default function PurchasesPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('orders');
  const [page, setPage] = useState(1);
  const [supplierPage, setSupplierPage] = useState(1);
  const [search, setSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [poDialogOpen, setPoDialogOpen] = useState(false);
  const [supplierDialogOpen, setSupplierDialogOpen] = useState(false);
  const [purchaseForm, setPurchaseForm] = useState<PurchaseForm>(emptyPurchaseForm);
  const [supplierForm, setSupplierForm] = useState<SupplierForm>(emptySupplierForm);
  const [formError, setFormError] = useState('');
  const [receiveTarget, setReceiveTarget] = useState<Purchase | null>(null);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});

  const debouncedSearch = useDebounce(search);
  const debouncedSupplierSearch = useDebounce(supplierSearch);

  const canView = can('purchases.view');
  const canCreate = can('purchases.create');
  const canEdit = can('purchases.edit');

  const { data: productsData } = useQuery<PaginatedResult<Product>>({
    queryKey: ['products-for-po'],
    queryFn: () => api.get('/products?limit=100'),
    enabled: canView && poDialogOpen,
  });

  const {
    data: suppliersData,
    isLoading: suppliersLoading,
    error: suppliersError,
    refetch: refetchSuppliers,
  } = useQuery<PaginatedResult<Supplier>>({
    queryKey: ['suppliers-list', supplierPage, debouncedSupplierSearch],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(supplierPage), limit: '20' });
      if (debouncedSupplierSearch) params.set('search', debouncedSupplierSearch);
      return api.get(`/purchases/suppliers/list?${params}`);
    },
    enabled: canView,
  });

  const { data: allSuppliers } = useQuery<PaginatedResult<Supplier>>({
    queryKey: ['suppliers-all'],
    queryFn: () => api.get('/purchases/suppliers/list?limit=100'),
    enabled: canView && poDialogOpen,
  });

  const {
    data: purchasesData,
    isLoading,
    error,
    refetch,
  } = useQuery<PaginatedResult<Purchase>>({
    queryKey: ['purchases', page, debouncedSearch, statusFilter, sortBy, sortOrder],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      return api.get(`/purchases?${params}`);
    },
    enabled: canView && tab === 'orders',
  });

  const createPoMutation = useMutation({
    mutationFn: (payload: {
      supplierId: string;
      items: Array<{ productId: string; quantity: number; unitCost: number }>;
      notes?: string;
      expectedDate?: string;
    }) => api.post('/purchases', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      setPoDialogOpen(false);
      setPurchaseForm(emptyPurchaseForm);
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const createSupplierMutation = useMutation({
    mutationFn: (payload: SupplierForm) => api.post('/purchases/suppliers', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers-list'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers-all'] });
      setSupplierDialogOpen(false);
      setSupplierForm(emptySupplierForm);
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const { data: productsForReceive } = useQuery<PaginatedResult<Product>>({
    queryKey: ['products-for-receive'],
    queryFn: () => api.get('/products?limit=200'),
    enabled: !!receiveTarget,
  });

  const productNameById = new Map((productsForReceive?.data ?? []).map((p) => [p.id, p.name]));

  const openReceive = (purchase: Purchase) => {
    const qtys: Record<string, string> = {};
    for (const item of purchase.items) {
      qtys[item.id] = String(Math.max(0, item.quantity - item.receivedQty));
    }
    setReceiveQtys(qtys);
    setReceiveTarget(purchase);
  };

  const receiveMutation = useMutation({
    mutationFn: (payload: { id: string; lines: Array<{ itemId: string; quantity: number }> }) =>
      api.post(`/purchases/${payload.id}/receive`, { lines: payload.lines }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      setReceiveTarget(null);
      setReceiveQtys({});
    },
  });

  const openCreatePo = () => {
    setPurchaseForm({
      ...emptyPurchaseForm,
      supplierId: allSuppliers?.data[0]?.id ?? '',
    });
    setFormError('');
    setPoDialogOpen(true);
  };

  const openCreateSupplier = () => {
    setSupplierForm(emptySupplierForm);
    setFormError('');
    setSupplierDialogOpen(true);
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string) => {
    setPurchaseForm((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };

      if (field === 'productId') {
        const product = productsData?.data.find((p) => p.id === value);
        if (product) {
          items[index].unitCost = String(product.costPrice ?? 0);
        }
      }

      return { ...prev, items };
    });
  };

  const addLineItem = () => {
    setPurchaseForm((prev) => ({
      ...prev,
      items: [...prev.items, { ...emptyLineItem }],
    }));
  };

  const removeLineItem = (index: number) => {
    setPurchaseForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index),
    }));
  };

  const poSubtotal = purchaseForm.items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const cost = parseFloat(item.unitCost) || 0;
    return sum + qty * cost;
  }, 0);

  const handleCreatePo = () => {
    if (!purchaseForm.supplierId) {
      setFormError('Please select a supplier.');
      return;
    }

    const items = purchaseForm.items
      .filter((item) => item.productId)
      .map((item) => ({
        productId: item.productId,
        quantity: parseInt(item.quantity, 10),
        unitCost: parseFloat(item.unitCost),
      }))
      .filter((item) => item.quantity > 0 && item.unitCost >= 0);

    if (!items.length) {
      setFormError('Add at least one valid line item.');
      return;
    }

    createPoMutation.mutate({
      supplierId: purchaseForm.supplierId,
      items,
      notes: purchaseForm.notes.trim() || undefined,
      expectedDate: purchaseForm.expectedDate || undefined,
    });
  };

  const handleCreateSupplier = () => {
    if (!supplierForm.name.trim()) {
      setFormError('Supplier name is required.');
      return;
    }
    createSupplierMutation.mutate(supplierForm);
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

  const handleExportOrders = () => {
    const rows = purchasesData?.data ?? [];
    if (!rows.length) return;
    exportToCSV(
      rows.map((p) => ({
        orderNumber: p.orderNumber,
        supplier: p.supplier.name,
        status: p.status,
        items: p.items.length,
        total: p.total,
        createdBy: `${p.user.firstName} ${p.user.lastName}`,
        createdAt: formatDateTime(p.createdAt),
        expectedDate: p.expectedDate ? formatDate(p.expectedDate) : '',
        receivedDate: p.receivedDate ? formatDate(p.receivedDate) : '',
      })),
      'purchase-orders',
      [
        { key: 'orderNumber', label: 'Order Number' },
        { key: 'supplier', label: 'Supplier' },
        { key: 'status', label: 'Status' },
        { key: 'items', label: 'Line Items' },
        { key: 'total', label: 'Total' },
        { key: 'createdBy', label: 'Created By' },
        { key: 'createdAt', label: 'Created At' },
        { key: 'expectedDate', label: 'Expected Date' },
        { key: 'receivedDate', label: 'Received Date' },
      ]
    );
  };

  const handleExportSuppliers = () => {
    const rows = suppliersData?.data ?? [];
    if (!rows.length) return;
    exportToCSV(
      rows.map((s) => ({
        name: s.name,
        contactName: s.contactName ?? '',
        email: s.email ?? '',
        phone: s.phone ?? '',
        address: s.address ?? '',
      })),
      'suppliers',
      [
        { key: 'name', label: 'Name' },
        { key: 'contactName', label: 'Contact' },
        { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' },
        { key: 'address', label: 'Address' },
      ]
    );
  };

  const purchaseColumns: Column<Purchase>[] = [
    {
      key: 'orderNumber',
      label: 'Order #',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{row.orderNumber}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'supplier',
      label: 'Supplier',
      render: (row) => row.supplier.name,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <Badge variant={statusVariant(row.status)}>
          {row.status.charAt(0) + row.status.slice(1).toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'items',
      label: 'Items',
      render: (row) => `${row.items.length} item${row.items.length !== 1 ? 's' : ''}`,
    },
    {
      key: 'total',
      label: 'Total',
      sortable: true,
      render: (row) => formatCurrency(row.total),
    },
    {
      key: 'expectedDate',
      label: 'Expected',
      render: (row) => (row.expectedDate ? formatDate(row.expectedDate) : '—'),
    },
    {
      key: 'user',
      label: 'Created By',
      render: (row) => `${row.user.firstName} ${row.user.lastName}`,
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'w-24',
      render: (row) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && row.status !== 'RECEIVED' && row.status !== 'CANCELLED' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => openReceive(row)}
              title="Receive stock"
            >
              <PackageCheck className="h-4 w-4 text-success" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  const supplierColumns: Column<Supplier>[] = [
    {
      key: 'name',
      label: 'Name',
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.contactName && (
            <p className="text-xs text-muted-foreground">{row.contactName}</p>
          )}
        </div>
      ),
    },
    { key: 'email', label: 'Email', render: (row) => row.email ?? '—' },
    { key: 'phone', label: 'Phone', render: (row) => row.phone ?? '—' },
    {
      key: 'address',
      label: 'Address',
      render: (row) => (
        <span className="text-muted-foreground truncate max-w-xs block">
          {row.address ?? '—'}
        </span>
      ),
    },
  ];

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Truck}
          title="Access Denied"
          description="You don't have permission to view purchases."
        />
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Purchases"
        description="Create purchase orders and manage suppliers."
        icon={Truck}
        actions={
          tab === 'orders' ? (
            <>
              <Button
                variant="outline"
                onClick={handleExportOrders}
                disabled={!purchasesData?.data.length}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              {canCreate && (
                <Button onClick={openCreatePo}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Purchase Order
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={handleExportSuppliers}
                disabled={!suppliersData?.data.length}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              {canCreate && (
                <Button onClick={openCreateSupplier}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Supplier
                </Button>
              )}
            </>
          )
        }
      />

      <div className="flex gap-2 mb-6">
        <Button
          variant={tab === 'orders' ? 'default' : 'outline'}
          onClick={() => setTab('orders')}
        >
          <ShoppingCart className="h-4 w-4 mr-2" />
          Purchase Orders
        </Button>
        <Button
          variant={tab === 'suppliers' ? 'default' : 'outline'}
          onClick={() => setTab('suppliers')}
        >
          <Building2 className="h-4 w-4 mr-2" />
          Suppliers
        </Button>
      </div>

      {tab === 'orders' ? (
        <DataTable
          columns={purchaseColumns}
          data={purchasesData?.data ?? []}
          loading={isLoading}
          error={error?.message ?? null}
          onRetry={() => refetch()}
          emptyIcon={Truck}
          emptyTitle="No purchase orders"
          emptyDescription="Create your first purchase order to restock inventory."
          search={search}
          onSearchChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          searchPlaceholder="Search by order number..."
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          pagination={purchasesData?.pagination}
          onPageChange={setPage}
          rowKey={(row) => row.id}
          filters={
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      ) : (
        <DataTable
          columns={supplierColumns}
          data={suppliersData?.data ?? []}
          loading={suppliersLoading}
          error={suppliersError?.message ?? null}
          onRetry={() => refetchSuppliers()}
          emptyIcon={Building2}
          emptyTitle="No suppliers"
          emptyDescription="Add suppliers to create purchase orders."
          search={supplierSearch}
          onSearchChange={(v) => {
            setSupplierSearch(v);
            setSupplierPage(1);
          }}
          searchPlaceholder="Search suppliers..."
          pagination={suppliersData?.pagination}
          onPageChange={setSupplierPage}
          rowKey={(row) => row.id}
        />
      )}

      <Dialog open={poDialogOpen} onOpenChange={setPoDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>
              Select a supplier and add products to order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Supplier</Label>
                <Select
                  value={purchaseForm.supplierId}
                  onValueChange={(v) =>
                    setPurchaseForm({ ...purchaseForm, supplierId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {(allSuppliers?.data ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="expectedDate">Expected Date</Label>
                <Input
                  id="expectedDate"
                  type="date"
                  value={purchaseForm.expectedDate}
                  onChange={(e) =>
                    setPurchaseForm({ ...purchaseForm, expectedDate: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Line Items</Label>
                <Button type="button" variant="outline" size="sm" onClick={addLineItem}>
                  <Plus className="h-3 w-3 mr-1" />
                  Add Item
                </Button>
              </div>

              {!productsData ? (
                <div className="space-y-2">
                  {Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {purchaseForm.items.map((item, index) => (
                    <div key={index} className="flex gap-2 items-end">
                      <div className="flex-1 space-y-1">
                        {index === 0 && (
                          <Label className="text-xs text-muted-foreground">Product</Label>
                        )}
                        <Select
                          value={item.productId}
                          onValueChange={(v) => updateLineItem(index, 'productId', v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select product" />
                          </SelectTrigger>
                          <SelectContent>
                            {(productsData.data ?? []).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} {p.sku ? `(${p.sku})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-20 space-y-1">
                        {index === 0 && (
                          <Label className="text-xs text-muted-foreground">Qty</Label>
                        )}
                        <Input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) =>
                            updateLineItem(index, 'quantity', e.target.value)
                          }
                        />
                      </div>
                      <div className="w-28 space-y-1">
                        {index === 0 && (
                          <Label className="text-xs text-muted-foreground">Unit Cost</Label>
                        )}
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitCost}
                          onChange={(e) =>
                            updateLineItem(index, 'unitCost', e.target.value)
                          }
                        />
                      </div>
                      {purchaseForm.items.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeLineItem(index)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-end pt-2 border-t">
                <p className="text-sm font-semibold">
                  Subtotal: {formatCurrency(poSubtotal)}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input
                id="notes"
                value={purchaseForm.notes}
                onChange={(e) =>
                  setPurchaseForm({ ...purchaseForm, notes: e.target.value })
                }
                placeholder="Optional notes..."
              />
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPoDialogOpen(false)}
              disabled={createPoMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleCreatePo} disabled={createPoMutation.isPending}>
              {createPoMutation.isPending ? 'Creating...' : 'Create Order'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={supplierDialogOpen} onOpenChange={setSupplierDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Supplier</DialogTitle>
            <DialogDescription>Register a new supplier for purchase orders.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supplierName">Name</Label>
              <Input
                id="supplierName"
                value={supplierForm.name}
                onChange={(e) =>
                  setSupplierForm({ ...supplierForm, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactName">Contact Name</Label>
              <Input
                id="contactName"
                value={supplierForm.contactName}
                onChange={(e) =>
                  setSupplierForm({ ...supplierForm, contactName: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="supplierEmail">Email</Label>
                <Input
                  id="supplierEmail"
                  type="email"
                  value={supplierForm.email}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplierPhone">Phone</Label>
                <Input
                  id="supplierPhone"
                  value={supplierForm.phone}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, phone: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplierAddress">Address</Label>
              <Input
                id="supplierAddress"
                value={supplierForm.address}
                onChange={(e) =>
                  setSupplierForm({ ...supplierForm, address: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplierNotes">Notes</Label>
              <Input
                id="supplierNotes"
                value={supplierForm.notes}
                onChange={(e) =>
                  setSupplierForm({ ...supplierForm, notes: e.target.value })
                }
              />
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSupplierDialogOpen(false)}
              disabled={createSupplierMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSupplier}
              disabled={createSupplierMutation.isPending}
            >
              {createSupplierMutation.isPending ? 'Saving...' : 'Add Supplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiveTarget} onOpenChange={(open) => !open && setReceiveTarget(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receive stock</DialogTitle>
            <DialogDescription>
              {receiveTarget
                ? `${receiveTarget.orderNumber} · ${receiveTarget.supplier.name} — adjust quantities for partial receive.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {receiveTarget && (
            <div className="space-y-3">
              {receiveTarget.items.map((item) => {
                const remaining = item.quantity - item.receivedQty;
                if (remaining <= 0) return null;
                return (
                  <div key={item.id} className="grid grid-cols-[1fr,80px] gap-2 items-end text-sm">
                    <div>
                      <p className="font-medium">{productNameById.get(item.productId) ?? item.productId.slice(0, 8)}</p>
                      <p className="text-muted-foreground text-xs">
                        Ordered {item.quantity} · received {item.receivedQty} · left {remaining}
                      </p>
                    </div>
                    <div>
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="number"
                        min={0}
                        max={remaining}
                        value={receiveQtys[item.id] ?? ''}
                        onChange={(e) => setReceiveQtys({ ...receiveQtys, [item.id]: e.target.value })}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveTarget(null)}>Cancel</Button>
            <Button
              disabled={receiveMutation.isPending || !receiveTarget}
              onClick={() => {
                if (!receiveTarget) return;
                const lines = receiveTarget.items
                  .map((item) => ({
                    itemId: item.id,
                    quantity: parseInt(receiveQtys[item.id] ?? '0', 10),
                  }))
                  .filter((l) => l.quantity > 0);
                receiveMutation.mutate({ id: receiveTarget.id, lines });
              }}
            >
              {receiveMutation.isPending ? 'Receiving...' : 'Receive into inventory'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
