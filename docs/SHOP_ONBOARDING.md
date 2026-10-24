# Shop onboarding (Excel)

## Workbook

Use **GOROVIAN_Shop_Product_and_Stock_Template.xlsx**:

| Location | Purpose |
|----------|---------|
| `public/templates/` (app **Download template** button) | Copy staff download from the Products import dialog |
| `docs/templates/` | Same file for ops / version control |

Sheets:

1. **START HERE** — instructions (not imported)
2. **PRODUCTS** — catalogue + variants (import first)
3. **OPENING STOCK** — quantities only (import second)

Optional reference tabs (not imported by the app): supplier receipts → use **Receive stock** in the app; barcode notes for your team.

Regenerate the official template after header changes:

```powershell
python tests/fixtures/shop-import/generate_shop_template.py
```

## Import steps (Products → **Import Excel workbook**)

The dialog is a two-step flow:

1. **Step 1 — Products catalogue**  
   Upload `.xlsx` → choose **import mode** → **Preview import** → review warnings/errors → **Confirm import** (or partial import if some rows are invalid).

2. **Step 2 — Opening stock**  
   Same workbook (OPENING STOCK sheet) → preview → confirm. Adds stock to the default warehouse with audited movements; does not change prices.

### Import mode (products only)

| Mode | Behaviour |
|------|-----------|
| **Create only** (default) | New SKUs are created. Rows that already match an existing product/variant SKU are **skipped** (not errors). |
| **Create and update** | Existing lines are updated (prices, names, etc. when cells are filled). Requires `products.edit`. Re-importing the same barcode on the same variant is allowed. |

### Preview & errors

- Preview shows **sheet used**, row counts, **new / update / skipped**, **warnings**, and a full **error table** (Row | Problem | How to fix).
- **Download error report (CSV)** for rows to fix in Excel.
- **Confirm import** is enabled only when there are no errors (valid rows may still include warnings).
- If some rows are valid and others have errors, use **Import N valid rows and skip M with errors** (partial commit of the valid subset only).

### Idempotency & file size

- Each successful **preview** gets a fresh confirmation id; repeating **Confirm** with the same id does not double-apply (especially opening stock).
- Workbooks must stay under about **1.5 MB** (API limit ~2 MB including base64 encoding).

## Column hints (PRODUCTS)

| Column | Required |
|--------|----------|
| Product name | Yes |
| Selling price | Yes (≥ 0; 0 shows a warning) |
| Product SKU | Recommended for clothing / multi-variant products |
| Variant SKU | One per sellable variant (size/colour line) |
| Size / Color / Variant name | Used to build variant identity |
| Barcode | Optional (unique per item in catalogue) |
| Category / Brand | Optional (created if missing) |
| Cost price, Min stock, Track stock, Unit | Optional; parent product fields come from the first row of each product group |

## Opening stock sheet

| Column | Notes |
|--------|--------|
| Variant SKU | Preferred (must exist after products import) |
| Product SKU or product name | Alternative matchers |
| Quantity | Positive whole number |

If opening stock was already imported for an item, preview shows a **double stock** warning — importing again **adds** quantities.

## Permissions

| Action | Permission |
|--------|------------|
| Products import (create) | `products.create` |
| Create and update mode | `products.create` + `products.edit` |
| Opening stock | `inventory.edit` |

## Test fixtures (developers)

Mock workbooks under `tests/fixtures/shop-import/`:

```powershell
python tests/fixtures/shop-import/generate_fixtures.py
npx vitest run tests/shop-import-fixtures.test.ts tests/shop-import.test.ts
```

Integration tests use an isolated DB at `tests/.tmp/shop-import.test.db` (not your dev `dev.db`).
