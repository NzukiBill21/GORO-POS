import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { toastSuccess } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface PublicConfig {
  enabledMethods: Record<string, boolean>;
  mpesaCallbackUrl: string | null;
  mpesaTillConfigured: boolean;
  mpesaStkConfigured: boolean;
  manualApprovalThresholdCents: number;
  defaultTillFloatCents: number;
}

const METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  mpesa_stk: 'M-Pesa Till (STK Push)',
  mpesa_manual: 'M-Pesa Manual Code',
  card: 'Card (terminal reference)',
  split: 'Split payments',
};

export function PosPaymentsSettings({ canEdit }: { canEdit: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<PublicConfig>({
    queryKey: ['pos-payment-settings'],
    queryFn: () => api.get('/pos/settings'),
  });

  const saveMutation = useMutation({
    mutationFn: (body: unknown) => api.put('/pos/settings', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pos-payment-settings'] });
      toastSuccess('Payment settings saved');
    },
  });

  if (isLoading || !data) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments (Kenya retail)</CardTitle>
        <CardDescription>
          Enable in-store methods. Daraja secrets are encrypted at rest and never returned to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          {Object.entries(METHOD_LABELS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={!!data.enabledMethods[key]}
                onChange={(e) =>
                  saveMutation.mutate({
                    enabledMethods: { ...data.enabledMethods, [key]: e.target.checked },
                  })
                }
              />
              {label}
            </label>
          ))}
        </div>

        {canEdit && (
          <div className="grid gap-4 md:grid-cols-2 border-t pt-4">
            <div className="space-y-2">
              <Label>M-Pesa shortcode</Label>
              <Input
                placeholder={data.mpesaStkConfigured ? '•••• configured' : '174379'}
                onBlur={(e) => e.target.value && saveMutation.mutate({ mpesaShortcode: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Till number</Label>
              <Input
                placeholder={data.mpesaTillConfigured ? '•••• configured' : 'Till / Paybill'}
                onBlur={(e) => e.target.value && saveMutation.mutate({ mpesaTill: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Consumer key</Label>
              <Input type="password" placeholder="Set once — not shown again" onBlur={(e) => e.target.value && saveMutation.mutate({ mpesaConsumerKey: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Consumer secret</Label>
              <Input type="password" placeholder="Set once" onBlur={(e) => e.target.value && saveMutation.mutate({ mpesaConsumerSecret: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Passkey</Label>
              <Input type="password" placeholder="Set once" onBlur={(e) => e.target.value && saveMutation.mutate({ mpesaPasskey: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>STK callback URL</Label>
              <Input
                defaultValue={data.mpesaCallbackUrl ?? ''}
                placeholder="https://your-domain.com/api/pos/webhooks/mpesa/stk"
                onBlur={(e) => saveMutation.mutate({ mpesaCallbackUrl: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Manual approval threshold (KES)</Label>
              <Input
                type="number"
                defaultValue={data.manualApprovalThresholdCents}
                onBlur={(e) => saveMutation.mutate({ manualApprovalThresholdCents: parseInt(e.target.value, 10) })}
              />
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          STK configured: {data.mpesaStkConfigured ? 'Yes' : 'No (uses MPESA_MOCK in dev)'} · Till: {data.mpesaTillConfigured ? 'Yes' : 'No'}
        </p>
        {saveMutation.isPending && <p className="text-sm text-muted-foreground">Saving…</p>}
      </CardContent>
    </Card>
  );
}
