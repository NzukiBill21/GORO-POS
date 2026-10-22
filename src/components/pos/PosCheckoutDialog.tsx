import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { printReceiptHtml } from '@/lib/printReceipt';
import { playPaymentSuccessSound } from '@/lib/paymentSuccessSound';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pulse } from '@/components/shared/Pulse';
import { ListSkeleton } from '@/components/shared/ListSkeleton';
import { PosReceiptStepBar } from '@/components/pos/PosReceiptStepBar';
import { cn } from '@/lib/utils';
import { parseTenderInput, currencyAllowsDecimals } from '@/lib/posMoney';
import { getSystemCurrency } from '@/stores/businessStore';

type Method = 'CASH' | 'MPESA_STK' | 'SPLIT';
type PayPhase =
  | 'idle'
  | 'preparing'
  | 'sending'
  | 'waiting_customer'
  | 'confirming'
  | 'receipt_summary'
  | 'receipt_print'
  | 'printing'
  | 'failed'
  | 'timed_out';

interface SaleSummary {
  invoiceNumber: string;
  total: number;
  changeAmount: number;
  amountPaid: number;
  customer: { firstName: string; lastName: string } | null;
}

const STK_WAIT_SECONDS = 90;

interface CartItem {
  productId: string;
  variantId?: string;
  quantity: number;
  discount?: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  discountAmount: number;
  heldSaleId?: string | null;
  onSuccess: () => void;
}

async function printSaleReceipt(saleId: string) {
  const { html } = await api.get<{ html: string }>(`/pos/sales/${saleId}/receipt`);
  await printReceiptHtml(html);
}

