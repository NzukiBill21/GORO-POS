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

export type SheetDataRow = {
  excelRowNumber: number;
  cells: Record<string, string>;
};

type SheetExtractResult = {
  headerDetected: boolean;
  rows: SheetDataRow[];
};

function isProductHeaderRow(cells: (string | number)[]): boolean {
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
}

function isOpeningHeaderRow(cells: (string | number)[]): boolean {
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
}

/** Detect header row; excelRowNumber is 1-based (matches Excel row index). */
function rowsFromSheetWithHeaderDetection(sheet: XLSX.WorkSheet): SheetExtractResult {
  const aoa = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' });

  for (let hi = 0; hi < Math.min(20, aoa.length); hi++) {
    const headerCells = aoa[hi] ?? [];
    if (!isProductHeaderRow(headerCells) && !isOpeningHeaderRow(headerCells)) continue;

    const headers = headerCells.map((c) => normalizeHeader(String(c)));
    const rows: SheetDataRow[] = [];
    for (let ri = hi + 1; ri < aoa.length; ri++) {
      const line = aoa[ri] ?? [];
      const cells: Record<string, string> = {};
      let any = false;
      for (let ci = 0; ci < headers.length; ci++) {
        const key = headers[ci];
        if (!key) continue;
        const val = line[ci] == null ? '' : String(line[ci]).trim();
        if (val) any = true;
        cells[key] = val;
      }
      if (any) rows.push({ excelRowNumber: ri + 1, cells });
    }
    if (rows.length > 0) return { headerDetected: true, rows };
    return { headerDetected: true, rows: [] };
  }

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const rows: SheetDataRow[] = raw.map((row, i) => {
    const cells: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      cells[normalizeHeader(String(k))] = v == null ? '' : String(v).trim();
    }
    return { excelRowNumber: i + 2, cells };
  });
  return { headerDetected: false, rows };
}

export type SheetReadResult = {
  sheetName: string;
  rows: SheetDataRow[];
  sheetNames: string[];
  headerDetected: boolean;
};

export function readWorkbookSheet(
  buffer: Buffer,
  preferredNames: string[],
  scoreRows: (rows: SheetDataRow[]) => number
): SheetReadResult {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = wb.SheetNames;

  let best: { sheetName: string; rows: SheetDataRow[]; score: number; headerDetected: boolean } | null =
    null;

  for (const sheetName of sheetNames) {
    if (isSkippedSheetName(sheetName)) continue;
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const extracted = rowsFromSheetWithHeaderDetection(sheet);
    const score = extracted.headerDetected ? scoreRows(extracted.rows) : 0;
    const nameBoost =
      extracted.headerDetected && sheetNameMatchesPreferred(sheetName, preferredNames) ? 1000 : 0;
    const total = nameBoost + score;
    if (!best || total > best.score) {
      best = {
        sheetName,
        rows: extracted.rows,
        score: total,
        headerDetected: extracted.headerDetected,
      };
    }
  }

  if (best && best.score > 0) {
    return {
      sheetName: best.sheetName,
      rows: best.rows,
      sheetNames,
      headerDetected: best.headerDetected,
    };
  }

  const fallbackName =
    preferredNames
      .map((p) => sheetNames.find((s) => sheetNameMatchesPreferred(s, [p])))
      .find(Boolean) ??
    sheetNames.find((s) => !isSkippedSheetName(s)) ??
    sheetNames[0];

  if (!fallbackName) {
    return { sheetName: '', rows: [], sheetNames, headerDetected: false };
  }

  const sheet = wb.Sheets[fallbackName];
  const extracted = sheet ? rowsFromSheetWithHeaderDetection(sheet) : { headerDetected: false, rows: [] };
  return {
    sheetName: fallbackName,
    rows: extracted.rows,
    sheetNames,
    headerDetected: extracted.headerDetected,
  };
}

/** @deprecated use readWorkbookSheet; returns cell maps only */
export function sheetRows(buffer: Buffer, preferredNames: string[]): Record<string, string>[] {
  return readWorkbookSheet(buffer, preferredNames, (rows) => parseProductSheetRows(rows).length).rows.map(
    (r) => r.cells
  );
}

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[normalizeHeader(k)];
    if (v) return v;
  }
  return '';
}

