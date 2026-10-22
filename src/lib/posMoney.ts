/** Parse cashier tender input into whole currency units (KES has no minor units in this POS). */
export function parseTenderInput(raw: string, allowDecimals: boolean): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/,/g, '');
  const n = allowDecimals ? parseFloat(normalized) : parseInt(normalized, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return allowDecimals ? Math.round(n * 100) / 100 : Math.round(n);
}

export function currencyAllowsDecimals(code: string): boolean {
  return code !== 'KES';
}
