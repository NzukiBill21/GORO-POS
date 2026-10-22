export interface CurrencyOption {
  code: string;
  label: string;
  locale: string;
}

/** Supported system currencies — change in Settings → Business */
export const SUPPORTED_CURRENCIES: CurrencyOption[] = [
  { code: 'KES', label: 'Kenyan Shilling (KES)', locale: 'en-KE' },
  { code: 'USD', label: 'US Dollar (USD)', locale: 'en-US' },
  { code: 'EUR', label: 'Euro (EUR)', locale: 'de-DE' },
  { code: 'GBP', label: 'British Pound (GBP)', locale: 'en-GB' },
  { code: 'UGX', label: 'Ugandan Shilling (UGX)', locale: 'en-UG' },
  { code: 'TZS', label: 'Tanzanian Shilling (TZS)', locale: 'en-TZ' },
  { code: 'RWF', label: 'Rwandan Franc (RWF)', locale: 'en-RW' },
  { code: 'ZAR', label: 'South African Rand (ZAR)', locale: 'en-ZA' },
  { code: 'NGN', label: 'Nigerian Naira (NGN)', locale: 'en-NG' },
  { code: 'INR', label: 'Indian Rupee (INR)', locale: 'en-IN' },
];

export const DEFAULT_CURRENCY = 'KES';

export function getCurrencyLocale(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.locale ?? 'en-KE';
}

export function getCurrencyLabel(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.label ?? code;
}
