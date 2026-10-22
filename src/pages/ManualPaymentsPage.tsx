import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { ClipboardList } from 'lucide-react';
import { useState } from 'react';

interface ManualPayment {
  id: string;
  manualTransactionCode: string | null;
  mpesaPhone: string | null;
  amountCents: number | null;
  amount: number;
  createdAt: string;
  sale?: { invoiceNumber: string | null; total: number };
}

export default function ManualPaymentsPage() {
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState('');

  const { data: pending = [], isLoading } = useQuery<ManualPayment[]>({
    queryKey: ['manual-payments-review'],
    queryFn: () => api.get('/pos/manual-payments/review'),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'verify' | 'reject' }) =>
      api.post(`/pos/manual-payments/${id}/review`, { action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['manual-payments-review'] }),
  });

  const reconcileMutation = useMutation({
    mutationFn: () => {
      const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const rows = lines.slice(1).map((line) => {
        const cols = line.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
        return { code: cols[0] ?? '', amount: cols[1] ?? '', date: cols[2] ?? '' };
      });
      return api.post('/pos/reconciliation/mpesa-csv', {
        filename: 'statement.csv',
        rows,
      });
    },
  });

  return (
    <div className="p-6 animate-fade-in space-y-6">
      <PageHeader
        title="Manual M-Pesa payments"
        description="Review unverified till codes and reconcile against your M-Pesa statement CSV."
        icon={ClipboardList}
      />

      <Card>
        <CardHeader>
          <CardTitle>Pending review</CardTitle>
          <CardDescription>Payments entered without STK — verify against your till statement.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && pending.length === 0 && (
            <p className="text-sm text-muted-foreground">No manual payments awaiting review.</p>
          )}
          <ul className="space-y-3">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3">
                <div className="text-sm">
                  <p className="font-medium">{p.manualTransactionCode}</p>
                  <p className="text-muted-foreground">
                    {formatCurrency(p.amountCents ?? p.amount)} · {p.mpesaPhone ?? '—'} · Sale{' '}
                    {p.sale?.invoiceNumber ?? '—'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ id: p.id, action: 'reject' })}
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate({ id: p.id, action: 'verify' })}
                  >
                    Mark verified
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Daily reconciliation</CardTitle>
          <CardDescription>Paste CSV export (code, amount, date columns). Matches by transaction code.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label>M-Pesa statement CSV</Label>
          <textarea
            className="w-full min-h-[120px] rounded-md border bg-background p-3 text-sm font-mono"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Receipt No,Amount,Date&#10;QGH7ABC12X,1500,2026-08-30"
          />
          <Button disabled={!csvText.trim() || reconcileMutation.isPending} onClick={() => reconcileMutation.mutate()}>
            Run match
          </Button>
          {reconcileMutation.isSuccess && reconcileMutation.data != null && (
            <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-48">
              {JSON.stringify(reconcileMutation.data as Record<string, unknown>, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
