# POS UI direction (default — no “pick a style” required)

This is the **single direction** for the till product. Follow it for all POS work unless the owner explicitly changes branding.

## One sentence

**Retail clarity:** fast to use under pressure, money always obvious, motion only to confirm actions, looks clean on a shop PC — not flashy.

## Principles (in priority order)

1. **Works first** — checkout, stock, hold/recall, print, M-Pesa paths never break for visual tweaks. Gate: `npm run check:redesign` + [PILOT_SMOKE.md](./PILOT_SMOKE.md).
2. **Money is king** — totals, change, and line prices use **tabular numbers**, strong hierarchy on **Pay** and checkout total.
3. **Touch & keyboard** — min ~44px tap targets on till; keep **F2** (search) and **F12** (pay).
4. **Calm motion** — short ease-out on enter (tiles, cart lines); **no motion** when user prefers reduced motion. No decorative animation on payment wait states.
5. **Brand** — **Goro** on tenant POS ([`ICON/README.txt`](../ICON/README.txt)); mint **primary** from `theme-default`. Gorovian knot = platform admin only.
6. **Density** — product grid readable at arm’s length; truncate long names with tooltip; never overflow the cart column.

## What “professional” means here (not Dribbble)

| Do | Don’t |
|----|--------|
| Clear selected category / payment method | New color systems per page |
| Consistent spacing (Tailwind scale) | Glass blur, heavy gradients on till |
| Subtle hover on product tiles | Full-app redesign before POS is perfect |
| Step bar on receipt flow | Change payment APIs for UI experiments |

## Scope order (build in this sequence)

1. **`/pos` till** — grid, cart, checkout dialog (current focus)
2. **Login / setup wizard** — same tokens, simple and trustworthy
3. **Back-office pages** — reuse components; lower priority than till

## Technical anchors

- UI: Radix + shared [`src/components/ui/*`](../src/components/ui/)
- Motion: [`src/lib/motion.ts`](../src/lib/motion.ts)
- Agent guardrails: [`.cursor/rules/pos-redesign.mdc`](../.cursor/rules/pos-redesign.mdc)
- Dev URL: **127.0.0.1:5173** only; packaged till: **127.0.0.1:3001** only

## Optional later (not required for “good POS”)

- Emil Kowalski skills for animation **review**, not random new libraries
- Dark till theme (only if shop asks; test contrast on sunlit screens)

When in doubt: **make the cashier faster and the total impossible to miss.**
