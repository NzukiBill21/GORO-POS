import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Building2, CreditCard, TrendingUp, AlertTriangle, CheckCircle, PauseCircle, LogOut,
  Activity, Shield, Search, Plus,
} from 'lucide-react';
import { platformApi } from '@/lib/platformApi';
import { usePlatformAuthStore, platformCan } from '@/stores/platformAuthStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { GorovianLogo } from '@/components/shared/GorovianLogo';
import { PageContainer } from '@/components/shared/PageContainer';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ErrorState } from '@/components/shared/QueryState';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PlatformOrgDetailDialog } from '@/components/platform/PlatformOrgDetailDialog';

interface PlatformHealth {
  dbOk: boolean;
  orgCount: number;
  pendingBillingPayments: number;
  failedBillingPayments24h: number;
  billingEnabled: boolean;
  mpesaEnv: string;
  mpesaMockEnabled: boolean;
  mpesaMockProductionSafe: boolean;
  nodeEnv: string;
}

interface PlatformOverview {
  totalOrganizations: number;
  subscriptionsByStatus: Record<string, number>;
  subscriptionsByPlan: Record<string, number>;
  mrrCents: number;
  arrCents: number;
  pilotActiveCount: number;
  paymentsByStatus: Record<string, number>;
  verifiedRevenueCents: number;
  recentPayments: Array<{
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    paidAt?: string;
    business?: { name: string };
  }>;
  recentBillingPayments: Array<{
    id: string;
    amountCents: number;
    currency: string;
    status: string;
    paidAt?: string | null;
    failureReason?: string | null;
    businessName: string;
    verifiedCallback: boolean;
    paymentEnvironment: string;
  }>;
  recentPaymentAttempts: Array<{
    id: string;
    status: string;
    failureReason?: string | null;
    attemptedAt: string;
    paymentStatus: string;
    amountCents: number;
    businessName?: string;
  }>;
  health: PlatformHealth;
}

interface OrganizationRow {
  id: string;
  name: string;
  email: string;
  status: string;
  userCount: number;
  productCount: number;
  subscription: {
    status: string;
    planCode: string;
    planName: string;
    billingInterval: string;
    currentPeriodEnd: string;
  } | null;
  pilot: { planCode?: string; grantedAt: string } | null;
  owner: { email: string; firstName: string; lastName: string; lastLoginAt?: string | null } | null;
  lastActivityAt?: string | null;
  onboarding: { label: string; steps: string[] };
}

interface AuditRow {
  id: string;
  action: string;
  reason?: string | null;
  details?: string | null;
  createdAt: string;
  targetBusinessId?: string | null;
  platformUser: { email: string; firstName: string; lastName: string };
}

function paymentStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'SUCCEEDED') return 'default';
  if (status === 'PENDING') return 'secondary';
  if (status === 'FAILED') return 'destructive';
  return 'outline';
}