function rawCell(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[normalizeHeader(k)];
    if (v !== undefined && v !== '') return v;
  }
  return '';
}

function parseNumericCell(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const n = parseFloat(raw.replace(/,/g, ''));
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
  /** Set only when the Track stock column has a value (updates omit when undefined). */
  trackStock?: boolean;
  productSku?: string;
  variantName?: string;
  size?: string;
  color?: string;
  variantSku?: string;
  barcode?: string;
  /** Raw Excel values for validation */
  sellingPriceRaw: string;
  costPriceRaw: string;
  minStockRaw: string;
};

export type ParsedOpeningStockRow = {
  rowNumber: number;
  productSku?: string;
  variantSku?: string;
  productName?: string;
  size?: string;
  color?: string;
  quantity: number;
  quantityRaw: string;
  branchName?: string;
};

export function parseProductSheetRows(sheetRows: SheetDataRow[]): ParsedProductRow[] {
  const out: ParsedProductRow[] = [];
  for (const { excelRowNumber, cells: row } of sheetRows) {
    const productName = pick(
      row,
      'product name',
      'name',
      'item',
      'product',
      'product title',
      'item name'
    );
    const sellingPriceRaw = rawCell(row, 'selling price', 'price', 'retail price', 'sell price');
    const costPriceRaw = rawCell(row, 'cost price', 'cost', 'buy price');
    const minStockRaw = rawCell(row, 'min stock', 'reorder level', 'minimum stock');

    const size = pick(row, 'size', 'variant size');
    const color = pick(row, 'color', 'colour', 'variant color');
    const variantName =
      pick(row, 'variant name', 'variant') ||
      [size, color].filter(Boolean).join(' / ') ||
      undefined;

    const sellingParsed = parseNumericCell(sellingPriceRaw);
    const costParsed = parseNumericCell(costPriceRaw);
    const minParsed = parseNumericCell(minStockRaw);

    out.push({
      rowNumber: excelRowNumber,
      productName,
      category: pick(row, 'category') || undefined,
      brand: pick(row, 'brand') || undefined,
      unit: pick(row, 'unit', 'uom') || undefined,
      costPrice: costParsed ?? 0,
      sellingPrice: sellingParsed ?? 0,
      minStock: minParsed != null ? Math.round(minParsed) : 0,
      trackStock: bool(row, 'track stock', 'track inventory'),
      productSku: pick(row, 'product sku', 'parent sku', 'style sku') || pick(row, 'sku') || undefined,
      variantName,
      size: size || undefined,
      color: color || undefined,
      variantSku: pick(row, 'variant sku', 'sku code', 'item sku') || undefined,
      barcode:
        pick(row, 'barcode', 'manufacturer barcode', 'ean', 'upc', 'internal barcode') || undefined,
      sellingPriceRaw,
      costPriceRaw,
      minStockRaw,
    });
  }
  return out;
}

export function parseOpeningStockSheetRows(sheetRows: SheetDataRow[]): ParsedOpeningStockRow[] {
  const out: ParsedOpeningStockRow[] = [];
  for (const { excelRowNumber, cells: row } of sheetRows) {
    const quantityRaw = rawCell(row, 'quantity', 'qty', 'opening qty', 'opening quantity', 'stock');
    const qtyParsed = parseNumericCell(quantityRaw);
    out.push({
      rowNumber: excelRowNumber,
      productSku: pick(row, 'product sku', 'parent sku', 'style sku') || undefined,
      variantSku: pick(row, 'variant sku', 'sku', 'item sku') || undefined,
      productName: pick(row, 'product name', 'name') || undefined,
      size: pick(row, 'size') || undefined,
      color: pick(row, 'color', 'colour') || undefined,
      quantity: qtyParsed != null ? Math.round(qtyParsed) : 0,
      quantityRaw,
      branchName: pick(row, 'branch', 'store', 'location') || undefined,
    });
  }
  return out;
}
