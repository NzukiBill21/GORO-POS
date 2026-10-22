# Pilot smoke — POS + checkout (manual)

Use after UI changes to [`POSPage`](../src/pages/POSPage.tsx) or [`PosCheckoutDialog`](../src/components/pos/PosCheckoutDialog.tsx).

## What changed in this pass (look for these)

**Motion (Wave A)** — [`src/lib/motion.ts`](../src/lib/motion.ts)

- Product tiles and cart lines **fade/slide in** slightly when they appear (not instant pop-in).
- If Windows **“Show animations”** is off or browser **prefers reduced motion**, tiles/lines should appear **with no animation** (still fully usable).

**POS screen (Wave B)** — [`POSPage.tsx`](../src/pages/POSPage.tsx)

- **Narrow window / phone width:** a **horizontal row of category pills** under the search bar (All, Favorites, category names). Desktop still has the left category column.
- **Long product names:** two lines max on the tile; **hover** shows full name in a tooltip (`title`).
- **Cart:** line names truncate with tooltip; **KES amounts** align cleanly (`tabular-nums`).
- **Totals column:** subtotal/tax/total numbers align; long tax labels truncate instead of breaking layout.
- **Held sales** list: invoice numbers truncate with tooltip.

**Checkout dialog (Wave C)** — [`PosCheckoutDialog.tsx`](../src/components/pos/PosCheckoutDialog.tsx)

- Title row: **“Checkout”** on the left, **total in green** on the right (same total as before).
- After payment: **4-step bar** (1 Paid → 2 Receipt → 3 Change → 4 Print) instead of plain “1 Paid → 2 Receipt…” text.
- Payment choice: **three equal buttons** — Cash | M-Pesa | Split (labels shortened on small width).
- M-Pesa wait: **countdown seconds** still tick down; behavior unchanged.
- Dialog can **scroll** if the window is short.

**Not changed:** payment logic, APIs, receipt HTML, branding (Goro on tenant POS), F2/F12 shortcuts, sidebar hidden on `/pos`.

**Automated gate (already run):** `npm run check:redesign` — 44 tests + production build OK. See [REDESIGN_BASELINE.md](./REDESIGN_BASELINE.md).

---

**Environment:** `npm run dev:web` → open **http://127.0.0.1:5173**  
**Login (demo):** `manager@demostore.com` / `Admin123!`  
**Login (Iman seed):** `owner@imanhighstreet.local` / `ImanShop123!`

---

## Frozen contracts (do not break)

### `PosCheckoutDialog` props

`open`, `onClose`, `items`, `discountAmount`, `heldSaleId`, `onSuccess`

### `PayPhase` values

`idle` | `preparing` | `sending` | `waiting_customer` | `confirming` | `receipt_1` … `receipt_4` | `printing` | `failed` | `timed_out`

Visual changes only — keep transitions and side effects (STK poll, receipt steps, print).

### API paths (checkout)

| Method | Path |
|--------|------|
| POST | `/pos/checkout/quote` |
| POST | `/pos/checkout` |
| POST | `/pos/sales/:id/pay/cash` |
| POST | `/pos/sales/:id/pay/split` |
| POST | `/pos/sales/:id/pay/mpesa-stk` |
| GET | `/pos/sales/:id/stk-status` (poll while waiting) |
| GET | `/pos/sales/:id/summary` |
| GET | `/pos/sales/:id/receipt` |

### API paths (POS page)

| Method | Path |
|--------|------|
| GET | `/categories` |
| GET | `/products?…` |
| GET | `/products/barcode/:code` |
| GET | `/sales/held` |
| POST | `/pos/hold` |
| POST | (quote — same as checkout quote body from cart) |

### Layout

- `/pos` — no sidebar ([`AppLayout`](../src/components/layout/AppLayout.tsx)); full-screen till.

### Branding

- Tenant POS: Goro marks only — not Gorovian knot on tenant routes ([`ICON/README.txt`](../ICON/README.txt)).

---

## Smoke checklist (~15 min)

Mark each when pass:

- [ ] **1. Navigate to POS** — sidebar hidden; page loads without white screen.
- [ ] **2. Categories** — switch category; product counts look correct.
- [ ] **3. Search** — debounced search returns products.
- [ ] **4. Add to cart** — qty +/-, remove line; totals update.
- [ ] **5. Variant picker** — if product has variants, picker works.
- [ ] **6. Barcode** — type a known SKU/barcode in scan field (if no scanner).
- [ ] **7. Hold / recall** — hold sale, open held list, recall into cart.
- [ ] **8. Cash checkout** — pay cash → OK steps (receipt_1–4) → print preview/iframe (disable browser headers/footers if needed).
- [ ] **9. M-Pesa (dev mock)** — STK path shows countdown (~90s max wait); success or clear timeout/failed state; dialog not stuck.
- [ ] **10. Cash shift** — open/close shift dialog if your role requires it.
- [ ] **11. Regression** — open Dashboard once; no 401 spam in console.

**Fail criteria:** any payment cannot complete; print blank; cart lost on hold recall; 402 on POS for pilot org.

---

## Agent / skills (optional)

When installing [Emil Kowalski skills](https://github.com/emilkowalski/skills):

```bash
npx skills@latest add emilkowalski/skills -a cursor
```

Before merge: `/review-animations` on POS + checkout; `/break-ui` on product tiles and checkout labels.

Redesign **CSS, layout, motion only** — no API or `PayPhase` logic changes without updating `tests/pos-payments.test.ts`.
