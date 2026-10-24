import { useCallback, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { api } from '@/lib/api';
import { downloadImportErrorCsv, shopImportFixHint } from '@/lib/shopImportErrorHints';
import { usePermissions } from '@/hooks/usePermissions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const TEMPLATE_URL = '/templates/GOROVIAN_Shop_Product_and_Stock_Template.xlsx';
const MAX_FILE_BYTES = 1_450_000;

type ImportKind = 'products' | 'opening-stock';
type ImportMode = 'create-only' | 'create-and-update';

type RowIssue = { rowNumber: number; message: string };

type ProductPreview = {
  valid: unknown[];
  errors: RowIssue[];
  warnings: RowIssue[];
  skipped: RowIssue[];
  importMode: ImportMode;
  stats: {
    totalRows: number;
    validCount: number;
    errorCount: number;
    warningCount: number;
    newCount: number;
    updateCount: number;
    skippedCount: number;
  };
  meta?: { sheetUsed?: string; sheetNames?: string[]; hint?: string };
};

type OpeningStockPreview = {
  valid: unknown[];
  errors: RowIssue[];
  warnings: RowIssue[];
  stats: {
    totalRows: number;
    validCount: number;
    errorCount: number;
    warningCount: number;
  };
  meta?: { sheetUsed?: string; sheetNames?: string[]; hint?: string };
};

type PreviewState = ProductPreview | OpeningStockPreview;

type ProductCommitResult = {
  idempotentReplay?: boolean;
  productsCreated?: number;
  productsUpdated?: number;
  variantsCreated?: number;
  variantsUpdated?: number;
  skippedCount?: number;
  partial?: boolean;
  importMode?: ImportMode;
};

type StockCommitResult = {
  idempotentReplay?: boolean;
  linesApplied?: number;
  linesSkipped?: number;
  unitsAdded?: number;
  partial?: boolean;
};

type ResultSummary = { title: string; lines: string[]; nextStep?: 'opening-stock' };

function isProductPreview(p: PreviewState | null, kind: ImportKind): p is ProductPreview {
  return kind === 'products' && p != null && 'importMode' in p;
}

function formatProductResult(data: ProductCommitResult): ResultSummary {
  if (data.idempotentReplay) {
    return {
      title: 'Already imported',
      lines: ['This confirmation was already applied. No duplicate changes were made.'],
    };
  }
  const lines: string[] = [];
  if (data.productsCreated) lines.push(`${data.productsCreated} new product(s) created.`);
  if (data.productsUpdated) lines.push(`${data.productsUpdated} existing product(s) updated.`);
  if (data.variantsCreated) lines.push(`${data.variantsCreated} new variant(s) added.`);
  if (data.variantsUpdated) lines.push(`${data.variantsUpdated} variant(s) updated.`);
  if (data.skippedCount) lines.push(`${data.skippedCount} row(s) skipped (already in catalogue).`);
  if (data.partial) lines.push('Rows with errors in the workbook were not included in this import.');
  if (!lines.length) lines.push('Import completed with no catalogue changes.');
  return {
    title: 'Products imported',
    lines,
    nextStep: 'opening-stock',
  };
}

function formatStockResult(data: StockCommitResult): ResultSummary {
  if (data.idempotentReplay) {
    return {
      title: 'Already imported',
      lines: ['This stock import was already applied. No duplicate changes were made.'],
    };
  }
  const lines: string[] = [];
  if (data.linesApplied != null) lines.push(`${data.linesApplied} stock line(s) applied.`);
  if (data.unitsAdded != null) lines.push(`${data.unitsAdded} unit(s) added to inventory.`);
  if (data.linesSkipped) lines.push(`${data.linesSkipped} line(s) skipped (duplicate import id).`);
  if (data.partial) lines.push('Invalid rows in the workbook were not included.');
  if (!lines.length) lines.push('Import completed.');
  return { title: 'Opening stock imported', lines };
}

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function ShopExcelImportDialog({ open, onClose, onComplete }: Props) {
  const { can } = usePermissions();
  const [kind, setKind] = useState<ImportKind>('products');
  const [importMode, setImportMode] = useState<ImportMode>('create-only');
  const [filename, setFilename] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResultSummary | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const resetPreview = useCallback(() => {
    setPreview(null);
    setResult(null);
    setBannerError(null);
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  const resetAll = useCallback(() => {
    resetPreview();
    setFileBase64('');
    setFilename('');
    setFileError(null);
  }, [resetPreview]);

  const onFile = (file: File) => {
    resetPreview();
    setFileError(null);
    if (file.size > MAX_FILE_BYTES) {
      setFileError(
        'This file is too large to upload (about 1.5 MB max). Remove unused sheets, images, or split into smaller workbooks.'
      );
      setFileBase64('');
      setFilename('');
      return;
    }
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      setFileBase64(btoa(binary));
    };
    reader.readAsArrayBuffer(file);
  };

  const switchKind = (next: ImportKind) => {
    setKind(next);
    resetAll();
  };

  const runPreview = async () => {
    if (!fileBase64) return;
    setLoading(true);
    setResult(null);
    setBannerError(null);
    try {
      if (kind === 'products') {
        const data = await api.post<ProductPreview>('/shop-import/preview/products', {
          fileBase64,
          filename,
          importMode,
        });
        setPreview(data);
      } else {
        const data = await api.post<OpeningStockPreview>('/shop-import/preview/opening-stock', {
          fileBase64,
          filename,
        });
        setPreview(data);
      }
      setIdempotencyKey(crypto.randomUUID());
    } catch (err) {
      setPreview(null);
      setBannerError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const runCommit = async (partial: boolean) => {
    if (!preview?.valid.length) return;
    setLoading(true);
    setBannerError(null);
    try {
      if (kind === 'products') {
        const data = await api.post<ProductCommitResult>('/shop-import/commit/products', {
          idempotencyKey,
          filename,
          rows: preview.valid,
          importMode,
          partial,
        });
        setResult(formatProductResult(data));
      } else {
        const data = await api.post<StockCommitResult>('/shop-import/commit/opening-stock', {
          idempotencyKey,
          filename,
          rows: preview.valid,
          partial,
        });
        setResult(formatStockResult(data));
      }
      onComplete();
    } catch (err) {
      setBannerError(err instanceof Error ? err.message : 'Import failed — fix row errors and preview again.');
    } finally {
      setLoading(false);
    }
  };

  const productStats = isProductPreview(preview, kind) ? preview.stats : null;
  const canStrictConfirm =
    preview != null && preview.errors.length === 0 && preview.valid.length > 0 && !loading;
  const canPartialConfirm =
    preview != null && preview.errors.length > 0 && preview.valid.length > 0 && !loading;

  const doubleStockWarning =
    kind === 'opening-stock' &&
    preview?.warnings.some((w) => w.message.toLowerCase().includes('add the quantities twice'));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import shop workbook</DialogTitle>
          <DialogDescription>
            Step 1: product catalogue. Step 2: opening stock. Use the official template so sheet names
            and columns match the importer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span
              className={cn(
                'rounded-md px-2 py-1 font-medium',
                kind === 'products' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              )}
            >
              Step 1 — Products
            </span>
            <span className="text-muted-foreground">→</span>
            <span
              className={cn(
                'rounded-md px-2 py-1 font-medium',
                kind === 'opening-stock' ? 'bg-primary text-primary-foreground' : 'bg-muted'
              )}
            >
              Step 2 — Opening stock
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" asChild>
              <a href={TEMPLATE_URL} download>
                <Download className="mr-2 h-4 w-4" />
                Download template
              </a>
            </Button>
            <Button
              type="button"
              variant={kind === 'products' ? 'default' : 'outline'}
              size="sm"
              onClick={() => switchKind('products')}
            >
              Products catalogue
            </Button>
            <Button
              type="button"
              variant={kind === 'opening-stock' ? 'default' : 'outline'}
              size="sm"
              onClick={() => switchKind('opening-stock')}
            >
              Opening stock
            </Button>
          </div>

          {kind === 'products' ? (
            <div className="space-y-2">
              <Label htmlFor="import-mode">When a row already exists in Gorovian</Label>
              <Select
                value={importMode}
                onValueChange={(v) => {
                  setImportMode(v as ImportMode);
                  resetPreview();
                }}
              >
                <SelectTrigger id="import-mode" className="max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="create-only">Create only — skip existing SKUs</SelectItem>
                  <SelectItem value="create-and-update" disabled={!can('products.edit')}>
                    Create and update — refresh existing items
                  </SelectItem>
                </SelectContent>
              </Select>
              {importMode === 'create-and-update' && !can('products.edit') ? (
                <p className="text-xs text-destructive">Updating existing products requires products.edit.</p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="shop-xlsx">Excel file (.xlsx)</Label>
            <input
              id="shop-xlsx"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            {filename ? <p className="text-xs text-muted-foreground">{filename}</p> : null}
            {fileError ? <p className="text-xs text-destructive">{fileError}</p> : null}
          </div>

          <Button type="button" disabled={!fileBase64 || loading || Boolean(fileError)} onClick={() => void runPreview()}>
            {loading ? 'Working…' : 'Preview import'}
          </Button>

          {bannerError ? (
            <p className="text-sm text-destructive rounded-md border border-destructive/30 bg-destructive/5 p-2">
              {bannerError}
            </p>
          ) : null}

          {result ? (
            <div className="rounded-md border border-green-600/30 bg-green-50 dark:bg-green-950/20 p-3 text-sm space-y-2">
              <p className="font-medium">{result.title}</p>
              <ul className="list-disc pl-5 space-y-1">
                {result.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {result.nextStep === 'opening-stock' ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setKind('opening-stock');
                    resetPreview();
                    setResult(null);
                  }}
                >
                  Next step: import opening stock
                </Button>
              ) : null}
            </div>
          ) : null}

          {preview ? (
            <div className="rounded-md border p-3 text-sm space-y-3">
              <div className="flex items-start gap-2">
                <FileSpreadsheet className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="space-y-1">
                  <p>
                    <strong>{preview.stats.validCount}</strong> ready of {preview.stats.totalRows} row(s)
                    {preview.stats.errorCount > 0 ? (
                      <span className="text-destructive"> · {preview.stats.errorCount} error(s)</span>
                    ) : null}
                    {preview.stats.warningCount > 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">
                        {' '}
                        · {preview.stats.warningCount} warning(s)
                      </span>
                    ) : null}
                  </p>
                  {preview.meta?.sheetUsed ? (
                    <p className="text-xs text-muted-foreground">Sheet used: {preview.meta.sheetUsed}</p>
                  ) : null}
                  {productStats ? (
                    <p className="text-xs text-muted-foreground">
                      New: {productStats.newCount} · Update: {productStats.updateCount} · Skipped:{' '}
                      {productStats.skippedCount}
                    </p>
                  ) : null}
                </div>
              </div>

              {preview.stats.totalRows === 0 && preview.meta?.hint ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {preview.meta.hint}{' '}
                  <a className="underline" href={TEMPLATE_URL} download>
                    Download the template
                  </a>
                </p>
              ) : null}

              {doubleStockWarning ? (
                <p className="text-xs font-medium text-amber-800 dark:text-amber-300 rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950/30 p-2">
                  Some rows already had opening stock imported. Importing again will add quantities on top
                  of current stock. Remove those rows or adjust quantities if you only want the difference.
                </p>
              ) : null}

              {preview.warnings.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">Warnings</p>
                  <ul className="max-h-28 overflow-y-auto text-xs text-amber-800 dark:text-amber-300 space-y-1">
                    {preview.warnings.map((w) => (
                      <li key={`w-${w.rowNumber}-${w.message}`}>
                        Row {w.rowNumber}: {w.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {isProductPreview(preview, kind) && preview.skipped.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Skipped (create-only)</p>
                  <ul className="max-h-24 overflow-y-auto text-xs text-muted-foreground space-y-1">
                    {preview.skipped.slice(0, 20).map((s) => (
                      <li key={`s-${s.rowNumber}`}>
                        Row {s.rowNumber}: {s.message}
                      </li>
                    ))}
                    {preview.skipped.length > 20 ? (
                      <li>…and {preview.skipped.length - 20} more</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}

              {preview.errors.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs font-medium text-destructive">Fix these rows in Excel, then preview again</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => downloadImportErrorCsv(filename || 'shop-import', preview.errors, kind)}
                    >
                      Download error report (CSV)
                    </Button>
                  </div>
                  <div className="max-h-56 overflow-auto rounded border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="text-left p-2 w-14">Row</th>
                          <th className="text-left p-2">Problem</th>
                          <th className="text-left p-2 min-w-[12rem]">How to fix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.errors.map((e) => (
                          <tr key={`e-${e.rowNumber}-${e.message}`} className="border-t align-top">
                            <td className="p-2 font-mono">{e.rowNumber}</td>
                            <td className="p-2 text-destructive">{e.message}</td>
                            <td className="p-2 text-muted-foreground">{shopImportFixHint(e.message, kind)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Close
          </Button>
          {canPartialConfirm ? (
            <Button
              variant="secondary"
              disabled={loading}
              onClick={() => void runCommit(true)}
            >
              Import {preview.valid.length} valid row(s) and skip {preview.errors.length} with errors
            </Button>
          ) : null}
          <Button disabled={!canStrictConfirm} onClick={() => void runCommit(false)}>
            Confirm import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
