import * as XLSX from 'xlsx';

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ').replace(/_/g, ' ');
}

const SKIP_SHEET_RE =
  /^(start here|instructions|readme|barcode notes|supplier receipts|notes|cover)$/i;

function isSkippedSheetName(name: string): boolean {
  const n = normalizeHeader(name);
  return SKIP_SHEET_RE.test(n) || n.startsWith('start here');
}

function sheetNameMatchesPreferred(sheetName: string, preferredNames: string[]): boolean {
  const s = normalizeHeader(sheetName);
  return preferredNames.some((p) => {
    const pn = normalizeHeader(p);
    return s === pn || s.includes(pn) || pn.includes(s);
  });
}

/** Detect header row and return normalized column → value rows (Excel row numbers = headerIndex+2 for first data row). */
function rowsFromSheetWithHeaderDetection(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });

  const isProductHeaderRow = (cells: (string | number)[]) => {
    const normalized = cells.map((c) => normalizeHeader(String(c)));
    const hasName = normalized.some(
      (h) =>
        h === 'product name' ||
        h === 'name' ||
        h === 'item' ||
        h === 'product' ||
        h === 'product title' ||
        h === 'item name' ||
        h.includes('product name')
    );
    const hasPriceOrSku = normalized.some(
      (h) =>
        h.includes('selling price') ||
        h === 'price' ||
        h.includes('retail') ||
        h.includes('variant sku') ||
        h.includes('product sku') ||
        h === 'sku'
    );
    return hasName && hasPriceOrSku;
  };

  const isOpeningHeaderRow = (cells: (string | number)[]) => {
    const normalized = cells.map((c) => normalizeHeader(String(c)));
    const hasQty = normalized.some(
      (h) => h === 'quantity' || h === 'qty' || h.includes('opening') || h === 'stock'
    );
    const hasId = normalized.some(
      (h) =>
        h.includes('sku') ||
        h === 'product name' ||
        h === 'name' ||
        h.includes('variant sku')
    );
    return hasQty && hasId;
  };

  for (let hi = 0; hi < Math.min(20, aoa.length); hi++) {
    const headerCells = aoa[hi] ?? [];
    if (!isProductHeaderRow(headerCells) && !isOpeningHeaderRow(headerCells)) continue;

    const headers = headerCells.map((c) => normalizeHeader(String(c)));
    const rows: Record<string, string>[] = [];
    for (let ri = hi + 1; ri < aoa.length; ri++) {
      const line = aoa[ri] ?? [];
      const out: Record<string, string> = {};
      let any = false;
      for (let ci = 0; ci < headers.length; ci++) {
        const key = headers[ci];
        if (!key) continue;
        const val = line[ci] == null ? '' : String(line[ci]).trim();
        if (val) any = true;
        out[key] = val;
      }
      if (any) rows.push(out);
    }
    if (rows.length > 0) return rows;
  }

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  return raw.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[normalizeHeader(String(k))] = v == null ? '' : String(v).trim();
    }
    return out;
  });
}

export type SheetReadResult = {
  sheetName: string;
  rows: Record<string, string>[];
  sheetNames: string[];
};

export function readWorkbookSheet(
  buffer: Buffer,
  preferredNames: string[],
  scoreRows: (rows: Record<string, string>[]) => number
): SheetReadResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = wb.SheetNames;

  let best: { sheetName: string; rows: Record<string, string>[]; score: number } | null = null;

  for (const sheetName of sheetNames) {
    if (isSkippedSheetName(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = rowsFromSheetWithHeaderDetection(sheet);
    const score = scoreRows(rows);
    const nameBoost = sheetNameMatchesPreferred(sheetName, preferredNames) ? 1000 : 0;
    const total = nameBoost + score;
    if (!best || total > best.score) {
      best = { sheetName, rows, score: total };
    }
  }

  if (best && best.score > 0) {
    return { sheetName: best.sheetName, rows: best.rows, sheetNames };
  }

  const fallbackName =
    preferredNames
      .map((p) => sheetNames.find((s) => sheetNameMatchesPreferred(s, [p])))
      .find(Boolean) ??
    sheetNames.find((s) => !isSkippedSheetName(s)) ??
    sheetNames[0];

  if (!fallbackName) {
    return { sheetName: '', rows: [], sheetNames };
  }

  const sheet = wb.Sheets[fallbackName];
  const rows = sheet ? rowsFromSheetWithHeaderDetection(sheet) : [];
  return { sheetName: fallbackName, rows, sheetNames };
}

export function sheetRows(buffer: Buffer, preferredNames: string[]): Record<string, string>[] {
  return readWorkbookSheet(buffer, preferredNames, (rows) => parseProductSheetRows(rows).length).rows;
}

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[normalizeHeader(k)];
    if (v) return v;
  }
  return '';
}

