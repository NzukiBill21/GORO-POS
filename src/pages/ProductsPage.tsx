import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  Plus,
  Download,
  Upload,
  Pencil,
  Trash2,
  Star,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toastSuccess } from '@/lib/toast';
import { formatCurrency } from '@/lib/utils';
import { exportToCSV } from '@/lib/permissions';
import { usePermissions } from '@/hooks/usePermissions';
import { useDebounce } from '@/hooks/useDebounce';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { PageHeader } from '@/components/shared/PageHeader';
import { DataTable, Column } from '@/components/shared/DataTable';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EmptyState } from '@/components/shared/EmptyState';
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
import { ProductVariantsEditor } from '@/components/products/ProductVariantsEditor';
import { ShopExcelImportDialog } from '@/components/products/ShopExcelImportDialog';

interface Category {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  description?: string | null;
  costPrice: number;
  sellingPrice: number;
  unit: string;
  minStock: number;
  trackStock: boolean;
  isFavorite: boolean;
  stock: number;
  category?: { id: string; name: string } | null;
  brand?: { id: string; name: string } | null;
}

interface PaginatedProducts {
  data: Product[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface ProductFormData {
  name: string;
  sku: string;
  barcode: string;
  description: string;
  costPrice: string;
  sellingPrice: string;
  categoryId: string;
  unit: string;
  minStock: string;
  trackStock: boolean;
  isFavorite: boolean;
  initialStock: string;
}

const emptyForm: ProductFormData = {
  name: '',
  sku: '',
  barcode: '',
  description: '',
  costPrice: '0',
  sellingPrice: '0',
  categoryId: '',
  unit: 'pcs',
  minStock: '0',
  trackStock: true,
  isFavorite: false,
  initialStock: '0',
};

function productToForm(product: Product): ProductFormData {
  return {
    name: product.name,
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    description: product.description ?? '',
    costPrice: String(product.costPrice),
    sellingPrice: String(product.sellingPrice),
    categoryId: product.category?.id ?? '',
    unit: product.unit,
    minStock: String(product.minStock),
    trackStock: product.trackStock,
    isFavorite: product.isFavorite,
    initialStock: '0',
  };
}

export default function ProductsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [shopImportOpen, setShopImportOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormData>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bc = searchParams.get('barcode')?.trim();
    if (!bc || !can('products.create')) return;
    setForm({ ...emptyForm, barcode: bc });
    setEditingProduct(null);
    setDialogOpen(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, can]);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories'),
    enabled: can('products.view'),
  });

  const {
    data: productsData,
    isLoading,
    error,
    refetch,
  } = useQuery<PaginatedProducts>({
    queryKey: ['products', page, debouncedSearch, sortBy, sortOrder, categoryFilter],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (categoryFilter !== 'all') params.set('categoryId', categoryFilter);
      return api.get(`/products?${params}`);
    },
    enabled: can('products.view'),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editingProduct
        ? api.put(`/products/${editingProduct.id}`, payload)
        : api.post('/products', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setDialogOpen(false);
      const wasEdit = editingProduct !== null;
      setEditingProduct(null);
      setForm(emptyForm);
      setFormError(null);
      toastSuccess(wasEdit ? 'Product updated' : 'Product added');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      setDeleteTarget(null);
      toastSuccess('Product removed');
    },
  });

  const openCreate = useCallback(() => {
    setEditingProduct(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }, []);

  const openEdit = useCallback((product: Product) => {
    setEditingProduct(product);
    setForm(productToForm(product));
    setFormError(null);
    setDialogOpen(true);
  }, []);

  useKeyboardShortcuts(
    useMemo(
      () => [
        {
          key: 'n',
          ctrl: true,
          action: openCreate,
          enabled: can('products.create') && !dialogOpen,
        },
      ],
      [openCreate, can, dialogOpen]
    )
  );

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortOrder('asc');
    }
    setPage(1);
  };

  const parseProductCsv = (text: string) => {
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const idx = (name: string) => headers.indexOf(name);
    return lines.slice(1).map((line) => {
      const cols = line.match(/("([^"]|"")*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"').trim()) ?? [];
      const num = (i: number) => {
        const v = parseFloat(cols[i] ?? '');
        return Number.isFinite(v) ? v : undefined;
      };
      return {
        name: cols[idx('name')] ?? '',
        sku: cols[idx('sku')],
        barcode: cols[idx('barcode')],
        category: cols[idx('category')],
        costPrice: num(idx('cost price')) ?? num(idx('costprice')),
        sellingPrice: num(idx('selling price')) ?? num(idx('sellingprice')),
        stock: num(idx('stock')),
        unit: cols[idx('unit')],
        minStock: num(idx('min stock')) ?? num(idx('minstock')),
      };
    }).filter((r) => r.name);
  };

  const handleImportFile = async (file: File) => {
    setImportLoading(true);
    try {
      const text = await file.text();
      const rows = parseProductCsv(text);
      const result = await api.post<{ created: number; updated: number }>('/products/import', { rows });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      alert(`Import complete: ${result.created} created, ${result.updated} updated.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImportLoading(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      const products = await api.get<
        Array<Product & { category?: { name: string }; brand?: { name: string }; stocks?: { quantity: number }[] }>
      >('/products/export');
      const rows = products.map((p) => ({
        name: p.name,
        sku: p.sku ?? '',
        barcode: p.barcode ?? '',
        category: p.category?.name ?? '',
        brand: p.brand?.name ?? '',
        costPrice: p.costPrice,
        sellingPrice: p.sellingPrice,
        stock: p.stocks?.reduce((s, st) => s + st.quantity, 0) ?? p.stock ?? 0,
        unit: p.unit,
        minStock: p.minStock,
      }));
      exportToCSV(rows, `products-${new Date().toISOString().slice(0, 10)}`, [
        { key: 'name', label: 'Name' },
        { key: 'sku', label: 'SKU' },
        { key: 'barcode', label: 'Barcode' },
        { key: 'category', label: 'Category' },
        { key: 'brand', label: 'Brand' },
        { key: 'costPrice', label: 'Cost Price' },
        { key: 'sellingPrice', label: 'Selling Price' },
        { key: 'stock', label: 'Stock' },
        { key: 'unit', label: 'Unit' },
        { key: 'minStock', label: 'Min Stock' },
      ]);
    } catch {
      // export failed silently — user can retry
    } finally {
      setExportLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError('Product name is required');
      return;
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      barcode: form.barcode.trim() || null,
      description: form.description.trim() || null,
      costPrice: parseFloat(form.costPrice) || 0,
      sellingPrice: parseFloat(form.sellingPrice) || 0,
      unit: form.unit.trim() || 'pcs',
      minStock: parseInt(form.minStock, 10) || 0,
      trackStock: form.trackStock,
      isFavorite: form.isFavorite,
      categoryId: form.categoryId || null,
    };

    if (!editingProduct) {
      payload.initialStock = parseInt(form.initialStock, 10) || 0;
    }

    saveMutation.mutate(payload);
  };

  const columns: Column<Product>[] = [
    {
      key: 'name',
      label: 'Product',
      sortable: true,
      render: (row) => (
        <div className="flex items-center gap-2">
          {row.isFavorite && <Star className="h-3.5 w-3.5 fill-warning text-warning shrink-0" />}
          <div>
            <p className="font-medium">{row.name}</p>
            {row.sku && <p className="text-xs text-muted-foreground">{row.sku}</p>}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (row) => row.category?.name ?? '—',
    },
    {
      key: 'sellingPrice',
      label: 'Price',
      sortable: true,
      className: 'text-right',
      render: (row) => <span className="font-medium">{formatCurrency(row.sellingPrice)}</span>,
    },
    {
      key: 'costPrice',
      label: 'Cost',
      className: 'text-right',
      render: (row) => formatCurrency(row.costPrice),
    },
    {
      key: 'stock',
      label: 'Stock',
      sortable: true,
      className: 'text-right',
      render: (row) => {
        const low = row.trackStock && row.stock <= row.minStock;
        return (
          <Badge variant={low ? 'warning' : 'secondary'}>
            {row.trackStock ? row.stock : 'N/A'}
          </Badge>
        );
      },
    },
    {
      key: 'actions',
      label: '',
      className: 'w-24',
      render: (row) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {can('products.edit') && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(row)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can('products.delete') && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => setDeleteTarget(row)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (!can('products.view')) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Package}
          title="Access Denied"
          description="You don't have permission to view products."
        />
      </div>
    );
  }

  const products = productsData?.data ?? [];
  const pagination = productsData?.pagination;

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Products"
        description="Manage your product catalog, pricing, and stock settings."
        icon={Package}
        actions={
          <>
            <Button variant="outline" onClick={handleExport} disabled={exportLoading}>
              <Download className="h-4 w-4 mr-2" />
              {exportLoading ? 'Exporting...' : 'Export CSV'}
            </Button>
            {can('products.create') && (
              <>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  title="Legacy CSV import (simple products). For Excel variants use Import Excel workbook."
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleImportFile(f);
                  }}
                />
                <Button
                  variant="outline"
                  disabled={importLoading}
                  onClick={() => importInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  {importLoading ? 'Importing...' : 'Import CSV (legacy)'}
                </Button>
                <Button variant="outline" onClick={() => setShopImportOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" />
                  Import Excel workbook
                </Button>
              </>
            )}
            {can('products.create') && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add Product
                <kbd className="ml-2 hidden lg:inline text-xs opacity-60">Ctrl+N</kbd>
              </Button>
            )}
          </>
        }
      />

      <DataTable
        columns={columns}
        data={products}
        loading={isLoading}
        error={error?.message ?? null}
        onRetry={() => refetch()}
        emptyIcon={Package}
        emptyTitle="No products found"
        emptyDescription={
          debouncedSearch || categoryFilter !== 'all'
            ? 'Try adjusting your search or filters.'
            : 'Add your first product to get started.'
        }
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by name, SKU, or barcode..."
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
        onRowClick={can('products.edit') ? openEdit : undefined}
        filters={
          <Select
            value={categoryFilter}
            onValueChange={(v) => {
              setCategoryFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProduct ? 'Edit Product' : 'Add Product'}</DialogTitle>
            <DialogDescription>
              {editingProduct
                ? 'Update product details and pricing.'
                : 'Create a new product in your catalog.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Product name"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  value={form.sku}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  placeholder="SKU-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="barcode">Barcode</Label>
                <Input
                  id="barcode"
                  value={form.barcode}
                  onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                  placeholder="Barcode"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="costPrice">Cost Price</Label>
                <Input
                  id="costPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.costPrice}
                  onChange={(e) => setForm({ ...form, costPrice: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sellingPrice">Selling Price</Label>
                <Input
                  id="sellingPrice"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.sellingPrice}
                  onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.categoryId || 'none'}
                  onValueChange={(v) => setForm({ ...form, categoryId: v === 'none' ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No category</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unit</Label>
                <Input
                  id="unit"
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  placeholder="pcs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="minStock">Min Stock</Label>
                <Input
                  id="minStock"
                  type="number"
                  min="0"
                  value={form.minStock}
                  onChange={(e) => setForm({ ...form, minStock: e.target.value })}
                />
              </div>
              {!editingProduct && (
                <div className="space-y-2">
                  <Label htmlFor="initialStock">Initial Stock</Label>
                  <Input
                    id="initialStock"
                    type="number"
                    min="0"
                    value={form.initialStock}
                    onChange={(e) => setForm({ ...form, initialStock: e.target.value })}
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.trackStock}
                  onChange={(e) => setForm({ ...form, trackStock: e.target.checked })}
                  className="rounded border-input"
                />
                Track stock
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.isFavorite}
                  onChange={(e) => setForm({ ...form, isFavorite: e.target.checked })}
                  className="rounded border-input"
                />
                Favorite (POS)
              </label>
            </div>

            {editingProduct && (
              <ProductVariantsEditor productId={editingProduct.id} canEdit={can('products.edit')} />
            )}

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending
                  ? 'Saving...'
                  : editingProduct
                    ? 'Save Changes'
                    : 'Create Product'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ShopExcelImportDialog
        open={shopImportOpen}
        onClose={() => setShopImportOpen(false)}
        onComplete={() => queryClient.invalidateQueries({ queryKey: ['products'] })}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Remove from catalog"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be marked unavailable and hidden from POS and this list. Sales history is kept. You can add a new product with the same name later if needed.`
            : undefined
        }
        confirmLabel="Remove"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
