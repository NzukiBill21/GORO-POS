import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Star,
  Minus,
  Plus,
  Trash2,
  User,
  Banknote,
  Pause,
  RotateCcw,
  Receipt,
  ScanBarcode,
  Package,
} from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { posCartLineMotion, posProductTileMotion } from '@/lib/motion';
import { api } from '@/lib/api';
import { cn, formatCurrency, debounce } from '@/lib/utils';
import { useCartStore } from '@/stores/cartStore';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { PosCheckoutDialog } from '@/components/pos/PosCheckoutDialog';
import { PosVariantPicker, type PosVariantOption } from '@/components/pos/PosVariantPicker';
import { CashShiftDialog } from '@/components/pos/CashShiftDialog';

interface Product {
  id: string;
  name: string;
  sku?: string;
  barcode?: string;
  sellingPrice: number;
  costPrice: number;
  image?: string;
  stock: number;
  isFavorite: boolean;
  category?: { id: string; name: string };
  variants?: PosVariantOption[];
  matchedVariantId?: string | null;
}

interface Category {
  id: string;
  name: string;
  _count: { products: number };
}

export default function POSPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showFavorites, setShowFavorites] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const {
    items,
    customerName,
    discountAmount,
    heldSaleId,
    addItem,
    removeItem,
    updateQuantity,
    clearCart,
    getSubtotal,
    getItemCount,
    loadHeldSale,
  } = useCartStore();

  const [heldOpen, setHeldOpen] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [variantPick, setVariantPick] = useState<{ product: Product; variants: PosVariantOption[] } | null>(null);
  const reduceMotion = useReducedMotion();

  const debouncedSetSearch = useMemo(
    () => debounce((value: string) => setDebouncedSearch(value), 300),
    []
  );

  useEffect(() => {
    debouncedSetSearch(search);
  }, [search, debouncedSetSearch]);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories'),
  });

  const topLevelCategories = useMemo(() => {
    const seen = new Set<string>();
    return categories.filter((c) => {
      if (c.name === 'All Products' || seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [categories]);

  const { data: productsData, isLoading: productsLoading } = useQuery<{ data: Product[] }>({
    queryKey: ['products', debouncedSearch, selectedCategory, showFavorites],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (selectedCategory) params.set('categoryId', selectedCategory);
      if (showFavorites) params.set('favorites', 'true');
      return api.get(`/products?${params}`);
    },
  });

  const products = productsData?.data ?? [];

  const cartQuoteKey = useMemo(
    () =>
      JSON.stringify({
        items: items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, discount: i.discount })),
        discountAmount,
      }),
    [items, discountAmount]
  );

  const { data: serverQuote } = useQuery({
    queryKey: ['pos-quote', cartQuoteKey],
    queryFn: () =>
      api.post<{ subtotalCents: number; taxCents: number; totalCents: number; currency: string; taxName?: string; taxRate?: number }>(
        '/pos/checkout/quote',
        {
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            quantity: i.quantity,
            discount: i.discount,
          })),
          discountAmount,
        }
      ),
    enabled: items.length > 0,
  });

  const onCheckoutSuccess = useCallback(() => {
    clearCart();
    queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['pos-quote'] });
  }, [clearCart, queryClient]);

  const addProductToCart = useCallback(
    (product: Product, variant?: PosVariantOption) => {
      const lineName = variant ? `${product.name} (${variant.name})` : product.name;
      addItem({
        id: product.id,
        name: lineName,
        sku: variant?.sku ?? product.sku,
        sellingPrice: variant?.sellingPrice ?? product.sellingPrice,
        costPrice: product.costPrice,
        image: product.image,
        variantId: variant?.id ?? product.matchedVariantId ?? undefined,
      });
    },
    [addItem]
  );

  const handleAddProduct = useCallback(
    (product: Product) => {
      if (product.stock <= 0) {
        setBarcodeError(`${product.name} is out of stock`);
        return;
      }
      const variants = product.variants ?? [];
      if (product.matchedVariantId) {
        const v = variants.find((x) => x.id === product.matchedVariantId);
        addProductToCart(product, v ?? { id: product.matchedVariantId, name: 'Variant', sellingPrice: product.sellingPrice });
        return;
      }
      if (variants.length > 1) {
        setVariantPick({ product, variants });
        return;
      }
      if (variants.length === 1) {
        addProductToCart(product, variants[0]);
        return;
      }
      addProductToCart(product);
    },
    [addProductToCart]
  );

  const [barcodeError, setBarcodeError] = useState<string | null>(null);

  const handleBarcodeSearch = async (code: string) => {
    const trimmed = code.trim();
    if (trimmed.length < 3) return;
    setBarcodeError(null);
    try {
      const product = await api.get<Product>(`/products/barcode/${encodeURIComponent(trimmed)}`);
      handleAddProduct(product);
      setSearch('');
    } catch {
      setBarcodeError(`Barcode not found: ${trimmed}`);
      setSearch(trimmed);
    } finally {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  };

  const { data: heldSales = [], refetch: refetchHeld } = useQuery<
    Array<{ id: string; invoiceNumber: string; total: number; items: Array<{ productId: string; variantId?: string | null; name: string; sku?: string | null; quantity: number; unitPrice: number; total: number }> }>
  >({
    queryKey: ['sales-held'],
    queryFn: () => api.get('/sales/held'),
    enabled: heldOpen,
  });

  const holdSale = async () => {
    if (items.length === 0) return;
    await api.post('/pos/hold', {
      items: items.map((i) => ({
        productId: i.productId,
        variantId: i.variantId,
        quantity: i.quantity,
        discount: i.discount,
      })),
      discountAmount,
    });
    clearCart();
    refetchHeld();
  };

  const handleCheckout = useCallback(() => {
    if (items.length === 0) return;
    setCheckoutOpen(true);
  }, [items.length]);

  const subtotal = serverQuote?.subtotalCents ?? getSubtotal();
  const taxAmount = serverQuote?.taxCents ?? subtotal * 0.16;
  const total = serverQuote?.totalCents ?? subtotal - discountAmount + taxAmount;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F12' && items.length > 0) {
        e.preventDefault();
        handleCheckout();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [items, handleCheckout]);

  return (
    <div className="pos-till flex h-full min-h-0 overflow-hidden bg-background">
      {/* Categories Sidebar — collapsible on small screens */}
      <div className="hidden sm:flex w-44 md:w-48 shrink-0 border-r bg-card flex-col min-h-0">
        <div className="p-3 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Categories</h2>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            <button
              onClick={() => { setSelectedCategory(null); setShowFavorites(false); }}
              className={cn(
                'w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                !selectedCategory && !showFavorites
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent text-muted-foreground'
              )}
            >
              All Products
            </button>
            <button
              onClick={() => { setShowFavorites(true); setSelectedCategory(null); }}
              className={cn(
                'w-full flex items-center gap-2 text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                showFavorites
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-accent text-muted-foreground'
              )}
            >
              <Star className="h-4 w-4" />
              Favorites
            </button>
            {topLevelCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => { setSelectedCategory(cat.id); setShowFavorites(false); }}
                className={cn(
                  'w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  selectedCategory === cat.id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent text-muted-foreground'
                )}
              >
                <span className="block truncate" title={cat.name}>
                  {cat.name}
                </span>
                <span className="ml-1 text-xs opacity-70">({cat._count.products})</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Products Grid */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <div className="flex flex-col gap-2 border-b bg-card px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="relative flex-1 max-w-lg min-w-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Search products or scan barcode (F2)..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (barcodeError) setBarcodeError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && search.trim().length >= 3) {
                  e.preventDefault();
                  void handleBarcodeSearch(search);
                }
              }}
              className="pl-9"
              autoFocus
            />
            {barcodeError ? (
              <div className="text-xs text-destructive mt-1 px-1 space-y-1" role="alert">
                <p>{barcodeError}</p>
                {barcodeError.startsWith('Barcode not found') ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs"
                    onClick={() =>
                      navigate(`/products?barcode=${encodeURIComponent(search.trim())}`)
                    }
                  >
                    Register this product
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setShiftOpen(true)}>
            <Banknote className="h-4 w-4" />
            Shift
          </Button>
          <Button variant="outline" size="sm" className="gap-2">
            <ScanBarcode className="h-4 w-4" />
            Scan
          </Button>
          <div className="text-sm text-muted-foreground hidden md:block shrink-0">
            Cashier: <span className="font-medium text-foreground">{user?.firstName}</span>
          </div>
        </div>

        {/* Mobile categories (sidebar hidden below sm) */}
        <div className="sm:hidden border-b bg-muted/30 px-2 py-2 overflow-x-auto">
          <div className="flex gap-1.5 min-w-max">
            <button
              type="button"
              onClick={() => { setSelectedCategory(null); setShowFavorites(false); }}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                !selectedCategory && !showFavorites ? 'bg-primary text-primary-foreground' : 'bg-card border',
              )}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => { setShowFavorites(true); setSelectedCategory(null); }}
              className={cn(
                'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1',
                showFavorites ? 'bg-primary text-primary-foreground' : 'bg-card border',
              )}
            >
              <Star className="h-3 w-3" /> Favorites
            </button>
            {topLevelCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                title={cat.name}
                onClick={() => { setSelectedCategory(cat.id); setShowFavorites(false); }}
                className={cn(
                  'shrink-0 max-w-[8rem] truncate rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  selectedCategory === cat.id ? 'bg-primary text-primary-foreground' : 'bg-card border',
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        {/* Products */}
        <ScrollArea className="flex-1 p-4">
          {productsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-md" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 gap-4">
              <AnimatePresence>
                {products.map((product) => (
                  <motion.button
                    key={product.id}
                    layout={!reduceMotion}
                    {...(reduceMotion
                      ? {}
                      : {
                          ...posProductTileMotion,
                          transition: posProductTileMotion.transition,
                        })}
                    onClick={() => handleAddProduct(product)}
                    title={product.name}
                    className="pos-product-tile group relative flex min-h-[176px] flex-col items-stretch rounded-md border bg-card p-3 text-left active:scale-[0.98] min-w-0 w-full"
                  >
                    {product.isFavorite && (
                      <Star className="absolute top-2 right-2 h-3.5 w-3.5 fill-warning text-warning" />
                    )}
                    <div className="flex h-24 w-full items-center justify-center overflow-hidden rounded-md bg-primary/5 mb-2 group-hover:bg-primary/10 transition-colors">
                      {product.image ? (
                        <img src={product.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <span className="text-3xl font-bold text-primary/30">
                          {product.name.charAt(0)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold line-clamp-2 leading-snug min-h-[2.5rem] break-words">
                      {product.name}
                    </p>
                    <p className="text-base font-bold text-primary mt-auto pt-1 tabular-nums truncate">
                      {formatCurrency(product.sellingPrice)}
                    </p>
                    {product.stock <= 5 && (
                      <span className="absolute bottom-2 left-2 text-[10px] font-medium text-warning bg-warning/10 px-1.5 py-0.5 rounded">
                        {product.stock} left
                      </span>
                    )}
                  </motion.button>
                ))}
              </AnimatePresence>
            </div>
          )}
          {!productsLoading && products.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <Package className="h-12 w-12 mb-3 opacity-30" />
              <p>No products found</p>
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Cart Panel */}
      <div className="w-full sm:w-80 lg:w-96 shrink-0 border-l bg-card flex flex-col min-h-0 min-w-0">
        <div className="flex items-center justify-between border-b p-3 sm:p-4 shrink-0">
          <div className="min-w-0">
            <h2 className="font-semibold truncate">Current Sale</h2>
            <p className="text-xs text-muted-foreground">{getItemCount()} items</p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={clearCart} disabled={items.length === 0}>
              <RotateCcw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" disabled={items.length === 0} onClick={() => void holdSale()} title="Hold sale">
              <Pause className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setHeldOpen(true)}>
              Held
            </Button>
          </div>
        </div>

        {/* Customer */}
        <div className="px-4 py-2 border-b">
          <button className="flex items-center gap-2 w-full rounded-lg border border-dashed p-2.5 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors">
            <User className="h-4 w-4" />
            {customerName ?? 'Select Customer'}
          </button>
        </div>

        {/* Cart Items */}
        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            <AnimatePresence>
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  layout={!reduceMotion}
                  {...(reduceMotion ? {} : posCartLineMotion)}
                  className="flex items-center gap-2 rounded-lg border p-2.5"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" title={item.name}>
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.unitPrice)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => updateQuantity(item.id, item.quantity - 1)}
                    >
                      <Minus className="h-3 w-3" />
                    </Button>
                    <span className="w-8 text-center text-sm font-medium">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => updateQuantity(item.id, item.quantity + 1)}
                    >
                      <Plus className="h-3 w-3" />
                    </Button>
                  </div>
                  <span className="text-sm font-semibold w-16 text-right tabular-nums shrink-0">
                    {formatCurrency(item.total)}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => removeItem(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </motion.div>
              ))}
            </AnimatePresence>
            {items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Receipt className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-sm">Cart is empty</p>
                <p className="text-xs">Add products to start a sale</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Totals & Checkout */}
        <div className="border-t p-4 space-y-3">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground shrink-0">Subtotal</span>
              <span className="tabular-nums text-right truncate">{formatCurrency(subtotal)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground truncate min-w-0">
                {serverQuote?.taxName ?? 'Tax'}
                {serverQuote?.taxRate != null ? ` (${(serverQuote.taxRate * 100).toFixed(2)}%)` : ''}
              </span>
              <span className="tabular-nums shrink-0">{formatCurrency(taxAmount)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between gap-2 text-success">
                <span>Discount</span>
                <span className="tabular-nums">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between gap-2 text-lg font-bold pt-1 border-t">
              <span>Total</span>
              <span className="text-primary tabular-nums">{formatCurrency(total)}</span>
            </div>
          </div>

          <Button
            size="xl"
            className="pos-pay-cta w-full min-h-11 text-lg font-bold gap-2"
            disabled={items.length === 0}
            onClick={handleCheckout}
          >
            <Banknote className="h-5 w-5" />
            Pay {formatCurrency(total)}
          </Button>

          <PosCheckoutDialog
            open={checkoutOpen}
            onClose={() => setCheckoutOpen(false)}
            items={items.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              quantity: i.quantity,
              discount: i.discount,
            }))}
            discountAmount={discountAmount}
            heldSaleId={heldSaleId}
            onSuccess={onCheckoutSuccess}
          />

          {heldOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-card rounded-lg border max-w-md w-full p-4 space-y-3 max-h-[70vh] overflow-auto">
                <h3 className="font-semibold">Held sales</h3>
                {heldSales.length === 0 && <p className="text-sm text-muted-foreground">No held sales.</p>}
                {heldSales.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="w-full text-left border rounded p-3 hover:bg-accent"
                    onClick={() => {
                      loadHeldSale({ id: s.id, items: s.items, discountAmount: 0 });
                      setHeldOpen(false);
                    }}
                  >
                    <p className="font-medium truncate" title={s.invoiceNumber}>
                      {s.invoiceNumber}
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">{formatCurrency(s.total)}</p>
                  </button>
                ))}
                <Button variant="outline" className="w-full" onClick={() => setHeldOpen(false)}>Close</Button>
              </div>
            </div>
          )}
          <p className="text-center text-[10px] text-muted-foreground">F12 to checkout · F2 to search</p>
        </div>
      </div>

      <CashShiftDialog open={shiftOpen} onOpenChange={setShiftOpen} />
      {variantPick && (
        <PosVariantPicker
          open
          productName={variantPick.product.name}
          variants={variantPick.variants}
          onClose={() => setVariantPick(null)}
          onSelect={(v) => {
            addProductToCart(variantPick.product, v);
            setVariantPick(null);
          }}
        />
      )}
    </div>
  );
}
