# Shop onboarding (Excel)

## Workbook

Use **GOROVIAN_Shop_Product_and_Stock_Template.xlsx** with tabs:

1. **START HERE** — instructions (not imported)
2. **PRODUCTS** — catalogue + variants (import first)
3. **OPENING STOCK** — quantities only (import second)
4. **SUPPLIER RECEIPTS** — use **Receive stock** in the app for day-to-day deliveries
5. **BARCODE NOTES** — reference only

Place a copy of the workbook in `docs/templates/` for your team.

## Import steps (Products page → **Import Excel workbook**)

1. Choose **Products catalogue** → upload file → **Preview import** → fix any row errors → **Confirm import**.
2. Choose **Opening stock** → same file → preview → confirm (does not change prices; only adds stock with audit movements).

Each confirm uses a one-time idempotency id. Re-clicking confirm on the same session will not double-apply opening stock.

## Column hints (PRODUCTS)

| Column | Required |
|--------|----------|
| Product name | Yes |
| Selling price | Yes (≥ 0) |
| Product SKU | Recommended for clothing styles |
| Variant SKU | Required per size/colour line |
| Size / Color | For variants |
| Barcode | Optional (unique per item) |
| Category | Optional (created if missing) |

## Permissions

- Products import: `products.create`
- Opening stock: `inventory.edit`
