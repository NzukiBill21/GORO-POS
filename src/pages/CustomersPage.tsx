import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users,
  Plus,
  Download,
  Pencil,
  Trash2,
  Gift,
  Mail,
  Phone,
  MapPin,
  Receipt,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toastSuccess } from '@/lib/toast';
import { formatCurrency, formatDateTime, formatDate } from '@/lib/utils';
import { exportToCSV } from '@/lib/permissions';
import { useDebounce } from '@/hooks/useDebounce';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label, Textarea } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Customer {
  id: string;
  firstName: string;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  birthday?: string | null;
  notes?: string | null;
  creditLimit: number;
  creditBalance: number;
  loyaltyPoints: number;
  createdAt: string;
  updatedAt: string;
}

interface CustomerSale {
  id: string;
  invoiceNumber: string;
  total: number;
  status: string;
  createdAt: string;
}

interface CustomerDetail extends Customer {
  sales: CustomerSale[];
}

interface PaginatedCustomers {
  data: Customer[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface CustomerFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  birthday: string;
  notes: string;
  creditLimit: string;
}

const EMPTY_FORM: CustomerFormData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  birthday: '',
  notes: '',
  creditLimit: '0',
};

function customerName(c: Pick<Customer, 'firstName' | 'lastName'>) {
  return [c.firstName, c.lastName].filter(Boolean).join(' ');
}

function statusVariant(status: string): 'default' | 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'COMPLETED': return 'success';
    case 'HELD': return 'warning';
    case 'CANCELLED': return 'destructive';
    case 'RETURNED': return 'secondary';
    default: return 'default';
  }
}

