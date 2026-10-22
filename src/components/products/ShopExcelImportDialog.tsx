import { useState } from 'react';
import { api } from '@/lib/api';
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

type ImportKind = 'products' | 'opening-stock';

type PreviewState = {
  valid: unknown[];
  errors: Array<{ rowNumber: number; message: string }>;
  stats: { totalRows: number; validCount: number; errorCount: number };
  meta?: {
    sheetUsed?: string;
    sheetNames?: string[];
    hint?: string;
  };
};

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function ShopExcelImportDialog({ open, onClose, onComplete }: Props) {
  const [kind, setKind] = useState<ImportKind>('products');
  const [filename, setFilename] = useState('');
  const [fileBase64, setFileBase64] = useState('');
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const reset = () => {
    setPreview(null);
    setResult(null);
    setFileBase64('');
    setFilename('');
  };

  const onFile = (file: File) => {
    reset();
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

  const runPreview = async () => {
    if (!fileBase64) return;
    setLoading(true);
    setResult(null);
    try {
      const path =
        kind === 'products' ? '/shop-import/preview/products' : '/shop-import/preview/opening-stock';
      const data = await api.post<PreviewState>(path, { fileBase64, filename });
      setPreview(data);
    } catch (err) {
      setPreview(null);
      setResult(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const runCommit = async () => {
    if (!preview?.valid.length) return;
    setLoading(true);
    try {
      const path =
        kind === 'products' ? '/shop-import/commit/products' : '/shop-import/commit/opening-stock';
      const data = await api.post<Record<string, unknown>>(path, {
        idempotencyKey,
        filename,
        rows: preview.valid,
      });
      if (data.idempotentReplay) {
        setResult('This import was already applied (same confirmation id). No duplicate changes.');
      } else {
        setResult(`Import succeeded.\n${JSON.stringify(data, null, 2)}`);
      }
      onComplete();
    } catch (err) {
      setResult(err instanceof Error ? err.message : 'Import failed — fix row errors and preview again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import shop workbook</DialogTitle>
          <DialogDescription>
            Use <strong>GOROVIAN_Shop_Product_and_Stock_Template.xlsx</strong>. Import products first,
            then opening stock in a separate step. Barcodes are optional.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant={kind === 'products' ? 'default' : 'outline'}
              onClick={() => {
                setKind('products');
                reset();
              }}
            >
              Products catalogue
            </Button>
            <Button
              type="button"
              variant={kind === 'opening-stock' ? 'default' : 'outline'}
              onClick={() => {
                setKind('opening-stock');
                reset();
              }}
            >
              Opening stock
            </Button>
          </div>

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
          </div>

          <Button type="button" disabled={!fileBase64 || loading} onClick={() => void runPreview()}>
            {loading ? 'Working…' : 'Preview import'}
          </Button>

          {preview ? (
            <div className="rounded-md border p-3 text-sm space-y-2">
              <p>
                Valid rows: <strong>{preview.stats.validCount}</strong> / {preview.stats.totalRows}
                {preview.stats.errorCount > 0 ? (
                  <span className="text-destructive"> — {preview.stats.errorCount} error(s)</span>
                ) : null}
              </p>
              {preview.meta?.sheetUsed ? (
                <p className="text-xs text-muted-foreground">Sheet used: {preview.meta.sheetUsed}</p>
              ) : null}
              {preview.stats.totalRows === 0 && preview.meta?.hint ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">{preview.meta.hint}</p>
              ) : null}
              {preview.errors.length > 0 ? (
                <ul className="max-h-40 overflow-y-auto text-destructive text-xs space-y-1">
                  {preview.errors.slice(0, 50).map((e) => (
                    <li key={e.rowNumber}>
                      Row {e.rowNumber}: {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {result ? (
            <pre className="text-xs bg-muted p-2 rounded-md overflow-x-auto whitespace-pre-wrap">{result}</pre>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!preview || preview.errors.length > 0 || !preview.valid.length || loading}
            onClick={() => void runCommit()}
          >
            Confirm import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
