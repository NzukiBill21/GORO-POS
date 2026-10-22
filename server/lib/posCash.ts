/** Sum change due from completed cash payments that recorded tendered amounts. */
export function cashChangeCentsFromPayments(
  payments: Array<{ method: string; status: string; amountCents: number | null; amount: number; tenderedCents: number | null }>
): number {
  let change = 0;
  for (const p of payments) {
    if (p.method !== 'CASH' || p.status !== 'COMPLETED') continue;
    const applied = p.amountCents ?? Math.round(p.amount);
    if (p.tenderedCents != null && p.tenderedCents > applied) {
      change += p.tenderedCents - applied;
    }
  }
  return change;
}

export function parseTenderedFromNotes(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const m = /Tendered\s+(\d+)/i.exec(notes);
  return m ? parseInt(m[1], 10) : null;
}