export default function CustomersPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('firstName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const debouncedSearch = useDebounce(search);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<CustomerFormData>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [pointsTarget, setPointsTarget] = useState<Customer | null>(null);
  const [pointsValue, setPointsValue] = useState('');
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const canView = can('customers.view');
  const canCreate = can('customers.create');
  const canEdit = can('customers.edit');
  const canDelete = can('customers.delete');

  const { data, isLoading, error, refetch } = useQuery<PaginatedCustomers>({
    queryKey: ['customers', page, debouncedSearch, sortBy, sortOrder],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return api.get(`/customers?${params}`);
    },
    enabled: canView,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<CustomerDetail>({
    queryKey: ['customer', detailId],
    queryFn: () => api.get(`/customers/${detailId}`),
    enabled: !!detailId && canView,
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editingCustomer
        ? api.put<Customer>(`/customers/${editingCustomer.id}`, payload)
        : api.post<Customer>('/customers', payload),
    onSuccess: () => {
      const wasEdit = editingCustomer !== null;
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (detailId) queryClient.invalidateQueries({ queryKey: ['customer', detailId] });
      closeForm();
      toastSuccess(wasEdit ? 'Customer updated' : 'Customer added');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setDeleteTarget(null);
      if (detailId === deleteTarget?.id) setDetailId(null);
      toastSuccess('Customer removed');
    },
  });

  const pointsMutation = useMutation({
    mutationFn: ({ id, points }: { id: string; points: number }) =>
      api.post(`/customers/${id}/points`, { points }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      if (detailId) queryClient.invalidateQueries({ queryKey: ['customer', detailId] });
      setPointsTarget(null);
      setPointsValue('');
      setPointsError(null);
      toastSuccess('Loyalty points updated');
    },
    onError: (err: Error) => setPointsError(err.message),
  });

  const openCreate = () => {
    setEditingCustomer(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      firstName: customer.firstName,
      lastName: customer.lastName ?? '',
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      address: customer.address ?? '',
      city: customer.city ?? '',
      birthday: customer.birthday ? customer.birthday.slice(0, 10) : '',
      notes: customer.notes ?? '',
      creditLimit: String(customer.creditLimit),
    });
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingCustomer(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.firstName.trim()) {
      setFormError('First name is required');
      return;
    }
    setFormError(null);
    saveMutation.mutate({
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim() || undefined,
      email: formData.email.trim() || undefined,
      phone: formData.phone.trim() || undefined,
      address: formData.address.trim() || undefined,
      city: formData.city.trim() || undefined,
      birthday: formData.birthday || undefined,
      notes: formData.notes.trim() || undefined,
      creditLimit: parseFloat(formData.creditLimit) || 0,
    });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '1000', sortBy, sortOrder });
      if (debouncedSearch) params.set('search', debouncedSearch);
      const result = await api.get<PaginatedCustomers>(`/customers?${params}`);
      exportToCSV(
        result.data.map((c) => ({
          name: customerName(c),
          email: c.email ?? '',
          phone: c.phone ?? '',
          city: c.city ?? '',
          loyaltyPoints: c.loyaltyPoints,
          creditBalance: c.creditBalance,
          creditLimit: c.creditLimit,
          createdAt: formatDateTime(c.createdAt),
        })),
        `customers-${new Date().toISOString().slice(0, 10)}`,
        [
          { key: 'name', label: 'Name' },
          { key: 'email', label: 'Email' },
          { key: 'phone', label: 'Phone' },
          { key: 'city', label: 'City' },
          { key: 'loyaltyPoints', label: 'Loyalty Points' },
          { key: 'creditBalance', label: 'Credit Balance' },
          { key: 'creditLimit', label: 'Credit Limit' },
          { key: 'createdAt', label: 'Created' },
        ]
      );
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<Customer>[] = [
    {
      key: 'firstName',
      label: 'Name',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{customerName(row)}</p>
          {row.email && <p className="text-xs text-muted-foreground">{row.email}</p>}
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'Phone',
      sortable: true,
      render: (row) => row.phone ?? '—',
    },
    {
      key: 'city',
      label: 'City',
      sortable: true,
      render: (row) => row.city ?? '—',
    },
    {
      key: 'loyaltyPoints',
      label: 'Points',
      sortable: true,
      render: (row) => (
        <Badge variant="default">{row.loyaltyPoints.toLocaleString()}</Badge>
      ),
    },
    {
      key: 'creditBalance',
      label: 'Credit',
      sortable: true,
      render: (row) => formatCurrency(row.creditBalance),
    },
    {
      key: 'createdAt',
      label: 'Joined',
      sortable: true,
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: 'actions',
      label: '',
      className: 'w-28',
      render: (row) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(row)} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPointsTarget(row);
                setPointsValue('');
                setPointsError(null);
              }}
              title="Adjust points"
            >
              <Gift className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(row)}
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (!canView) {
    return (
      <div className="p-6 animate-fade-in">
        <EmptyState
          icon={Users}
          title="Access Denied"
          description="You don't have permission to view customers."
        />
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Customers"
        description="Manage customer profiles, loyalty points, and purchase history."
        icon={Users}
        actions={
          <>
            <Button variant="outline" onClick={handleExport} disabled={exporting || !data?.data.length}>
              <Download className="h-4 w-4 mr-2" />
              {exporting ? 'Exporting...' : 'Export CSV'}
            </Button>
            {canCreate && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            )}
          </>
        }
      />

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        loading={isLoading}
        error={error?.message ?? null}
        onRetry={() => refetch()}
        emptyIcon={Users}
        emptyTitle="No customers found"
        emptyDescription={debouncedSearch ? 'Try adjusting your search terms.' : 'Add your first customer to get started.'}
        search={search}
        onSearchChange={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Search by name, phone, or email..."
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        pagination={data?.pagination}
        onPageChange={setPage}
        rowKey={(row) => row.id}
        onRowClick={(row) => setDetailId(row.id)}
      />

      {/* Add / Edit Form */}
      <Dialog open={formOpen} onOpenChange={(open) => !open && closeForm()}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingCustomer ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
            <DialogDescription>
              {editingCustomer ? 'Update customer information.' : 'Create a new customer profile.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name *</Label>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={formData.lastName}
                  onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="birthday">Birthday</Label>
                <Input
                  id="birthday"
                  type="date"
                  value={formData.birthday}
                  onChange={(e) => setFormData({ ...formData, birthday: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="creditLimit">Credit Limit</Label>
              <Input
                id="creditLimit"
                type="number"
                min="0"
                step="0.01"
                value={formData.creditLimit}
                onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
              />
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeForm} disabled={saveMutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving...' : editingCustomer ? 'Save Changes' : 'Create Customer'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailId} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>Profile information and purchase history.</DialogDescription>
          </DialogHeader>
          {detailLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : detail ? (
            <>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-2xl font-bold">{customerName(detail)}</p>
                  <div className="mt-2 space-y-1 text-muted-foreground">
                    {detail.email && (
                      <p className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5" /> {detail.email}
                      </p>
                    )}
                    {detail.phone && (
                      <p className="flex items-center gap-2">
                        <Phone className="h-3.5 w-3.5" /> {detail.phone}
                      </p>
                    )}
                    {(detail.address || detail.city) && (
                      <p className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5" />
                        {[detail.address, detail.city].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between rounded-lg border p-3">
                    <span className="text-muted-foreground">Loyalty Points</span>
                    <Badge>{detail.loyaltyPoints.toLocaleString()}</Badge>
                  </div>
                  <div className="flex justify-between rounded-lg border p-3">
                    <span className="text-muted-foreground">Credit Balance</span>
                    <span className="font-medium">{formatCurrency(detail.creditBalance)}</span>
                  </div>
                  <div className="flex justify-between rounded-lg border p-3">
                    <span className="text-muted-foreground">Credit Limit</span>
                    <span className="font-medium">{formatCurrency(detail.creditLimit)}</span>
                  </div>
                </div>
              </div>
              {detail.notes && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p className="font-medium mb-1">Notes</p>
                  <p className="text-muted-foreground">{detail.notes}</p>
                </div>
              )}
              <div>
                <p className="font-medium flex items-center gap-2 mb-3">
                  <Receipt className="h-4 w-4" />
                  Purchase History
                </p>
                <ScrollArea className="h-48 rounded-lg border">
                  {detail.sales.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8 text-sm">No purchases yet</p>
                  ) : (
                    <div className="divide-y">
                      {detail.sales.map((sale) => (
                        <div key={sale.id} className="flex items-center justify-between px-4 py-3 text-sm">
                          <div>
                            <p className="font-medium">{sale.invoiceNumber}</p>
                            <p className="text-xs text-muted-foreground">{formatDateTime(sale.createdAt)}</p>
                          </div>
                          <div className="text-right flex items-center gap-3">
                            <Badge variant={statusVariant(sale.status)}>{sale.status}</Badge>
                            <span className="font-semibold">{formatCurrency(sale.total)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
              <DialogFooter>
                {canEdit && (
                  <Button variant="outline" onClick={() => openEdit(detail)}>
                    <Pencil className="h-4 w-4 mr-2" /> Edit
                  </Button>
                )}
                {canEdit && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setPointsTarget(detail);
                      setPointsValue('');
                      setPointsError(null);
                    }}
                  >
                    <Gift className="h-4 w-4 mr-2" /> Adjust Points
                  </Button>
                )}
                {canDelete && (
                  <Button variant="destructive" onClick={() => setDeleteTarget(detail)}>
                    <Trash2 className="h-4 w-4 mr-2" /> Delete
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : (
            <p className="text-center text-muted-foreground py-8">Customer not found</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Loyalty Points Dialog */}
      <Dialog open={!!pointsTarget} onOpenChange={(open) => !open && setPointsTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Loyalty Points</DialogTitle>
            <DialogDescription>
              {pointsTarget && (
                <>
                  Current balance: <strong>{pointsTarget.loyaltyPoints}</strong> points for{' '}
                  {customerName(pointsTarget)}. Enter a positive or negative value to adjust.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="points">Points to add</Label>
            <Input
              id="points"
              type="number"
              placeholder="e.g. 100 or -50"
              value={pointsValue}
              onChange={(e) => setPointsValue(e.target.value)}
            />
            {pointsError && <p className="text-sm text-destructive">{pointsError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPointsTarget(null)} disabled={pointsMutation.isPending}>
              Cancel
            </Button>
            <Button
              disabled={pointsMutation.isPending || !pointsValue}
              onClick={() => {
                const points = parseInt(pointsValue, 10);
                if (isNaN(points) || points === 0) {
                  setPointsError('Enter a non-zero number of points');
                  return;
                }
                if (pointsTarget) {
                  pointsMutation.mutate({ id: pointsTarget.id, points });
                }
              }}
            >
              {pointsMutation.isPending ? 'Updating...' : 'Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Customer"
        description={
          deleteTarget
            ? `Are you sure you want to delete ${customerName(deleteTarget)}? This action cannot be undone.`
            : undefined
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
