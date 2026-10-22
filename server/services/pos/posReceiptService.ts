import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function loadLogoDataUri(customUrl?: string): string | null {
  const trimmed = customUrl?.trim();
  if (trimmed?.startsWith('data:')) return trimmed;
  if (trimmed?.startsWith('http://') || trimmed?.startsWith('https://')) {
    return trimmed;
  }

  const candidates = [
    trimmed?.replace(/^\//, ''),
    'branding/receipt-logo.png',
  ].filter(Boolean) as string[];

  for (const rel of candidates) {
    const logoPath = path.join(PROJECT_ROOT, 'public', rel);
    if (!fs.existsSync(logoPath)) continue;
    const b64 = fs.readFileSync(logoPath).toString('base64');
    const ext = path.extname(logoPath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${b64}`;
  }
  return null;
}

/** Mono black receipt layout (750px reference template) + embedded store logo. */
export async function buildSaleReceiptHtml(saleId: string, businessId: string): Promise<string> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, branch: { businessId } },
    include: {
      items: { include: { product: { select: { barcode: true } } } },
      payments: true,
      branch: true,
      user: { select: { firstName: true, lastName: true } },
      customer: {
        select: { firstName: true, lastName: true, phone: true, address: true, city: true },
      },
    },
  });
  if (!sale) throw new AppError('Sale not found', 404);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { settings: true },
  });
  const settingsMap = Object.fromEntries((business?.settings ?? []).map((s) => [s.key, s.value]));
  const termsLine =
    settingsMap.receipt_terms ?? 'Payment is due at point of sale. Please retain this receipt for returns.';
  const width =
    process.env.RECEIPT_WIDTH_MM?.trim() ||
    settingsMap.receipt_paper_width ||
    '80';
  const showLogo = settingsMap.receipt_show_logo !== 'false';
  const logoUri = showLogo ? loadLogoDataUri(settingsMap.receipt_logo_url) : null;

  const bankName = settingsMap.receipt_bank_name ?? '';
  const bankAccount = settingsMap.receipt_bank_account ?? '';
  const bankRouting = settingsMap.receipt_bank_routing ?? '';

  const fromLines = [
    business?.legalName ?? business?.name ?? 'Store',
    business?.address,
    [business?.city, business?.country].filter(Boolean).join(', '),
    business?.phone,
  ].filter((l) => l && String(l).trim());

  const billToLines = sale.customer
    ? [
        `${sale.customer.firstName} ${sale.customer.lastName}`.trim(),
        sale.customer.address,
        sale.customer.city,
        sale.customer.phone,
      ].filter(Boolean)
    : ['Walk-in customer'];

  const shipToLines = [
    sale.branch.name,
    sale.branch.address ?? business?.address,
    business?.city,
  ].filter((l) => l && String(l).trim());

  const rows = sale.items
    .map((i) => {
      const barcode = i.product?.barcode ? `<div class="muted">${escapeHtml(i.product.barcode)}</div>` : '';
      return `<tr>
        <td class="qty">${i.quantity}</td>
        <td class="desc">${escapeHtml(i.name)}${i.sku ? `<div class="muted">${escapeHtml(i.sku)}</div>` : ''}${barcode}</td>
        <td class="num">${formatMoneyPlain(i.unitPrice)}</td>
        <td class="num">${formatMoneyPlain(i.total)}</td>
      </tr>`;
    })
    .join('');

  const receiptDate = sale.createdAt.toLocaleDateString('en-GB');
  const taxRateLabel =
    sale.subtotal > 0 && sale.taxAmount > 0
      ? ((sale.taxAmount / sale.subtotal) * 100).toFixed(1)
      : '0.0';

  const logoHtml = logoUri
    ? `<div class="logo-circle"><img src="${logoUri}" alt="Store logo" class="logo" /></div>`
    : `<div class="logo-circle logo-placeholder">LOGO</div>`;

  const paidLines = sale.payments
    .filter((p) => p.status === 'COMPLETED')
    .map((p) => {
      const applied = formatMoneyPlain(p.amount);
      if (p.method === 'CASH' && p.tenderedCents != null && p.tenderedCents > (p.amountCents ?? Math.round(p.amount))) {
        const change = p.tenderedCents - (p.amountCents ?? Math.round(p.amount));
        return `${formatMethod(p.method)} ${applied} (tendered ${formatMoneyPlain(p.tenderedCents)}, change ${formatMoneyPlain(change)})`;
      }
      return `${formatMethod(p.method)} ${applied}`;
    });
  const paidSummary = paidLines.join(' · ');

  const bankBlock =
    bankName || bankAccount || bankRouting
      ? `<div class="bank">
          ${bankName ? `<div><span class="caps">Name of Bank</span> ${escapeHtml(bankName)}</div>` : ''}
          ${bankAccount ? `<div><span class="caps">Account number</span> ${escapeHtml(bankAccount)}</div>` : ''}
          ${bankRouting ? `<div><span class="caps">Routing</span> ${escapeHtml(bankRouting)}</div>` : ''}
        </div>`
      : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(sale.invoiceNumber)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Helvetica,Arial,sans-serif;font-size:10px;color:#111;max-width:${width}mm;margin:0 auto;padding:12px 14px 16px;line-height:1.4;background:#fff}
  .mono{font-family:"Courier New",Courier,monospace;letter-spacing:0.04em}
  .caps{font-size:8px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase}
  .top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px}
  .hatch{height:8px;width:80px;margin-bottom:6px;background:repeating-linear-gradient(-45deg,#999 0,#999 1px,transparent 1px,transparent 5px);opacity:0.45}
  .title{font-size:22px;font-weight:400;text-transform:lowercase}
  .top-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:140px}
  .logo-circle{width:72px;height:72px;border-radius:50%;border:1px solid #bbb;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#fff;flex-shrink:0}
  .logo{max-width:68px;max-height:68px;object-fit:contain;display:block}
  .logo-placeholder{font-size:8px;color:#888;font-weight:700}
  .meta-right{text-align:left;font-size:9px;width:100%}
  .meta-right div{display:flex;gap:6px;margin-bottom:2px}
  .meta-right .k{min-width:72px;color:#333;font-weight:600;text-transform:uppercase;font-size:8px}
  .block{margin-bottom:12px}
  .addr-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px}
  .addr{font-size:9px;line-height:1.45}
  .addr .caps{margin-bottom:4px;display:block}
  table.items{width:100%;border-collapse:collapse;margin:10px 0 8px;font-size:9px}
  table.items thead tr{border-top:1px solid #111;border-bottom:1px solid #111}
  table.items th{padding:6px 4px;text-align:left;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em}
  table.items th.num{text-align:right}
  table.items td{padding:7px 4px;border-bottom:1px solid #ddd;vertical-align:top}
  table.items td.qty{width:32px}
  table.items td.num{text-align:right;white-space:nowrap}
  .desc{font-size:9px}
  .muted{font-size:8px;color:#555;margin-top:2px}
  .sum-wrap{display:flex;justify-content:flex-end;margin-top:4px}
  .sum{width:100%;max-width:200px;font-size:9px}
  .sum .row{display:flex;justify-content:space-between;padding:3px 0}
  .total-box{border:2px solid #111;margin-top:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center}
  .total-box .mono{font-size:11px;font-weight:700;text-transform:uppercase}
  .total-box .amount{font-size:18px;font-weight:700}
  .paid{font-size:8px;color:#444;text-align:right;margin-top:6px}
  .terms{margin-top:16px;padding-top:10px;border-top:1px solid #ccc;font-size:8px;color:#333}
  .terms .mono{font-size:9px;font-weight:700;text-transform:uppercase;margin-bottom:6px}
  .bank{margin-top:8px;line-height:1.5}
  .foot-id{font-size:7px;color:#666;margin-top:10px;text-align:center}
  @page{margin:8mm}
  @media print{
    body{padding:0}
    .no-print{display:none!important}
  }
</style></head><body>

  <div class="top">
    <div>
      <div class="hatch"></div>
      <div class="mono title">receipt</div>
    </div>
    <div class="top-right">
      ${logoHtml}
      <div class="meta-right">
        <div><span class="k">Receipt #</span><span>${escapeHtml(sale.invoiceNumber)}</span></div>
        <div><span class="k">Receipt date</span><span>${escapeHtml(receiptDate)}</span></div>
        <div><span class="k">P.O.#</span><span>${escapeHtml(sale.invoiceNumber)}</span></div>
        <div><span class="k">Due date</span><span>${escapeHtml(receiptDate)}</span></div>
      </div>
    </div>
  </div>

  <p class="no-print" style="font-size:8px;color:#888;margin-bottom:8px">
    Tip: In the print dialog, turn off &quot;Headers and footers&quot; to hide browser date/title lines.
  </p>

  <div class="block addr">
    <span class="caps">From</span>
    ${fromLines.map((l) => `<div>${escapeHtml(String(l))}</div>`).join('')}
  </div>

  <div class="addr-grid">
    <div class="addr">
      <span class="caps">Bill to</span>
      ${billToLines.map((l) => `<div>${escapeHtml(String(l))}</div>`).join('')}
    </div>
    <div class="addr">
      <span class="caps">Ship to</span>
      ${shipToLines.map((l) => `<div>${escapeHtml(String(l))}</div>`).join('')}
    </div>
    <div class="addr">
      <span class="caps">Served by</span>
      <div>${escapeHtml(sale.user.firstName)} ${escapeHtml(sale.user.lastName)}</div>
      <div>${escapeHtml(sale.branch.name)}</div>
    </div>
  </div>

  <table class="items">
    <thead>
      <tr>
        <th>Qty</th>
        <th>Description</th>
        <th class="num">Unit price</th>
        <th class="num">Amount</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="sum-wrap">
    <div class="sum">
      <div class="row"><span>Subtotal</span><span>${formatMoneyPlain(sale.subtotal)}</span></div>
      ${sale.discountAmount > 0 ? `<div class="row"><span>Discount</span><span>-${formatMoneyPlain(sale.discountAmount)}</span></div>` : ''}
      <div class="row"><span>Sales tax ${taxRateLabel}%</span><span>${formatMoneyPlain(sale.taxAmount)}</span></div>
      <div class="total-box">
        <span class="mono">Total</span>
        <span class="amount">${formatMoneyPlain(sale.total)}</span>
      </div>
      ${sale.changeAmount > 0 ? `<div class="row" style="margin-top:6px"><span>Change</span><span>${formatMoneyPlain(sale.changeAmount)}</span></div>` : ''}
      ${paidSummary ? `<div class="paid">Paid: ${escapeHtml(paidSummary)}</div>` : ''}
    </div>
  </div>

  <div class="terms">
    <div class="mono">Terms &amp; conditions</div>
    <div>${escapeHtml(termsLine)}</div>
    ${bankBlock}
  </div>

  <div class="foot-id mono">${escapeHtml(sale.invoiceNumber)}</div>
</body></html>`;

  archiveReceiptHtml(businessId, sale.invoiceNumber, html);
  return html;
}

/** Sequential archive: data/receipt-archive/{businessId}/{YYYY-MM-DD}/{datetime}_{invoice}.html */
function archiveReceiptHtml(businessId: string, invoiceNumber: string, html: string) {
  try {
    const root =
      process.env.RECEIPT_ARCHIVE_DIR?.trim() || path.join(PROJECT_ROOT, 'data', 'receipt-archive');
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(root, businessId, day);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeInv = invoiceNumber.replace(/[^\w-]/g, '_');
    fs.writeFileSync(path.join(dir, `${stamp}_${safeInv}.html`), html, 'utf8');
  } catch (err) {
    console.warn('[receipt-archive]', err instanceof Error ? err.message : err);
  }
}

function formatMethod(method: string): string {
  const map: Record<string, string> = {
    CASH: 'Cash',
    MPESA_STK: 'M-Pesa',
    MPESA_MANUAL: 'M-Pesa',
    CARD: 'Card',
  };
  return map[method] ?? method;
}

/** Template-style amounts without currency prefix in column cells */
function formatMoneyPlain(n: number): string {
  return Math.round(n).toLocaleString('en-KE');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
