import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CreditCard, TrendingUp, Users, Package, Building2, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/shared/PageHeader';
import { PageContainer } from '@/components/shared/PageContainer';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/shared/QueryState';
import { formatCurrency, formatDate } from '@/lib/utils';

interface BillingOverview {
  organization: { id: string; name: string; status: string; billingPhone?: string };
  subscription: {
    planCode: string;
    planName: string;
    billingInterval: string;
    status: string;
    amountCents: number;
    currency: string;
    currentPeriodEnd?: string;
    autoRenew?: boolean;
  } | null;
  usage: {
    users: { current: number; limit: number | null };
    branches: { current: number; limit: number | null };
    products: { current: number; limit: number | null };
  };
  invoices: Array<{ id: string; invoiceNumber: string; status: string; totalCents: number; currency: string; createdAt: string }>;
  payments: Array<{ id: string; status: string; amountCents: number; currency: string; paidAt?: string; createdAt: string }>;
  billingContacts: Array<{ id: string; role: string; user: { firstName: string; lastName: string; email: string } }>;
}

interface Plan {
  id: string;
  code: string;
  name: string;
  description?: string;
  prices: Array<{ billingInterval: string; amountCents: number; currency: string }>;
  features: Array<{ feature: string; value: string }>;
}

export default function BillingPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [interval, setInterval] = useState<'MONTHLY' | 'ANNUAL'>('MONTHLY');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [payMessage, setPayMessage] = useState('');

  const canView = can('billing.view') || can('subscription.view');
  const canPay = can('billing.pay') || can('billing.manage');
  const canManage = can('billing.manage') || can('subscription.manage');

  const { data, isLoading, isError, error, refetch } = useQuery<BillingOverview>({
    queryKey: ['billing-overview'],
    queryFn: () => api.get('/billing/overview'),
    enabled: canView,
  });

  const { data: plans } = useQuery<Plan[]>({
    queryKey: ['billing-plans'],
    queryFn: () => api.get('/billing/plans'),
    enabled: canView,
  });

  const payMutation = useMutation({
    mutationFn: () => api.post<{ customerMessage?: string; mock?: boolean }>('/billing/pay', {
      phoneNumber: phoneNumber || undefined,
    }),
    onSuccess: (result) => {
      setPayMessage(result.customerMessage ?? 'STK push sent. Check your phone.');
      queryClient.invalidateQueries({ queryKey: ['billing-overview'] });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (body: { billingPhone?: string; autoRenew?: boolean }) =>
      api.patch('/billing/settings', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing-overview'] }),
  });

  const changePlanMutation = useMutation({
    mutationFn: (planCode: string) => api.post('/billing/change-plan', { planCode, billingInterval: interval }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['billing-overview'] }),
  });

  useEffect(() => {
    if (!data) return;
    if (data.organization.billingPhone) setPhoneNumber(data.organization.billingPhone);
    if (data.subscription?.autoRenew !== undefined) setAutoRenew(data.subscription.autoRenew);
  }, [data]);

  if (!canView) {
    return (
      <PageContainer className="p-6">
        <ErrorState title="Access denied" message="You do not have permission to view billing." />
      </PageContainer>
    );
  }

  if (isLoading) {
    return (
      <PageContainer className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </PageContainer>
    );
  }

  if (isError || !data) {
    return (
      <PageContainer className="p-6">
        <ErrorState message={error instanceof Error ? error.message : 'Failed to load billing'} onRetry={() => refetch()} />
      </PageContainer>
    );
  }

  const sub = data.subscription;
  const statusColor =
    sub?.status === 'ACTIVE' ? 'default' : sub?.status === 'PAST_DUE' ? 'destructive' : 'secondary';

  return (
    <PageContainer className="p-6 space-y-6 animate-fade-in">
      <PageHeader
        title="Billing & Subscription"
        description="Manage your GOROVIAN POS plan, usage, and payment history."
        icon={CreditCard}
        actions={
          canPay && sub ? (
            <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || !phoneNumber}>
              {payMutation.isPending ? 'Sending STK...' : 'Pay / Renew'}
            </Button>
          ) : undefined
        }
      />

      {sub && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{sub.planName} Plan</CardTitle>
                <CardDescription>
                  {formatCurrency(sub.amountCents, sub.currency)} / {sub.billingInterval.toLowerCase()}
                </CardDescription>
              </div>
              <Badge variant={statusColor}>{sub.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {sub.currentPeriodEnd && <p className="text-muted-foreground">Renews: {formatDate(sub.currentPeriodEnd)}</p>}
            {canPay && (
              <div className="flex flex-wrap items-end gap-3 border-t pt-4">
                <div className="space-y-1">
                  <Label htmlFor="mpesa-phone">M-Pesa phone</Label>
                  <Input
                    id="mpesa-phone"
                    placeholder="07XXXXXXXX"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    className="w-44"
                  />
                </div>
                <Button onClick={() => payMutation.mutate()} disabled={payMutation.isPending || !phoneNumber}>
                  {payMutation.isPending ? 'Sending STK...' : 'Pay with M-Pesa'}
                </Button>
              </div>
            )}
            {payMessage && <p className="text-green-700">{payMessage}</p>}
            {canManage && (
              <div className="flex items-center gap-3 border-t pt-4">
                <input
                  id="auto-renew"
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(e) => {
                    setAutoRenew(e.target.checked);
                    settingsMutation.mutate({ billingPhone: phoneNumber || undefined, autoRenew: e.target.checked });
                  }}
                  className="h-4 w-4"
                />
                <Label htmlFor="auto-renew">Auto-renew via M-Pesa on renewal date</Label>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard title="Users" value={data.usage.users.current} format="number" subtitle={data.usage.users.limit ? `Limit: ${data.usage.users.limit}` : undefined} icon={Users} />
        <StatCard title="Branches" value={data.usage.branches.current} format="number" subtitle={data.usage.branches.limit ? `Limit: ${data.usage.branches.limit}` : undefined} icon={Building2} />
        <StatCard title="Products" value={data.usage.products.current} format="number" subtitle={data.usage.products.limit ? `Limit: ${data.usage.products.limit}` : undefined} icon={Package} />
      </div>

      {canManage && plans && plans.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Plans</CardTitle>
            <CardDescription>Compare plans and upgrade or downgrade</CardDescription>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant={interval === 'MONTHLY' ? 'default' : 'outline'}
                onClick={() => setInterval('MONTHLY')}
              >
                Monthly
              </Button>
              <Button
                size="sm"
                variant={interval === 'ANNUAL' ? 'default' : 'outline'}
                onClick={() => setInterval('ANNUAL')}
              >
                Annual (save more)
              </Button>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => {
              const price = plan.prices.find((p) => p.billingInterval === interval);
              const monthly = plan.prices.find((p) => p.billingInterval === 'MONTHLY');
              const annual = plan.prices.find((p) => p.billingInterval === 'ANNUAL');
              const savings =
                monthly && annual ? monthly.amountCents * 12 - annual.amountCents : 0;
              const isCurrent = sub?.planCode === plan.code;

              return (
                <div key={plan.id} className={`border p-4 ${isCurrent ? 'border-primary' : ''}`}>
                  <p className="font-semibold">{plan.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">{plan.description}</p>
                  <p className="text-xl font-bold mt-3">
                    {price
                      ? formatCurrency(price.amountCents, price.currency)
                      : plan.code === 'ENTERPRISE'
                        ? `From ${formatCurrency(monthly?.amountCents ?? 15000, 'KES')}`
                        : '—'}
                    <span className="text-sm font-normal text-muted-foreground">
                      /{interval === 'MONTHLY' ? 'mo' : 'yr'}
                    </span>
                  </p>
                  {interval === 'ANNUAL' && savings > 0 && (
                    <p className="text-xs text-green-600 mt-1">Save {formatCurrency(savings, 'KES')}/year</p>
                  )}
                  {canManage && !isCurrent && (
                    <Button
                      size="sm"
                      className="mt-3 w-full"
                      variant="outline"
                      disabled={changePlanMutation.isPending}
                      onClick={() => changePlanMutation.mutate(plan.code)}
                    >
                      Switch to {plan.name}
                    </Button>
                  )}
                  {isCurrent && <Badge className="mt-3">Current plan</Badge>}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {data.billingContacts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Billing contacts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.billingContacts.map((c) => (
              <div key={c.id} className="flex justify-between border p-3 text-sm">
                <span>{c.user.firstName} {c.user.lastName} ({c.user.email})</span>
                <Badge variant="secondary">{c.role}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4" /> Recent Invoices</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.invoices.length === 0 && <p className="text-sm text-muted-foreground">No invoices yet.</p>}
            {data.invoices.map((inv) => (
              <div key={inv.id} className="flex justify-between border p-3 text-sm">
                <span>{inv.invoiceNumber}</span>
                <span className="font-medium">{formatCurrency(inv.totalCents, inv.currency)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Payment History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.payments.length === 0 && <p className="text-sm text-muted-foreground">No payments yet.</p>}
            {data.payments.map((p) => (
              <div key={p.id} className="flex justify-between border p-3 text-sm">
                <Badge variant={p.status === 'SUCCEEDED' ? 'default' : 'secondary'}>{p.status}</Badge>
                <span className="font-medium">{formatCurrency(p.amountCents, p.currency)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
