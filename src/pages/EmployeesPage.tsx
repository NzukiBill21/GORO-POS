import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserCog,
  Plus,
  Download,
  Pencil,
  UserCheck,
  UserX,
  History,
  Users,
  Shield,
} from 'lucide-react';
import { api } from '@/lib/api';
import { toastSuccess } from '@/lib/toast';
import { exportToCSV } from '@/lib/permissions';
import { formatDateTime } from '@/lib/utils';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Role {
  id: string;
  name: string;
  description?: string;
}

interface Employee {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  role: Role;
  branch?: { name: string };
}

interface ActivityLog {
  id: string;
  action: string;
  module: string;
  details?: string;
  createdAt: string;
  user?: { firstName: string; lastName: string };
}

interface PaginatedResult<T> {
  data: T[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

interface EmployeeForm {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roleId: string;
  phone: string;
}

const emptyForm: EmployeeForm = {
  email: '',
  password: '',
  firstName: '',
  lastName: '',
  roleId: '',
  phone: '',
};

type Tab = 'employees' | 'activity' | 'roles';

function formatRoleName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

const ROLE_ACCESS: Record<string, string[]> = {
  administrator: ['Full access to every module, settings, security, and employee management'],
  manager: ['All modules except employee admin (view-only on staff)'],
  supervisor: ['POS, sales, inventory, customers, purchases (view), reports (view)'],
  cashier: ['POS checkout, product lookup, customer lookup, own sales history'],
};

export default function EmployeesPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>('employees');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('firstName');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [toggleTarget, setToggleTarget] = useState<Employee | null>(null);

  const [activityPage, setActivityPage] = useState(1);
  const debouncedSearch = useDebounce(search);

  const canView = can('employees.view');
  const canCreate = can('employees.create');
  const canEdit = can('employees.edit');

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ['employee-roles'],
    queryFn: () => api.get('/employees/roles/list'),
    enabled: canView,
  });

  const {
    data: employeesData,
    isLoading,
    error,
    refetch,
  } = useQuery<PaginatedResult<Employee>>({
    queryKey: ['employees', page, debouncedSearch, sortBy, sortOrder],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '20',
        sortBy,
        sortOrder,
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      return api.get(`/employees?${params}`);
    },
    enabled: canView && tab === 'employees',
  });

  const {
    data: activityData,
    isLoading: activityLoading,
    error: activityError,
    refetch: refetchActivity,
  } = useQuery<PaginatedResult<ActivityLog>>({
    queryKey: ['employee-activity', activityPage],
    queryFn: () => api.get(`/employees/activity/logs?page=${activityPage}&limit=20`),
    enabled: canView && tab === 'activity',
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Partial<EmployeeForm> & { id?: string }) => {
      if (payload.id) {
        const { id, password, ...rest } = payload;
        const body = password ? { ...rest, password } : rest;
        return api.put(`/employees/${id}`, body);
      }
      if (!payload.password?.trim()) {
        const { password: _p, ...inviteBody } = payload;
        return api.post('/employees/invite', inviteBody);
      }
      return api.post('/employees', payload);
    },
    onSuccess: (_data, variables) => {
      const wasEdit = editing !== null;
      const invited = !wasEdit && !variables.password?.trim();
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm);
      setFormError('');
      toastSuccess(wasEdit ? 'Employee updated' : invited ? 'Invitation sent' : 'Employee added');
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.post(`/employees/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['employees'] });
      const wasActive = toggleTarget?.isActive;
      setToggleTarget(null);
      toastSuccess(wasActive ? 'Employee deactivated' : 'Employee activated');
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, roleId: roles[0]?.id ?? '' });
    setFormError('');
    setDialogOpen(true);
  };

  const openEdit = (employee: Employee) => {
    setEditing(employee);
    setForm({
      email: employee.email,
      password: '',
      firstName: employee.firstName,
      lastName: employee.lastName,
      roleId: employee.role.id,
      phone: employee.phone ?? '',
    });
    setFormError('');
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      setFormError('First name, last name, and email are required.');
      return;
    }
    if (!form.roleId) {
      setFormError('Please select a role.');
      return;
    }

    saveMutation.mutate(
      editing
        ? { id: editing.id, ...form, password: form.password || undefined }
        : form
    );
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
    const rows = employeesData?.data ?? [];
    if (!rows.length) return;
    exportToCSV(
      rows.map((e) => ({
        name: `${e.firstName} ${e.lastName}`,
        email: e.email,
        role: e.role.name,
        branch: e.branch?.name ?? '',
        phone: e.phone ?? '',
        status: e.isActive ? 'Active' : 'Inactive',
        lastLogin: e.lastLoginAt ? formatDateTime(e.lastLoginAt) : '',
      })),
      'employees',
      [
        { key: 'name', label: 'Name' },
        { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role' },
        { key: 'branch', label: 'Branch' },
        { key: 'phone', label: 'Phone' },
        { key: 'status', label: 'Status' },
        { key: 'lastLogin', label: 'Last Login' },
      ]
    );
  };

  const employeeColumns: Column<Employee>[] = [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-medium">{row.firstName} {row.lastName}</p>
          <p className="text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      render: (row) => <Badge variant="secondary">{row.role.name}</Badge>,
    },
    {
      key: 'branch',
      label: 'Branch',
      render: (row) => row.branch?.name ?? '—',
    },
    {
      key: 'phone',
      label: 'Phone',
      render: (row) => row.phone ?? '—',
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (row) => (
        <Badge variant={row.isActive ? 'success' : 'destructive'}>
          {row.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'lastLoginAt',
      label: 'Last Login',
      sortable: true,
      render: (row) => (row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'Never'),
    },
    {
      key: 'actions',
      label: 'Actions',
      className: 'w-32',
      render: (row) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={() => openEdit(row)} title="Edit">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setToggleTarget(row)}
                title={row.isActive ? 'Deactivate' : 'Activate'}
              >
                {row.isActive ? (
                  <UserX className="h-4 w-4 text-destructive" />
                ) : (
                  <UserCheck className="h-4 w-4 text-success" />
                )}
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const activityColumns: Column<ActivityLog>[] = [
    {
      key: 'user',
      label: 'User',
      render: (row) =>
        row.user ? `${row.user.firstName} ${row.user.lastName}` : 'System',
    },
    {
      key: 'action',
      label: 'Action',
      render: (row) => <Badge variant="secondary">{row.action}</Badge>,
    },
    { key: 'module', label: 'Module' },
    {
      key: 'details',
      label: 'Details',
      render: (row) => (
        <span className="text-muted-foreground truncate max-w-xs block">
          {row.details ?? '—'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      label: 'Date',
      render: (row) => formatDateTime(row.createdAt),
    },
  ];

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={UserCog}
          title="Access Denied"
          description="You don't have permission to view employees."
        />
      </div>
    );
  }

  return (
    <div className="p-6 animate-fade-in">
      <PageHeader
        title="Employees"
        description="Manage staff, roles, and activity logs."
        icon={UserCog}
        actions={
          tab === 'employees' && (
            <>
              <Button variant="outline" onClick={handleExport} disabled={!employeesData?.data.length}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              {canCreate && (
                <Button onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Employee
                </Button>
              )}
            </>
          )
        }
      />

      <div className="flex gap-2 mb-6">
        <Button
          variant={tab === 'employees' ? 'default' : 'outline'}
          onClick={() => setTab('employees')}
        >
          <Users className="h-4 w-4 mr-2" />
          Employees
        </Button>
        <Button
          variant={tab === 'activity' ? 'default' : 'outline'}
          onClick={() => setTab('activity')}
        >
          <History className="h-4 w-4 mr-2" />
          Activity Log
        </Button>
        <Button
          variant={tab === 'roles' ? 'default' : 'outline'}
          onClick={() => setTab('roles')}
        >
          <Shield className="h-4 w-4 mr-2" />
          Roles
        </Button>
      </div>

      {tab === 'roles' ? (
        <div className="grid gap-4 md:grid-cols-2">
          {roles.map((role) => (
            <Card key={role.id}>
              <CardHeader>
                <CardTitle className="capitalize">{formatRoleName(role.name)}</CardTitle>
                <CardDescription>{role.description ?? 'System role'}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
                  {(ROLE_ACCESS[role.name] ?? ['Standard module access']).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
          {roles.length === 0 && (
            <EmptyState
              icon={Shield}
              title="No roles loaded"
              description="Roles are created during database seeding."
            />
          )}
        </div>
      ) : tab === 'employees' ? (
        <DataTable
          columns={employeeColumns}
          data={employeesData?.data ?? []}
          loading={isLoading}
          error={error?.message ?? null}
          onRetry={() => refetch()}
          emptyIcon={UserCog}
          emptyTitle="No employees found"
          emptyDescription="Add your first team member to get started."
          search={search}
          onSearchChange={(v) => { setSearch(v); setPage(1); }}
          searchPlaceholder="Search by name or email..."
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          pagination={employeesData?.pagination}
          onPageChange={setPage}
          rowKey={(row) => row.id}
        />
      ) : (
        <DataTable
          columns={activityColumns}
          data={activityData?.data ?? []}
          loading={activityLoading}
          error={activityError?.message ?? null}
          onRetry={() => refetchActivity()}
          emptyIcon={History}
          emptyTitle="No activity logs"
          emptyDescription="Employee actions will appear here."
          pagination={activityData?.pagination}
          onPageChange={setActivityPage}
          rowKey={(row) => row.id}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Employee' : 'Add Employee'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update employee details and role.'
                : 'Set a temporary password for local sign-in (required on first login), or leave password blank to send an email invitation instead.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                disabled={!!editing}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                Password{' '}
                {!editing && <span className="text-muted-foreground font-normal">(optional — invite by email)</span>}
                {editing && <span className="text-muted-foreground font-normal">(leave blank to keep)</span>}
              </Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={form.roleId} onValueChange={(v) => setForm({ ...form, roleId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saveMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : editing ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!toggleTarget}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title={toggleTarget?.isActive ? 'Deactivate Employee' : 'Activate Employee'}
        description={
          toggleTarget
            ? `Are you sure you want to ${toggleTarget.isActive ? 'deactivate' : 'activate'} ${toggleTarget.firstName} ${toggleTarget.lastName}?`
            : ''
        }
        confirmLabel={toggleTarget?.isActive ? 'Deactivate' : 'Activate'}
        variant={toggleTarget?.isActive ? 'destructive' : 'default'}
        loading={toggleMutation.isPending}
        onConfirm={() => toggleTarget && toggleMutation.mutate(toggleTarget.id)}
      />
    </div>
  );
}
