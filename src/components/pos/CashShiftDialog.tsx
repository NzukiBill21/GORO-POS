import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, DoorClosed, DoorOpen, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { formatPaymentMethod } from '@/lib/paymentMethods';
import { printZReport } from '@/lib/zReportPrint';
import { Pulse } from '@/components/shared/Pulse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface CashShift {
  id: string;
  status: string;
  openingFloatCents: number;
  openedAt: string;
}

interface ZReport {
  salesCount: number;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  expectedCashCents: number;
  cashSalesCents: number;
  byPayment: Record<string, number>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CashShiftDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [floatKes, setFloatKes] = useState('0');
  const [countedKes, setCountedKes] = useState('');
  const [zReport, setZReport] = useState<ZReport | null>(null);

  const { data: shift, refetch } = useQuery<CashShift | null>({
    queryKey: ['cash-shift-current'],
    queryFn: () => api.get('/pos/cash-shifts/current'),
    enabled: open,
  });

  const openMutation = useMutation({
    mutationFn: () =>
      api.post('/pos/cash-shifts/open', {
        openingFloatCents: Math.round(parseFloat(floatKes || '0')) || 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-shift-current'] });
      refetch();
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      if (!shift) return;
      const countedCents = Math.round(parseFloat(countedKes || '0'));
      const z = await api.get<ZReport>(`/pos/cash-shifts/${shift.id}/z-report`);
      setZReport(z);
      return api.post(`/pos/cash-shifts/${shift.id}/close`, { countedCashCents: countedCents });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cash-shift-current'] });
      refetch();
    },
  });

  const previewZ = useMutation({
    mutationFn: () => {
      if (!shift) throw new Error('No shift');
      return api.get<ZReport>(`/pos/cash-shifts/${shift.id}/z-report`);
    },
    onSuccess: (data) => setZReport(data),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            Cash shift
          </DialogTitle>
        </DialogHeader>

        {!shift ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Open a shift before taking cash sales (recommended).</p>
            <div className="space-y-2">
              <Label htmlFor="float">Opening float (KES)</Label>
              <Input id="float" type="number" min={0} step="0.01" value={floatKes} onChange={(e) => setFloatKes(e.target.value)} />
            </div>
            <Button className="w-full min-h-11" onClick={() => openMutation.mutate()} disabled={openMutation.isPending}>
              {openMutation.isPending ? (
                <span className="inline-flex items-center gap-2"><Pulse /> Opening…</span>
              ) : (
                <>
                  <DoorOpen className="h-4 w-4 mr-2" />
                  Open shift
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Shift open since {new Date(shift.openedAt).toLocaleString()} · Float{' '}
              {formatCurrency(shift.openingFloatCents)}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => previewZ.mutate()} disabled={previewZ.isPending}>
                {previewZ.isPending ? <Pulse /> : 'Preview Z-report'}
              </Button>
              {zReport && shift && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void printZReport({
                      shift: { openedAt: shift.openedAt, openingFloatCents: shift.openingFloatCents },
                      ...zReport,
                    })
                  }
                >
                  <Printer className="h-4 w-4 mr-1" />
                  Print
                </Button>
              )}
            </div>
            {zReport && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <p>Sales: {zReport.salesCount}</p>
                <p>Revenue: {formatCurrency(zReport.revenueCents)}</p>
                <p>COGS: {formatCurrency(zReport.cogsCents)}</p>
                <p>Gross profit: {formatCurrency(zReport.grossProfitCents)}</p>
                <p>Expected cash in drawer: {formatCurrency(zReport.expectedCashCents)}</p>
                {Object.entries(zReport.byPayment).map(([m, c]) => (
                  <p key={m} className="text-muted-foreground">
                    {formatPaymentMethod(m)}: {formatCurrency(c)}
                  </p>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="counted">Counted cash in drawer (KES)</Label>
              <Input id="counted" type="number" min={0} step="0.01" value={countedKes} onChange={(e) => setCountedKes(e.target.value)} />
            </div>
            <Button
              variant="destructive"
              className="w-full min-h-11"
              onClick={() => closeMutation.mutate()}
              disabled={closeMutation.isPending || !countedKes}
            >
              {closeMutation.isPending ? (
                <span className="inline-flex items-center gap-2"><Pulse /> Closing &amp; backing up…</span>
              ) : (
                <>
                  <DoorClosed className="h-4 w-4 mr-2" />
                  Close shift
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
