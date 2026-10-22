import { create } from 'zustand';
import { DEFAULT_CURRENCY } from '@/lib/currencies';

interface BusinessState {
  currency: string;
  setCurrency: (currency: string) => void;
}

export const useBusinessStore = create<BusinessState>((set) => ({
  currency: DEFAULT_CURRENCY,
  setCurrency: (currency) => set({ currency: currency || DEFAULT_CURRENCY }),
}));

export function getSystemCurrency(): string {
  return useBusinessStore.getState().currency;
}
