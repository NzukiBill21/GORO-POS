import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { platformApi } from '@/lib/platformApi';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency, formatDate } from '@/lib/utils';

interface OrgDetail {
  id: string;
  name: string;
  status: string;
  owner: {
    email: string;
    firstName: string;
    lastName: string;
    mustSetPassword: boolean;
    lastLoginAt?: string | null;
  } | null;
  subscription: {
    status: string;
    planCode: string;
    planName: string;
    trialEndsAt?: string | null;
    currentPeriodEnd: string;
    billingInterval: string;
  } | null;
  pilot: { planCode?: string; grantedAt: string; notes?: string | null } | null;
  onboarding: { label: string; steps: string[] };
  lastActivityAt?: string | null;
  ownerInvitation: {
    inviteId?: string;
    expiresAt?: string;
    emailSentAt?: string | null;
    emailDeliveryError?: string | null;
    pendingSetup: boolean;
  } | null;
  billingPayments: Array<{
    id: string;
    status: string;
    amountCents: number;
    currency: string;
    paidAt?: string | null;
    failureReason?: string | null;
    verifiedCallback: boolean;
    paymentEnvironment: string;
    createdAt: string;
  }>;
  platformAudit: Array<{
    id: string;
    action: string;
    reason?: string | null;
    details?: string | null;
    createdAt: string;
    platformUser: { email: string };
  }>;
}

function paymentVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'SUCCEEDED') return 'default';
  if (status === 'PENDING') return 'secondary';
  if (status === 'FAILED') return 'destructive';
  return 'outline';
}

