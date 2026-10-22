# UI redesign baseline (POS + checkout)

**Recorded:** 2026-10-21  
**Scope:** Pass 1 — [`POSPage.tsx`](../src/pages/POSPage.tsx), [`PosCheckoutDialog.tsx`](../src/components/pos/PosCheckoutDialog.tsx) only.

## Automated gate (run before and after each wave)

| Command | Result | Notes |
|---------|--------|--------|
| `npm test` | **PASS** — 7 files, **44** tests | Includes `tests/pos-payments.test.ts` (8) |
| `npm run build` | **PASS** | Vite production bundle |
| `npx tsc --noEmit` | **FAIL** (pre-existing) | Full-repo strict check; many server `req.params` typing issues. **Redesign gate uses `npm test` + `npm run build` until tsc is cleaned repo-wide.** |

## Git / rollback

This workspace is **not a git repository** (2026-10-21). Before large UI edits:

- Copy the project folder or initialize git: `git init` + initial commit recommended.
- Planned branch name: `feat/pos-ui-redesign`.

## Dev URLs (do not mix)

- **Dev browser:** `http://127.0.0.1:5173` only (`npm run dev:web`).
- **Shop desktop:** `http://127.0.0.1:3001` only (Electron + `SERVE_STATIC`).

## Wave log

| Wave | Date | `check:redesign` | Notes |
|------|------|------------------|--------|
| A — motion tokens | 2026-10-21 | PASS | [`src/lib/motion.ts`](../src/lib/motion.ts), POS tile + cart line motion, `useReducedMotion` |
| B — POS layout | 2026-10-21 | PASS | Truncation/titles, mobile category chips, tabular-nums totals |
| C — checkout UI | 2026-10-21 | PASS | [`PosReceiptStepBar`](../src/components/pos/PosReceiptStepBar.tsx), method grid, STK `aria-live` |

## Status

**Code complete** for POS + checkout redesign (waves A–C). **You** should run manual smoke once before Iman/desktop deploy.

## Next steps

1. **Manual smoke:** [PILOT_SMOKE.md](./PILOT_SMOKE.md) — section “What changed” lists what to eyeball
2. Optional: `git init` + commit snapshot (repo was not under git at baseline)
3. Optional skills: `npx skills@latest add emilkowalski/skills -a cursor` for future UI passes
