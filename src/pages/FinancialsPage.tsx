import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DollarSign,
  Plus,
  Download,
  Trash2,
  TrendingUp,
  TrendingDown,
  Receipt,
  Percent,
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
import { StatCard } from '@/components/dashboard/StatCard';
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface Expense {
  id: string;
  category: string;
  amount: number;
  description?: string;
  reference?: string;
  date: string;
  createdAt: string;
  user: { firstName: string; lastName: string };
  branch?: { name: string };
}

interface FinancialSummary {
  todayIncome: number;
  todayExpenses: number;
  monthIncome: number;
  monthExpenses: number;
  monthProfit: number;
  todayProfit: number;
}

interface Tax {
  id: string;
  name: string;
  rate: number;
  isInclusive: boolean;
}

interface ExpenseForm {
  category: string;
  amount: string;
  description: string;
  reference: string;
  date: string;
}

const EXPENSE_CATEGORIES = [
  'Rent',
  'Utilities',
  'Salaries',
  'Supplies',
  'Marketing',
  'Maintenance',
  'Insurance',
  'Transportation',
  'Other',
];

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Categories' },
  ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c })),
];

const emptyExpenseForm: ExpenseForm = {
  category: 'Other',
  amount: '',
  description: '',
  reference: '',
  date: new Date().toISOString().split('T')[0],
};

function categoryVariant(category: string): 'default' | 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (category) {
    case 'Rent':
    case 'Salaries':
      return 'warning';
    case 'Utilities':
    case 'Supplies':
      return 'secondary';
    case 'Marketing':
      return 'default';
    default:
      return 'secondary';
  }
}

