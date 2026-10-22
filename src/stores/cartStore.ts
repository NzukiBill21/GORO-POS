import { create } from 'zustand';

export interface CartItem {
  id: string;
  productId: string;
  variantId?: string;
  name: string;
  sku?: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
  discount: number;
  taxAmount: number;
  total: number;
  image?: string;
}

interface CartState {
  items: CartItem[];
  customerId: string | null;
  customerName: string | null;
  discountAmount: number;
  taxAmount: number;
  notes: string;
  heldSaleId: string | null;

  addItem: (product: {
    id: string;
    name: string;
    sku?: string;
    sellingPrice: number;
    costPrice: number;
    image?: string;
    variantId?: string;
  }) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  setDiscount: (amount: number) => void;
  setCustomer: (id: string | null, name: string | null) => void;
  setNotes: (notes: string) => void;
  setHeldSaleId: (id: string | null) => void;
  loadHeldSale: (sale: {
    id: string;
    items: Array<{
      productId: string;
      variantId?: string | null;
      name: string;
      sku?: string | null;
      quantity: number;
      unitPrice: number;
      total: number;
    }>;
    discountAmount?: number;
  }) => void;
  clearCart: () => void;
  getSubtotal: () => number;
  getTotal: () => number;
  getItemCount: () => number;
}

function calcItemTotal(unitPrice: number, quantity: number, discount: number, taxAmount: number) {
  return unitPrice * quantity - discount + taxAmount;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: null,
  customerName: null,
  discountAmount: 0,
  taxAmount: 0,
  notes: '',
  heldSaleId: null,

  addItem: (product) => {
    const { items } = get();
    const existing = items.find(
      (i) => i.productId === product.id && i.variantId === product.variantId
    );

    if (existing) {
      set({
        items: items.map((i) =>
          i.id === existing.id
            ? {
                ...i,
                quantity: i.quantity + 1,
                total: calcItemTotal(i.unitPrice, i.quantity + 1, i.discount, i.taxAmount),
              }
            : i
        ),
      });
    } else {
      const newItem: CartItem = {
        id: `${product.id}-${product.variantId ?? 'default'}-${Date.now()}`,
        productId: product.id,
        variantId: product.variantId,
        name: product.name,
        sku: product.sku,
        unitPrice: product.sellingPrice,
        costPrice: product.costPrice,
        quantity: 1,
        discount: 0,
        taxAmount: 0,
        total: product.sellingPrice,
        image: product.image,
      };
      set({ items: [...items, newItem] });
    }
  },

  removeItem: (id) => {
    set({ items: get().items.filter((i) => i.id !== id) });
  },

  updateQuantity: (id, quantity) => {
    if (quantity <= 0) {
      get().removeItem(id);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.id === id
          ? { ...i, quantity, total: calcItemTotal(i.unitPrice, quantity, i.discount, i.taxAmount) }
          : i
      ),
    });
  },

  setDiscount: (amount) => set({ discountAmount: amount }),

  setCustomer: (id, name) => set({ customerId: id, customerName: name }),

  setNotes: (notes) => set({ notes }),

  setHeldSaleId: (id) => set({ heldSaleId: id }),

  loadHeldSale: (sale) => {
    set({
      heldSaleId: sale.id,
      discountAmount: sale.discountAmount ?? 0,
      items: sale.items.map((i) => ({
        id: `${i.productId}-${i.variantId ?? 'x'}-${Date.now()}`,
        productId: i.productId,
        variantId: i.variantId ?? undefined,
        name: i.name,
        sku: i.sku ?? undefined,
        unitPrice: i.unitPrice,
        costPrice: 0,
        quantity: i.quantity,
        discount: 0,
        taxAmount: 0,
        total: i.total,
      })),
    });
  },

  clearCart: () =>
    set({
      items: [],
      customerId: null,
      customerName: null,
      discountAmount: 0,
      taxAmount: 0,
      notes: '',
      heldSaleId: null,
    }),

  getSubtotal: () => get().items.reduce((sum, i) => sum + i.total, 0),

  getTotal: () => {
    const { discountAmount, taxAmount } = get();
    return get().getSubtotal() - discountAmount + taxAmount;
  },

  getItemCount: () => get().items.reduce((sum, i) => sum + i.quantity, 0),
}));