export function PosCheckoutDialog({ open, onClose, items, discountAmount, heldSaleId, onSuccess }: Props) {
  const [method, setMethod] = useState<Method>('CASH');
  const [quote, setQuote] = useState<{ totalCents: number; currency: string } | null>(null);
  const [saleId, setSaleId] = useState<string | null>(null);
  const [phase, setPhase] = useState<PayPhase>('idle');
  const [phone, setPhone] = useState('0712345678');
  const [tendered, setTendered] = useState('');
  const [splitCash, setSplitCash] = useState('');
  const [splitMpesa, setSplitMpesa] = useState('');
  const [countdown, setCountdown] = useState(STK_WAIT_SECONDS);
  const [errorMessage, setErrorMessage] = useState('');
  const [saleSummary, setSaleSummary] = useState<SaleSummary | null>(null);
  const checkoutStarted = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  const busy = phase === 'preparing' || phase === 'sending' || phase === 'confirming' || phase === 'printing';
  const inReceiptFlow = phase === 'receipt_summary' || phase === 'receipt_print';

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      setPhase('preparing');
      const q = await api.post<{ totalCents: number; currency: string }>('/pos/checkout/quote', {
        items,
        discountAmount,
      });
      setQuote(q);
      const created = await api.post<{ saleId: string; totalCents: number }>('/pos/checkout', {
        items,
        discountAmount,
        idempotencyKey: crypto.randomUUID(),
        heldSaleId: heldSaleId ?? undefined,
      });
      setSaleId(created.saleId);
      setPhase('idle');
      return created;
    },
    onError: (err) => {
      setPhase('failed');
      setErrorMessage(err instanceof Error ? err.message : 'Checkout failed');
    },
  });

  useEffect(() => {
    if (open && !saleId && !checkoutMutation.isPending && !checkoutStarted.current) {
      checkoutStarted.current = true;
      checkoutMutation.mutate();
    }
    if (!open) {
      setSaleId(null);
      setQuote(null);
      setPhase('idle');
      setErrorMessage('');
      setCountdown(STK_WAIT_SECONDS);
      setSaleSummary(null);
      checkoutStarted.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    }
  }, [open]);

  const finishSuccess = useCallback(async (completedSaleId: string) => {
    playPaymentSuccessSound();
    try {
      const summary = await api.get<SaleSummary>(`/pos/sales/${completedSaleId}/summary`);
      setSaleSummary(summary);
      setPhase('receipt_summary');
    } catch {
      setPhase('receipt_summary');
    }
  }, []);

  const advanceReceiptStep = useCallback(() => {
    if (phase === 'receipt_summary') setPhase('receipt_print');
  }, [phase]);

  const handlePrintReceipt = useCallback(async () => {
    if (!saleId) return;
    setPhase('printing');
    try {
      await printSaleReceipt(saleId);
    } catch {
      /* user can reprint from sales */
    }
    onSuccess();
    onClose();
  }, [onClose, onSuccess, saleId]);

  useEffect(() => {
    if (!inReceiptFlow) return;
    primaryActionRef.current?.focus();
  }, [phase, inReceiptFlow]);

  useEffect(() => {
    if (!open || !inReceiptFlow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (phase === 'receipt_print') void handlePrintReceipt();
      else advanceReceiptStep();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, phase, inReceiptFlow, advanceReceiptStep, handlePrintReceipt]);

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startStkPolling = useCallback(
    (targetSaleId: string) => {
      stopPolling();
      setPhase('waiting_customer');
      setCountdown(STK_WAIT_SECONDS);
      pollRef.current = setInterval(async () => {
        try {
          setPhase((p) => (p === 'waiting_customer' ? 'confirming' : p));
          const st = await api.get<{
            records: Array<{ status: string }>;
            remainingCents: number;
            saleStatus: string | null;
          }>(`/pos/sales/${targetSaleId}/status`);
          const latest = st.records[0]?.status;
          const paidAndClosed =
            st.saleStatus === 'COMPLETED' && st.remainingCents === 0;
          if (paidAndClosed || (latest === 'PAID' && st.remainingCents === 0 && st.saleStatus === 'COMPLETED')) {
            stopPolling();
            await finishSuccess(targetSaleId);
            return;
          }
          if (latest === 'FAILED' || latest === 'CANCELLED') {
            stopPolling();
            setPhase('failed');
            setErrorMessage('Payment was declined or cancelled.');
            return;
          }
          if (latest === 'TIMEOUT') {
            stopPolling();
            setPhase('timed_out');
            return;
          }
          setPhase('waiting_customer');
        } catch {
          setPhase('waiting_customer');
        }
      }, 2000);
    },
    [finishSuccess]
  );

  useEffect(() => {
    if (phase !== 'waiting_customer') return;
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          stopPolling();
          setPhase('timed_out');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [phase]);

  const payMutation = useMutation({
    mutationFn: async (cashPayload?: { tenderedCents: number }) => {
      if (!saleId || !quote) throw new Error('Checkout not ready');
      setErrorMessage('');
      setPhase('sending');
      if (method === 'CASH') {
        const tenderedCents = cashPayload?.tenderedCents ?? amountDue;
        return api.post(`/pos/sales/${saleId}/pay/cash`, {
          amountCents: quote.totalCents,
          tenderedCents,
        });
      }
      if (method === 'SPLIT') {
        const cashCents = Math.round(parseFloat(splitCash) || 0);
        const mpesaCents = Math.round(parseFloat(splitMpesa) || 0);
        return api.post(`/pos/sales/${saleId}/pay/split`, {
          lines: [
            { method: 'CASH', amountCents: cashCents, tenderedCents: cashCents },
            { method: 'MPESA_STK', amountCents: mpesaCents, phone },
          ],
        });
      }
      return api.post(`/pos/sales/${saleId}/pay/mpesa-stk`, { phone });
    },
    onSuccess: async (_data, _vars) => {
      if (!saleId) return;
      if (method === 'MPESA_STK') {
        startStkPolling(saleId);
        return;
      }
      if (method === 'SPLIT' && parseFloat(splitMpesa) > 0) {
        startStkPolling(saleId);
        return;
      }
      await finishSuccess(saleId);
    },
    onError: (err) => {
      setPhase('failed');
      setErrorMessage(err instanceof Error ? err.message : 'Payment failed');
    },
  });

  const handleCancel = () => {
    stopPolling();
    if (phase === 'printing') return;
    onClose();
  };

  const resetToCash = () => {
    stopPolling();
    setPhase('idle');
    setErrorMessage('');
    setMethod('CASH');
  };

  const totalDisplay = quote ? formatCurrency(quote.totalCents, quote.currency) : '…';
  const preparing = checkoutMutation.isPending || phase === 'preparing';
  const currencyCode = quote?.currency ?? getSystemCurrency() ?? 'KES';
  const allowDecimals = currencyAllowsDecimals(currencyCode);
  const amountDue = quote?.totalCents ?? 0;
  const tenderedAmount = parseTenderInput(tendered, allowDecimals);
  const changeDue =
    tenderedAmount != null && tenderedAmount >= amountDue ? tenderedAmount - amountDue : null;
  const cashTenderTooLow =
    method === 'CASH' && tendered.trim() !== '' && tenderedAmount != null && tenderedAmount < amountDue;

  const submitCashPayment = () => {
    if (!saleId || !quote) return;
    const received = parseTenderInput(tendered, allowDecimals);
    if (received == null) {
      setErrorMessage('Enter cash received');
      return;
    }
    if (received < amountDue) {
      setErrorMessage('Cash received is less than the amount due');
      return;
    }
    setErrorMessage('');
    payMutation.mutate({ tenderedCents: received });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleCancel()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" onPointerDownOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline justify-between gap-2 pr-6">
            <span>Checkout</span>
            <span className="text-primary tabular-nums text-xl">{totalDisplay}</span>
          </DialogTitle>
        </DialogHeader>

        {preparing && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Pulse className="text-primary scale-125" label="Preparing sale" />
            <p className="text-sm text-muted-foreground">Preparing sale…</p>
            <ListSkeleton rows={2} className="w-full" />
            <Button variant="outline" className="min-h-11" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        )}

        {phase === 'printing' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Pulse className="text-primary scale-125" label="Printing" />
            <p className="font-medium">Sending to printer…</p>
          </div>
        )}

        {inReceiptFlow && saleSummary && (
          <div className="space-y-4 py-2">
            <PosReceiptStepBar phase={phase} />

            {phase === 'receipt_summary' && (
              <>
                <div className="flex flex-col items-center gap-2 text-success py-2">
                  <CheckCircle2 className="h-12 w-12" />
                  <p className="text-lg font-semibold">Payment received</p>
                </div>
                <div className="rounded-lg border p-4 space-y-2 text-center">
                  <p className="text-sm text-muted-foreground">Receipt</p>
                  <p className="text-xl font-mono font-bold">{saleSummary.invoiceNumber}</p>
                  <p className="text-lg font-semibold tabular-nums">{formatCurrency(saleSummary.total)}</p>
                  {saleSummary.changeAmount > 0 && (
                    <div className="rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-2 mt-2">
                      <p className="text-xs text-muted-foreground">Give change</p>
                      <p className="text-2xl font-bold tabular-nums text-primary">
                        {formatCurrency(saleSummary.changeAmount)}
                      </p>
                    </div>
                  )}
                  {saleSummary.customer && (
                    <p className="text-sm text-muted-foreground">
                      {saleSummary.customer.firstName} {saleSummary.customer.lastName}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground pt-1">
                    A copy is saved under data/receipt-archive (date + receipt number).
                  </p>
                </div>
                <Button ref={primaryActionRef} className="w-full min-h-11 text-lg font-semibold" onClick={advanceReceiptStep}>
                  OK — print receipt
                </Button>
              </>
            )}

            {phase === 'receipt_print' && (
              <>
                <div className="rounded-lg bg-muted/50 p-4 text-center space-y-1">
                  <p className="text-sm">Ready to print</p>
                  <p className="font-mono font-bold">{saleSummary.invoiceNumber}</p>
                  <p className="text-xs text-muted-foreground">Press Enter or tap Print</p>
                </div>
                <Button ref={primaryActionRef} className="w-full min-h-11 text-lg font-bold" onClick={() => void handlePrintReceipt()}>
                  Print receipt
                </Button>
              </>
            )}
          </div>
        )}

        {!preparing && !inReceiptFlow && phase !== 'printing' && (
          <>
            {(phase === 'waiting_customer' || phase === 'confirming' || phase === 'sending') && (
              <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-center">
                <Pulse className="mx-auto text-primary scale-125" label="Waiting for customer" />
                <p className="font-medium">
                  {phase === 'sending' && 'Sending STK push…'}
                  {phase === 'confirming' && 'Confirming payment…'}
                  {phase === 'waiting_customer' && 'Waiting for customer on phone'}
                </p>
                {phase === 'waiting_customer' && (
                  <p className="text-2xl font-mono tabular-nums" aria-live="polite" aria-atomic="true">
                    {countdown}s
                  </p>
                )}
                <p className="text-xs text-muted-foreground">Customer should enter M-Pesa PIN on their phone.</p>
              </div>
            )}

            {(phase === 'failed' || phase === 'timed_out') && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {phase === 'timed_out' ? 'Payment timed out. Try again or use another method.' : errorMessage || 'Payment failed.'}
              </div>
            )}

            {phase === 'idle' || phase === 'failed' || phase === 'timed_out' ? (
              <>
                <div className="grid grid-cols-3 gap-2" role="tablist" aria-label="Payment method">
                  {(['CASH', 'MPESA_STK', 'SPLIT'] as Method[]).map((m) => (
                    <Button
                      key={m}
                      type="button"
                      role="tab"
                      aria-selected={method === m}
                      size="sm"
                      className={cn('min-h-11 px-2 text-xs sm:text-sm', method === m && 'ring-2 ring-primary ring-offset-2')}
                      variant={method === m ? 'default' : 'outline'}
                      disabled={payMutation.isPending}
                      onClick={() => setMethod(m)}
                    >
                      {m === 'MPESA_STK' ? 'M-Pesa' : m === 'SPLIT' ? 'Split' : 'Cash'}
                    </Button>
                  ))}
                </div>

                {method === 'CASH' && quote && (
                  <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Amount due</span>
                      <span className="font-semibold tabular-nums">{formatCurrency(amountDue, currencyCode)}</span>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cash-tendered">Cash given by customer</Label>
                      <p className="text-xs text-muted-foreground">
                        Enter what the customer handed you; change is calculated automatically.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {[quote.totalCents, 200, 500, 1000, 2000, 10000]
                          .filter((v, i, a) => a.indexOf(v) === i)
                          .map((amt) => (
                            <Button
                              key={amt}
                              type="button"
                              size="sm"
                              className="min-h-11"
                              variant="outline"
                              disabled={payMutation.isPending}
                              onClick={() => setTendered(String(amt))}
                            >
                              {amt === quote.totalCents ? 'Exact' : formatCurrency(amt, currencyCode)}
                            </Button>
                          ))}
                      </div>
                      <Input
                        id="cash-tendered"
                        className="min-h-11 text-lg tabular-nums"
                        inputMode={allowDecimals ? 'decimal' : 'numeric'}
                        value={tendered}
                        onChange={(e) => setTendered(e.target.value)}
                        placeholder={String(quote.totalCents)}
                        disabled={payMutation.isPending}
                        aria-invalid={cashTenderTooLow}
                      />
                      {cashTenderTooLow && (
                        <p className="text-sm text-destructive" role="alert">
                          Cash received is less than the amount due.
                        </p>
                      )}
                      {changeDue != null && changeDue > 0 && (
                        <div className="rounded-md border-2 border-primary/40 bg-primary/5 px-3 py-2">
                          <p className="text-xs text-muted-foreground">Change due</p>
                          <p className="text-2xl font-bold tabular-nums text-primary">
                            {formatCurrency(changeDue, currencyCode)}
                          </p>
                        </div>
                      )}
                      {tenderedAmount != null && changeDue === 0 && tendered.trim() !== '' && (
                        <p className="text-xs text-muted-foreground">Exact amount — no change.</p>
                      )}
                    </div>
                  </div>
                )}

                {(method === 'MPESA_STK' || method === 'SPLIT') && (
                  <div className="space-y-2">
                    <Label>Customer phone (M-Pesa)</Label>
                    <Input
                      className="min-h-11"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={payMutation.isPending}
                    />
                  </div>
                )}

                {method === 'SPLIT' && quote && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Cash portion</Label>
                      <Input className="min-h-11" value={splitCash} onChange={(e) => setSplitCash(e.target.value)} disabled={payMutation.isPending} />
                    </div>
                    <div>
                      <Label>M-Pesa portion</Label>
                      <Input className="min-h-11" value={splitMpesa} onChange={(e) => setSplitMpesa(e.target.value)} disabled={payMutation.isPending} />
                    </div>
                  </div>
                )}
              </>
            ) : null}

            <div className="flex gap-2 justify-end flex-wrap pt-2">
              {(phase === 'failed' || phase === 'timed_out') && (
                <>
                  <Button variant="outline" className="min-h-11" onClick={resetToCash}>
                    Pay another way
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={payMutation.isPending}
                    onClick={() => {
                      setPhase('idle');
                      setErrorMessage('');
                      payMutation.mutate(undefined);
                    }}
                  >
                    Retry STK
                  </Button>
                </>
              )}
              {(phase === 'waiting_customer' || phase === 'confirming' || phase === 'sending') && (
                <Button variant="outline" className="min-h-11" onClick={handleCancel}>
                  Cancel
                </Button>
              )}
              {(phase === 'idle' || phase === 'failed' || phase === 'timed_out') && (
                <>
                  <Button variant="outline" className="min-h-11" onClick={handleCancel}>
                    Cancel
                  </Button>
                  <Button
                    className="min-h-11 font-semibold"
                    disabled={!saleId || payMutation.isPending || checkoutMutation.isPending}
                    onClick={() => (method === 'CASH' ? submitCashPayment() : payMutation.mutate(undefined))}
                  >
                    {payMutation.isPending ? (
                      <span className="inline-flex items-center gap-2">
                        <Pulse /> Processing…
                      </span>
                    ) : method === 'MPESA_STK' ? (
                      'Send STK Push'
                    ) : method === 'CASH' ? (
                      'Confirm cash payment'
                    ) : (
                      'Complete payment'
                    )}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