function num(row: Record<string, string>, ...keys: string[]): number | undefined {
  const v = pick(row, ...keys);
  if (!v) return undefined;
  const n = parseFloat(v.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function bool(row: Record<string, string>, ...keys: string[]): boolean | undefined {
  const v = pick(row, ...keys).toLowerCase();
  if (!v) return undefined;
  if (['y', 'yes', 'true', '1'].includes(v)) return true;
  if (['n', 'no', 'false', '0'].includes(v)) return false;
  return undefined;
}

export type ParsedProductRow = {
  rowNumber: number;
  productName: string;
  category?: string;
  brand?: string;
  unit?: string;
  costPrice: number;
  sellingPrice: number;
  minStock: number;
  trackStock: boolean;
  productSku?: string;
  variantName?: string;
  size?: string;
  color?: string;
  variantSku?: string;
  barcode?: string;
};

export type ParsedOpeningStockRow = {
  rowNumber: number;
  productSku?: string;
  variantSku?: string;
  productName?: string;
  size?: string;
  color?: string;
  quantity: number;
  branchName?: string;
};

export function parseProductSheetRows(rows: Record<string, string>[]): ParsedProductRow[] {
  const out: ParsedProductRow[] = [];
  rows.forEach((row, i) => {
    const productName = pick(
      row,
      'product name',
      'name',
      'item',
      'product',
      'product title',
      'item name'
    );
    if (!productName) return;
    const size = pick(row, 'size', 'variant size');
    const color = pick(row, 'color', 'colour', 'variant color');
    const variantName =
      pick(row, 'variant name', 'variant') ||
      [size, color].filter(Boolean).join(' / ') ||
      undefined;
    out.push({
      rowNumber: i + 2,
      productName,
      category: pick(row, 'category') || undefined,
      brand: pick(row, 'brand') || undefined,
      unit: pick(row, 'unit', 'uom') || undefined,
      costPrice: num(row, 'cost price', 'cost', 'buy price') ?? 0,
      sellingPrice: num(row, 'selling price', 'price', 'retail price', 'sell price') ?? 0,
      minStock: Math.max(0, Math.round(num(row, 'min stock', 'reorder level', 'minimum stock') ?? 0)),
      trackStock: bool(row, 'track stock', 'track inventory') ?? true,
      productSku: pick(row, 'product sku', 'parent sku', 'style sku') || pick(row, 'sku') || undefined,
      variantName,
      size: size || undefined,
      color: color || undefined,
      variantSku: pick(row, 'variant sku', 'sku code', 'item sku') || undefined,
      barcode:
        pick(row, 'barcode', 'manufacturer barcode', 'ean', 'upc', 'internal barcode') || undefined,
    });
  });
  return out;
}

export function parseOpeningStockSheetRows(rows: Record<string, string>[]): ParsedOpeningStockRow[] {
  const out: ParsedOpeningStockRow[] = [];
  rows.forEach((row, i) => {
    const qty = num(row, 'quantity', 'qty', 'opening qty', 'opening quantity', 'stock');
    if (qty == null || qty <= 0) return;
    out.push({
      rowNumber: i + 2,
      productSku: pick(row, 'product sku', 'parent sku', 'style sku') || undefined,
      variantSku: pick(row, 'variant sku', 'sku', 'item sku') || undefined,
      productName: pick(row, 'product name', 'name') || undefined,
      size: pick(row, 'size') || undefined,
      color: pick(row, 'color', 'colour') || undefined,
      quantity: Math.round(qty),
      branchName: pick(row, 'branch', 'store', 'location') || undefined,
    });
  });
  return out;
}
