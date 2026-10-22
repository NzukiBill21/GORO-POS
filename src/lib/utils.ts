import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { getCurrencyLocale, DEFAULT_CURRENCY } from '@/lib/currencies';
import { getSystemCurrency } from '@/stores/businessStore';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency?: string): string {
  const code = currency ?? getSystemCurrency() ?? DEFAULT_CURRENCY;
  const locale = getCurrencyLocale(code);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: code === 'KES' ? 0 : 2,
    maximumFractionDigits: code === 'KES' ? 0 : 2,
  }).format(amount);
}

/** Compact symbol for chart axes (e.g. KSh 1.2k) */
export function formatCurrencyCompact(amount: number, currency?: string): string {
  const code = currency ?? getSystemCurrency() ?? DEFAULT_CURRENCY;
  const locale = getCurrencyLocale(code);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(date));
}

export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