export default function FinancialsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ExpenseForm>(emptyExpenseForm);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);

  const debouncedSearch = useDebounce(search);

  const canView = can('financials.view');
  const canCreate = can('financials.create');
  const canEdit = can('financials.edit');

  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
    refetch: refetchSummary,
  } = useQuery<FinancialSummary>({
    queryKey: ['financials-summary'],
    queryFn: () => api.get('/financials/summary'),
    enabled: canView,
  });

  const { data: taxes = [] } = useQuery<Tax[]>({
    queryKey: ['financials-taxes'],
    queryFn: () => api.get('/financials/taxes'),
    enabled: canView,
  });

  const {
    data: expensesData,
    isLoading,
    error,
    refetch,
  } = useQuery<PaginatedResult<Expense>>({
    queryKey: ['expenses', page, debouncedSearch, categoryFilter, sortBy, sortOrder],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (categoryFilter !== 'all') params.set('category', categoryFilter);
      return api.get(`/financials/expenses?${params}`);
    },
    enabled: canView,
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      category: string;
      amount: number;
      description?: string;
      reference?: string;
      date?: string;
    }) => api.post('/financials/expenses', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financials-summary'] });
      setDialogOpen(false);
      setForm(emptyExpenseForm);
      setFormError('');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/financials/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['financials-summary'] });
      setDeleteTarget(null);
    },
  });

  const openCreate = () => {
    setForm({ ...emptyExpenseForm, date: new Date().toISOString().split('T')[0] });
    setFormError('');
    setDialogOpen(true);
  };

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (!form.category) {
      setFormError('Please select a category.');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      setFormError('Enter a valid amount greater than zero.');
      return;
    }

    createMutation.mutate({
      category: form.category,
      amount,
      description: form.description.trim() || undefined,
      reference: form.reference.trim() || undefined,
      date: form.date || undefined,
    });
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

  const handleExport = () => {
    const rows = expensesData?.data ?? [];
    if (!rows.length) return;
    exportToCSV(
      rows.map((e) => ({
        date: formatDate(e.date),
        category: e.category,
        amount: e.amount,
        description: e.description ?? '',
        reference: e.reference ?? '',
        recordedBy: `${e.user.firstName} ${e.user.lastName}`,
        branch: e.branch?.name ?? '',
      })),
      'expenses',
      [
        { key: 'date', label: 'Date' },
        { key: 'category', label: 'Category' },
        { key: 'amount', label: 'Amount' },
        { key: 'description', label: 'Description' },
        { key: 'reference', label: 'Reference' },
        { key: 'recordedBy', label: 'Recorded By' },
        { key: 'branch', label: 'Branch' },
      ]
    );
  };

  const expenseColumns: Column<Expense>[] = [
    {
      key: 'date',
      label: 'Date',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{formatDate(row.date)}</p>
          <p className="text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (row) => (
        <Badge variant={categoryVariant(row.category)}>{row.category}</Badge>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      sortable: true,
      render: (row) => (
        <span className="font-semibold text-destructive">{formatCurrency(row.amount)}</span>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      render: (row) => (
        <span className="text-muted-foreground truncate max-w-xs block">
          {row.description ?? '—'}
        </span>
      ),
    },
    {
      key: 'reference',
      label: 'Reference',
      render: (row) => row.reference ?? '—',
    },
    {
      key: 'user',
      label: 'Recorded By',
      render: (row) => `${row.user.firstName} ${row.user.lastName}`,
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'w-16',
      render: (row) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDeleteTarget(row)}
              title="Delete expense"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={DollarSign}
          title="Access Denied"
          description="You don't have permission to view financials."
        />
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Financials"
        description="Track income, expenses, profit, and cash flow."
        icon={DollarSign}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={!expensesData?.data.length}
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            {canCreate && (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                Add Expense
              </Button>
            )}
          </>
        }
      />

      {summaryLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-sm" />
          ))}
        </div>
      ) : summaryError ? (
        <Card className="mb-6">
          <CardContent className="py-8 text-center">
            <p className="text-destructive mb-2">Failed to load summary</p>
            <Button variant="outline" size="sm" onClick={() => refetchSummary()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : summary ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-6">
          <StatCard
            title="Month Income"
            value={summary.monthIncome}
            format="currency"
            subtitle={`Today: ${formatCurrency(summary.todayIncome)}`}
            icon={TrendingUp}
            variant="success"
          />
          <StatCard
            title="Month Expenses"
            value={summary.monthExpenses}
            format="currency"
            subtitle={`Today: ${formatCurrency(summary.todayExpenses)}`}
            icon={TrendingDown}
            variant="danger"
          />
          <StatCard
            title="Month Profit"
            value={summary.monthProfit}
            format="currency"
            icon={DollarSign}
            variant={summary.monthProfit >= 0 ? 'success' : 'danger'}
          />
          <StatCard
            title="Today's Profit"
            value={summary.todayProfit}
            format="currency"
            icon={Receipt}
            variant={summary.todayProfit >= 0 ? 'success' : 'danger'}
          />
        </div>
      ) : null}

      {taxes.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Percent className="h-4 w-4" />
              Active Tax Rates
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {taxes.map((tax) => (
                <Badge key={tax.id} variant="secondary">
                  {tax.name}: {tax.rate}%
                  {tax.isInclusive ? ' (incl.)' : ''}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <DataTable
        columns={expenseColumns}
        data={expensesData?.data ?? []}
        loading={isLoading}
        error={error?.message ?? null}
        onRetry={() => refetch()}
        emptyIcon={Receipt}
        emptyTitle="No expenses recorded"
        emptyDescription="Add your first expense to start tracking costs."
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search by description..."
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSort={handleSort}
        pagination={expensesData?.pagination}
        onPageChange={setPage}
        rowKey={(row) => row.id}
        filters={
          <Select
            value={categoryFilter}
            onValueChange={(v) => {
              setCategoryFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
            <DialogDescription>Record a new business expense.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="expenseDate">Date</Label>
              <Input
                id="expenseDate"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Input
                id="description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What was this expense for?"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reference">Reference</Label>
              <Input
                id="reference"
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="Invoice or receipt number"
              />
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={createMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Saving...' : 'Add Expense'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Expense"
        description={
          deleteTarget
            ? `Delete ${deleteTarget.category} expense of ${formatCurrency(deleteTarget.amount)}${deleteTarget.description ? ` — "${deleteTarget.description}"` : ''}? This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
      />
    </div>
  );
}
