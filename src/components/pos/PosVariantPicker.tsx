import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/lib/utils';

export interface PosVariantOption {
  id: string;
  name: string;
  sku?: string | null;
  sellingPrice?: number | null;
}

interface Props {
  open: boolean;
  productName: string;
  variants: PosVariantOption[];
  onSelect: (variant: PosVariantOption) => void;
  onClose: () => void;
}

export function PosVariantPicker({ open, productName, variants, onSelect, onClose }: Props) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Choose variant — {productName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {variants.map((v) => (
            <Button
              key={v.id}
              variant="outline"
              className="w-full justify-between h-auto py-3"
              onClick={() => onSelect(v)}
            >
              <span>{v.name}</span>
              <span className="text-muted-foreground text-sm">
                {v.sku ? `${v.sku} · ` : ''}
                {v.sellingPrice != null ? formatCurrency(v.sellingPrice) : ''}
              </span>
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
