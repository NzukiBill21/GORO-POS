import { formatCurrency } from '@/lib/utils';
import { formatPaymentMethod } from '@/lib/paymentMethods';
import { printReceiptHtml } from '@/lib/printReceipt';

export interface ZReportPrintData {
  shift: { openedAt: string; closedAt?: string | null; openingFloatCents: number };
  salesCount: number;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  expectedCashCents: number;
  countedCashCents?: number;
  varianceCents?: number;
  byPayment: Record<string, number>;
  storeName?: string;
}

export function buildZReportHtml(data: ZReportPrintData): string {
  const opened = new Date(data.shift.openedAt).toLocaleString();
  const closed = data.shift.closedAt ? new Date(data.shift.closedAt).toLocaleString() : '—';
  const payments = Object.entries(data.byPayment)
    .map(([m, amt]) => `<tr><td>${formatPaymentMethod(m)}</td><td style="text-align:right">${formatCurrency(amt)}</td></tr>`)
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Z-Report</title>
<style>body{font-family:system-ui,sans-serif;padding:16px;max-width:360px;margin:0 auto}
h1{font-size:18px;margin:0 0 8px}table{width:100%;border-collapse:collapse;font-size:13px}
td{padding:4px 0;border-bottom:1px solid #eee}.muted{color:#666;font-size:12px}</style></head><body>
<h1>${data.storeName ?? 'Z-Report'}</h1>
<p class="muted">Opened: ${opened}<br/>Closed: ${closed}</p>
<table>
<tr><td>Opening float</td><td style="text-align:right">${formatCurrency(data.shift.openingFloatCents)}</td></tr>
<tr><td>Sales count</td><td style="text-align:right">${data.salesCount}</td></tr>
<tr><td>Revenue</td><td style="text-align:right">${formatCurrency(data.revenueCents)}</td></tr>
<tr><td>COGS</td><td style="text-align:right">${formatCurrency(data.cogsCents)}</td></tr>
<tr><td>Gross profit</td><td style="text-align:right">${formatCurrency(data.grossProfitCents)}</td></tr>
<tr><td><strong>Expected cash</strong></td><td style="text-align:right"><strong>${formatCurrency(data.expectedCashCents)}</strong></td></tr>
${data.countedCashCents != null ? `<tr><td>Counted cash</td><td style="text-align:right">${formatCurrency(data.countedCashCents)}</td></tr>` : ''}
${data.varianceCents != null ? `<tr><td>Variance</td><td style="text-align:right">${formatCurrency(data.varianceCents)}</td></tr>` : ''}
</table>
<h2 style="font-size:14px;margin-top:16px">Payments</h2>
<table>${payments || '<tr><td colspan="2">No payments</td></tr>'}</table>
</body></html>`;
}

export async function printZReport(data: ZReportPrintData): Promise<void> {
  await printReceiptHtml(buildZReportHtml(data));
}
