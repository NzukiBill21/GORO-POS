import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Variant {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  sellingPrice?: number | null;
  costPrice?: number | null;
}

interface Props {
  productId: string;
  canEdit: boolean;
}

export function ProductVariantsEditor({ productId, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [costPrice, setCostPrice] = useState('');

  const { data: product } = useQuery({
    queryKey: ['product-detail', productId],
    queryFn: () => api.get<{ variants: Variant[] }>(`/products/${productId}`),
    enabled: !!productId,
  });

  const variants = product?.variants ?? [];

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/products/${productId}/variants`, {
        name: name.trim(),
        sku: sku.trim() || undefined,
        barcode: barcode.trim() || undefined,
        sellingPrice: sellingPrice ? parseFloat(sellingPrice) : undefined,
        costPrice: costPrice ? parseFloat(costPrice) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-detail', productId] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setName('');
      setSku('');
      setBarcode('');
      setSellingPrice('');
      setCostPrice('');
    },
  });

  if (!canEdit) return null;

  return (
    <div className="space-y-3 border-t pt-4">
      <Label className="text-sm font-semibold">Variants (size, colour, etc.)</Label>
      {variants.length > 0 && (
        <ul className="text-sm space-y-1 max-h-32 overflow-y-auto">
          {variants.map((v) => (
            <li key={v.id} className="flex justify-between gap-2 border rounded px-2 py-1">
              <span>{v.name}</span>
              <span className="text-muted-foreground shrink-0">
                {v.sku ?? '—'} · {v.sellingPrice != null ? formatCurrency(v.sellingPrice) : '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Variant name *" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <Input placeholder="Barcode" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
        <Input placeholder="Sell price" type="number" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={!name.trim() || createMutation.isPending}
        onClick={() => createMutation.mutate()}
      >
        <Plus className="h-4 w-4 mr-1" />
        Add variant
      </Button>
    </div>
  );
}