export function PlatformOrgDetailDialog(props: {
  orgId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  onMutated: () => void;
}) {
  const queryClient = useQueryClient();
  const [planCode, setPlanCode] = useState('REGULAR');
  const [pilotNotes, setPilotNotes] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [confirmAction, setConfirmAction] = useState<'suspend' | 'pilot' | 'plan' | null>(null);

  const { data, isLoading, error, refetch } = useQuery<OrgDetail>({
    queryKey: ['platform-org-detail', props.orgId],
    queryFn: () => platformApi.get(`/organizations/${props.orgId}`),
    enabled: props.open && !!props.orgId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['platform-org-detail', props.orgId] });
    props.onMutated();
  };

  const resendInvite = useMutation({
    mutationFn: () => platformApi.post(`/organizations/${props.orgId}/owner-invitation/resend`),
    onSuccess: () => invalidate(),
  });

  const suspend = useMutation({
    mutationFn: () => platformApi.post(`/organizations/${props.orgId}/suspend`, { reason: actionReason }),
    onSuccess: () => { setConfirmAction(null); setActionReason(''); invalidate(); },
  });

  const reactivate = useMutation({
    mutationFn: () => platformApi.post(`/organizations/${props.orgId}/reactivate`, { reason: actionReason || undefined }),
    onSuccess: () => { setActionReason(''); invalidate(); },
  });

  const changePlan = useMutation({
    mutationFn: () =>
      platformApi.post(`/organizations/${props.orgId}/plan`, {
        planCode,
        billingInterval: 'MONTHLY',
        reason: actionReason || undefined,
      }),
    onSuccess: () => { setConfirmAction(null); setActionReason(''); invalidate(); },
  });

  const pilotGrant = useMutation({
    mutationFn: (extend: boolean) =>
      platformApi.post(`/organizations/${props.orgId}/pilot/grant`, {
        planCode: 'PRO',
        notes: pilotNotes,
        extend,
        reason: actionReason || undefined,
      }),
    onSuccess: () => { setConfirmAction(null); setActionReason(''); invalidate(); },
  });

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.name ?? 'Organization'}</DialogTitle>
        </DialogHeader>

        {isLoading && <Skeleton className="h-40 w-full" />}
        {error && <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load'}</p>}

        {data && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge variant={data.status === 'ACTIVE' ? 'default' : 'destructive'}>{data.status}</Badge>
              {data.subscription && <Badge variant="secondary">{data.subscription.status}</Badge>}
              {data.pilot && <Badge variant="outline">Pilot · {data.pilot.planCode}</Badge>}
            </div>

            {data.owner && (
              <div className="rounded-md border p-3 space-y-1">
                <p className="font-medium">Owner</p>
                <p>{data.owner.firstName} {data.owner.lastName} · {data.owner.email}</p>
                <p className="text-muted-foreground text-xs">
                  {data.owner.mustSetPassword ? 'Password setup pending' : 'Account active'}
                  {data.owner.lastLoginAt ? ` · Last login ${formatDate(data.owner.lastLoginAt)}` : ''}
                </p>
                {data.ownerInvitation?.pendingSetup && (
                  <div className="mt-2 space-y-1 text-xs">
                    {data.ownerInvitation.emailSentAt && (
                      <p className="text-muted-foreground">Invite emailed {formatDate(data.ownerInvitation.emailSentAt)}</p>
                    )}
                    {data.ownerInvitation.emailDeliveryError && (
                      <p className="text-destructive">{data.ownerInvitation.emailDeliveryError}</p>
                    )}
                    {props.canManage && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resendInvite.isPending}
                        onClick={() => resendInvite.mutate()}
                      >
                        Resend owner invitation
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}

            {data.subscription && (
              <div className="rounded-md border p-3 space-y-1">
                <p className="font-medium">Subscription</p>
                <p>{data.subscription.planName} ({data.subscription.planCode}) · {data.subscription.billingInterval}</p>
                {data.subscription.trialEndsAt && (
                  <p className="text-muted-foreground">Trial ends {formatDate(data.subscription.trialEndsAt)}</p>
                )}
                <p className="text-muted-foreground text-xs">Period end {formatDate(data.subscription.currentPeriodEnd)}</p>
              </div>
            )}

            <div className="rounded-md border p-3">
              <p className="font-medium mb-1">Onboarding</p>
              <p className="text-muted-foreground">{data.onboarding.label}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Last activity {data.lastActivityAt ? formatDate(data.lastActivityAt) : '—'}
              </p>
            </div>

            <div>
              <p className="font-medium mb-2">Billing payments</p>
              {data.billingPayments.length === 0 && <p className="text-muted-foreground">No payments recorded.</p>}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {data.billingPayments.map((p) => (
                  <div key={p.id} className="flex justify-between gap-2 border p-2 rounded-sm">
                    <div>
                      <Badge variant={paymentVariant(p.status)}>{p.status}</Badge>
                      <p className="text-xs text-muted-foreground mt-1">
                        {p.paymentEnvironment} · {p.verifiedCallback ? 'Callback verified' : 'Not verified (STK alone is not proof)'}
                      </p>
                      {p.failureReason && <p className="text-xs text-destructive">{p.failureReason}</p>}
                    </div>
                    <div className="text-right text-xs">
                      <p>{formatCurrency(p.amountCents, p.currency)}</p>
                      <p className="text-muted-foreground">{p.paidAt ? formatDate(p.paidAt) : formatDate(p.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="font-medium mb-2">Platform audit</p>
              {data.platformAudit.length === 0 && <p className="text-muted-foreground">No platform actions logged.</p>}
              <div className="space-y-1 max-h-36 overflow-y-auto text-xs">
                {data.platformAudit.map((log) => (
                  <div key={log.id} className="border-b pb-1">
                    <span className="font-medium">{log.action}</span> · {log.platformUser.email} · {formatDate(log.createdAt)}
                    {log.reason && <span className="text-muted-foreground"> — {log.reason}</span>}
                  </div>
                ))}
              </div>
            </div>

            {props.canManage && (
              <div className="border-t pt-4 space-y-3">
                <p className="font-medium">Privileged actions</p>
                <div className="flex flex-wrap gap-2">
                  {data.status === 'SUSPENDED' ? (
                    <Button size="sm" variant="outline" onClick={() => reactivate.mutate()} disabled={reactivate.isPending}>
                      Reactivate
                    </Button>
                  ) : (
                    <Button size="sm" variant="destructive" onClick={() => setConfirmAction('suspend')}>
                      Suspend
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => setConfirmAction('plan')}>Change plan</Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmAction('pilot')}>
                    {data.pilot ? 'Extend pilot' : 'Grant pilot'}
                  </Button>
                </div>

                {confirmAction === 'suspend' && (
                  <div className="space-y-2 rounded-md border p-3">
                    <Label>Suspension reason (required)</Label>
                    <Input value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
                    <DialogFooter className="gap-2 sm:justify-start px-0">
                      <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
                      <Button
                        variant="destructive"
                        disabled={actionReason.trim().length < 3 || suspend.isPending}
                        onClick={() => suspend.mutate()}
                      >
                        Confirm suspend
                      </Button>
                    </DialogFooter>
                  </div>
                )}

                {confirmAction === 'plan' && (
                  <div className="space-y-2 rounded-md border p-3">
                    <Label>Plan code</Label>
                    <Input value={planCode} onChange={(e) => setPlanCode(e.target.value)} />
                    <Label>Note (optional)</Label>
                    <Input value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
                    <Button size="sm" onClick={() => changePlan.mutate()} disabled={changePlan.isPending}>Apply plan</Button>
                  </div>
                )}

                {confirmAction === 'pilot' && (
                  <div className="space-y-2 rounded-md border p-3">
                    <Label>Notes / reason</Label>
                    <Input value={pilotNotes} onChange={(e) => setPilotNotes(e.target.value)} />
                    <Input placeholder="Audit reason (optional)" value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
                    <Button size="sm" onClick={() => pilotGrant.mutate(!!data.pilot)} disabled={pilotGrant.isPending}>
                      {data.pilot ? 'Extend pilot' : 'Grant pilot'}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          <Button variant="outline" onClick={() => props.onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