export default function PlatformBillingPage() {
  const { user, isAuthenticated, logout } = usePlatformAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canManage = platformCan(user?.permissions ?? [], 'platform.organizations.manage');

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [pilotOnly, setPilotOnly] = useState(false);

  const [suspendTarget, setSuspendTarget] = useState<OrganizationRow | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [reactivateTarget, setReactivateTarget] = useState<OrganizationRow | null>(null);
  const [reactivateReason, setReactivateReason] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    businessName: '', ownerEmail: '', ownerFirstName: '', ownerLastName: '', planCode: 'REGULAR',
  });
  const [createResult, setCreateResult] = useState<{
    ownerEmail?: string;
    message?: string;
    invitation?: { deliveryStatus?: string; emailDeliveryError?: string | null; devHint?: string };
  } | null>(null);
  const [detailOrgId, setDetailOrgId] = useState<string | null>(null);

  const { data: overview, isLoading, isError, error, refetch } = useQuery<PlatformOverview>({
    queryKey: ['platform-billing'],
    queryFn: () => platformApi.get('/billing/overview'),
    enabled: isAuthenticated,
  });

  const orgQueryKey = ['platform-orgs', search, statusFilter, pilotOnly] as const;
  const { data: orgs } = useQuery<OrganizationRow[]>({
    queryKey: orgQueryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (pilotOnly) params.set('pilotOnly', 'true');
      const q = params.toString();
      return platformApi.get(`/organizations${q ? `?${q}` : ''}`);
    },
    enabled: isAuthenticated && platformCan(user?.permissions ?? [], 'platform.organizations.view'),
  });

  const { data: auditLogs } = useQuery<AuditRow[]>({
    queryKey: ['platform-audit'],
    queryFn: () => platformApi.get('/audit-logs?limit=40'),
    enabled: isAuthenticated,
  });

  const invalidateOrgs = () => {
    queryClient.invalidateQueries({ queryKey: ['platform-orgs'] });
    queryClient.invalidateQueries({ queryKey: ['platform-billing'] });
    queryClient.invalidateQueries({ queryKey: ['platform-audit'] });
  };

  const suspendMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      platformApi.post(`/organizations/${id}/suspend`, { reason }),
    onSuccess: () => { setSuspendTarget(null); setSuspendReason(''); invalidateOrgs(); },
  });

  const reactivateMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      platformApi.post(`/organizations/${id}/reactivate`, { reason }),
    onSuccess: () => { setReactivateTarget(null); setReactivateReason(''); invalidateOrgs(); },
  });

  const createMutation = useMutation({
    mutationFn: () => platformApi.post<{
      ownerEmail: string;
      message: string;
      invitation?: { deliveryStatus?: string; emailDeliveryError?: string | null; devHint?: string };
    }>('/organizations', createForm),
    onSuccess: (data) => {
      setCreateResult({ ownerEmail: data.ownerEmail, message: data.message, invitation: data.invitation });
      invalidateOrgs();
    },
  });

  if (!isAuthenticated) {
    navigate('/platform/login');
    return null;
  }

  if (isLoading) {
    return (
      <PageContainer className="p-6 space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
        </div>
      </PageContainer>
    );
  }

  if (isError || !overview) {
    return (
      <PageContainer className="p-6">
        <ErrorState message={error instanceof Error ? error.message : 'Failed to load'} onRetry={() => refetch()} />
      </PageContainer>
    );
  }

  const health = overview.health;
  const active = overview.subscriptionsByStatus.ACTIVE ?? 0;
  const trialing = overview.subscriptionsByStatus.TRIALING ?? 0;
  const pastDue = overview.subscriptionsByStatus.PAST_DUE ?? 0;
  const suspended = overview.subscriptionsByStatus.SUSPENDED ?? 0;

  return (
    <PageContainer className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 border-b pb-4">
        <GorovianLogo size="sm" />
        <div>
          <p className="text-sm font-bold tracking-tight">GOROVIAN Admin</p>
          <p className="text-xs text-muted-foreground">SaaS operations console</p>
        </div>
      </div>
      <PageHeader
        title="Platform operations"
        description={`Signed in as ${user?.email}`}
        icon={CreditCard}
        actions={
          <Button variant="outline" onClick={() => { logout(); navigate('/platform/login'); }}>
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        }
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Operational health</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3 text-sm">
          <Badge variant={health.dbOk ? 'default' : 'destructive'}>Database {health.dbOk ? 'OK' : 'DOWN'}</Badge>
          <Badge variant="outline">Node: {health.nodeEnv}</Badge>
          <Badge variant={health.billingEnabled ? 'secondary' : 'outline'}>
            Billing gate {health.billingEnabled ? 'on' : 'off'}
          </Badge>
          <Badge variant="outline">M-Pesa env: {health.mpesaEnv}</Badge>
          {health.mpesaMockEnabled && (
            <Badge variant={health.mpesaMockProductionSafe ? 'secondary' : 'destructive'}>
              MPESA_MOCK {health.mpesaMockProductionSafe ? 'dev only' : 'BLOCKED in prod'}
            </Badge>
          )}
          <span className="text-muted-foreground">Pending payments: {health.pendingBillingPayments}</span>
          <span className="text-muted-foreground">Failed (24h): {health.failedBillingPayments24h}</span>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Organizations" value={overview.totalOrganizations} format="number" icon={Building2} />
        <StatCard title="Active pilots" value={overview.pilotActiveCount} format="number" icon={Shield} />
        <StatCard title="MRR (list price)" value={overview.mrrCents} format="currency" icon={TrendingUp} />
        <StatCard title="Verified revenue" value={overview.verifiedRevenueCents} format="currency" icon={CheckCircle} />
        <StatCard title="Active subs" value={active + trialing} format="number" icon={CheckCircle} />
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Past due</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-2xl font-bold">
            <AlertTriangle className="h-5 w-5 text-destructive" /> {pastDue}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Suspended subs</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-2 text-2xl font-bold">
            <PauseCircle className="h-5 w-5" /> {suspended}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Payments by status</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {Object.keys(overview.paymentsByStatus).length === 0 && (
              <p className="text-muted-foreground">No billing payments recorded.</p>
            )}
            {Object.entries(overview.paymentsByStatus).map(([st, count]) => (
              <div key={st} className="flex justify-between"><span>{st}</span><span>{count}</span></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm">Plan distribution</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {Object.entries(overview.subscriptionsByPlan).map(([code, count]) => (
              <div key={code} className="flex justify-between"><span>{code}</span><span>{count}</span></div>
            ))}
          </CardContent>
        </Card>
      </div>

      {orgs && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Tenant directory</CardTitle>
            {canManage && (
              <Button size="sm" onClick={() => { setCreateOpen(true); setCreateResult(null); }}>
                <Plus className="mr-2 h-4 w-4" /> Create tenant
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search name or email"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="SUSPENDED">SUSPENDED</option>
              </select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={pilotOnly} onChange={(e) => setPilotOnly(e.target.checked)} />
                Pilots only
              </label>
            </div>
            {orgs.length === 0 && <p className="text-sm text-muted-foreground">No tenants match filters.</p>}
            {orgs.map((org) => (
              <div key={org.id} className="flex flex-wrap items-start justify-between gap-2 border p-3 text-sm">
                <div className="space-y-1 flex-1 min-w-[200px] cursor-pointer" onClick={() => setDetailOrgId(org.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setDetailOrgId(org.id)}>
                  <p className="font-medium underline-offset-2 hover:underline">{org.name}</p>
                  <p className="text-muted-foreground">
                    {org.subscription?.planName ?? 'No plan'} · {org.userCount} users · {org.productCount} products
                  </p>
                  {org.owner && (
                    <p className="text-muted-foreground">
                      Owner: {org.owner.firstName} {org.owner.lastName} ({org.owner.email})
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {org.onboarding.label}
                    {org.lastActivityAt ? ` · Last activity ${formatDate(org.lastActivityAt)}` : ' · No session activity'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {org.pilot && (
                    <Badge variant="outline" className="border-primary text-primary">
                      Pilot · {org.pilot.planCode ?? 'SPONSORED'}
                    </Badge>
                  )}
                  <Badge variant={org.status === 'ACTIVE' ? 'default' : 'destructive'}>{org.status}</Badge>
                  {org.subscription && <Badge variant="secondary">{org.subscription.status}</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => setDetailOrgId(org.id)}>Details</Button>
                  {canManage && (
                    org.status === 'SUSPENDED' ? (
                      <Button size="sm" variant="outline" onClick={() => setReactivateTarget(org)}>Reactivate</Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setSuspendTarget(org)}>Suspend</Button>
                    )
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Billing payments (all statuses)</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {overview.recentBillingPayments.length === 0 && (
              <p className="text-sm text-muted-foreground">No billing payments yet.</p>
            )}
            {overview.recentBillingPayments.map((p) => (
              <div key={p.id} className="flex flex-wrap justify-between gap-2 border p-3 text-sm">
                <div>
                  <p className="font-medium">{p.businessName}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.paymentEnvironment} · {p.verifiedCallback ? 'Callback verified' : 'Not verified via callback'}
                  </p>
                  {p.failureReason && <p className="text-xs text-destructive">{p.failureReason}</p>}
                </div>
                <div className="text-right">
                  <Badge variant={paymentStatusVariant(p.status)}>{p.status}</Badge>
                  <p>{formatCurrency(p.amountCents, p.currency)}</p>
                  <p className="text-xs text-muted-foreground">{p.paidAt ? formatDate(p.paidAt) : '—'}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Payment attempt diagnostics</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-96 overflow-y-auto">
            {overview.recentPaymentAttempts.length === 0 && (
              <p className="text-sm text-muted-foreground">No STK attempts logged.</p>
            )}
            {overview.recentPaymentAttempts.map((a) => (
              <div key={a.id} className="border p-3 text-sm">
                <div className="flex justify-between">
                  <span>{a.businessName ?? 'Unknown'}</span>
                  <span>{formatCurrency(a.amountCents, 'KES')}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Attempt {a.status} · Payment {a.paymentStatus} · {formatDate(a.attemptedAt)}
                </p>
                {a.failureReason && <p className="text-xs text-destructive">{a.failureReason}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {auditLogs && auditLogs.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Platform audit trail</CardTitle></CardHeader>
          <CardContent className="space-y-2 max-h-64 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="border p-2 text-xs">
                <span className="font-medium">{log.action}</span>
                {' · '}
                {log.platformUser.email}
                {' · '}
                {formatDate(log.createdAt)}
                {log.reason && <span className="text-muted-foreground"> — {log.reason}</span>}
                {log.details && <p className="text-muted-foreground">{log.details}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!suspendTarget} onOpenChange={(o) => !o && setSuspendTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {suspendTarget?.name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tenant users will be signed out and API access blocked. Data is retained.
          </p>
          <Label htmlFor="suspend-reason">Reason (required)</Label>
          <Input
            id="suspend-reason"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="e.g. Non-payment, abuse investigation"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={suspendReason.trim().length < 3 || suspendMutation.isPending}
              onClick={() => suspendTarget && suspendMutation.mutate({ id: suspendTarget.id, reason: suspendReason.trim() })}
            >
              Confirm suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reactivateTarget} onOpenChange={(o) => !o && setReactivateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reactivate {reactivateTarget?.name}?</DialogTitle>
          </DialogHeader>
          <Label htmlFor="react-reason">Note (optional)</Label>
          <Input id="react-reason" value={reactivateReason} onChange={(e) => setReactivateReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReactivateTarget(null)}>Cancel</Button>
            <Button
              disabled={reactivateMutation.isPending}
              onClick={() => reactivateTarget && reactivateMutation.mutate({ id: reactivateTarget.id, reason: reactivateReason || undefined })}
            >
              Reactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create tenant & owner</DialogTitle>
          </DialogHeader>
          {createResult ? (
            <div className="space-y-2 text-sm">
              <p>Owner email: <strong>{createResult.ownerEmail}</strong></p>
              <p>{createResult.message}</p>
              {createResult.invitation?.deliveryStatus && (
                <p className="text-xs text-muted-foreground">Delivery: {createResult.invitation.deliveryStatus}</p>
              )}
              {createResult.invitation?.emailDeliveryError && (
                <p className="text-xs text-destructive">{createResult.invitation.emailDeliveryError}</p>
              )}
              {createResult.invitation?.devHint && (
                <p className="text-xs text-muted-foreground">{createResult.invitation.devHint}</p>
              )}
              <Button onClick={() => { setCreateOpen(false); setCreateResult(null); }}>Close</Button>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Business name</Label>
                <Input value={createForm.businessName} onChange={(e) => setCreateForm({ ...createForm, businessName: e.target.value })} />
                <Label>Owner email</Label>
                <Input type="email" value={createForm.ownerEmail} onChange={(e) => setCreateForm({ ...createForm, ownerEmail: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>First name</Label>
                    <Input value={createForm.ownerFirstName} onChange={(e) => setCreateForm({ ...createForm, ownerFirstName: e.target.value })} />
                  </div>
                  <div>
                    <Label>Last name</Label>
                    <Input value={createForm.ownerLastName} onChange={(e) => setCreateForm({ ...createForm, ownerLastName: e.target.value })} />
                  </div>
                </div>
                <Label>Plan code</Label>
                <Input value={createForm.planCode} onChange={(e) => setCreateForm({ ...createForm, planCode: e.target.value })} />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button
                  disabled={createMutation.isPending || !createForm.businessName || !createForm.ownerEmail}
                  onClick={() => createMutation.mutate()}
                >
                  Create
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PlatformOrgDetailDialog
        orgId={detailOrgId}
        open={!!detailOrgId}
        onOpenChange={(o) => !o && setDetailOrgId(null)}
        canManage={canManage}
        onMutated={() => {
          queryClient.invalidateQueries({ queryKey: ['platform-orgs'] });
          queryClient.invalidateQueries({ queryKey: ['platform-billing'] });
          queryClient.invalidateQueries({ queryKey: ['platform-audit'] });
        }}
      />
    </PageContainer>
  );
}
