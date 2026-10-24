/** Maps server validation messages to short fix guidance for the import dialog. */
export function shopImportFixHint(message: string, kind: 'products' | 'opening-stock'): string {
  const m = message.toLowerCase();

  if (m.includes('product name is required')) {
    return 'Enter a name in the Product name column.';
  }
  if (m.includes('selling price must be a number')) {
    return 'Enter a numeric selling price (no text). Required for every product row.';
  }
  if (m.includes('selling price cannot be negative')) {
    return 'Use zero or a positive selling price.';
  }
  if (m.includes('cost price must be a number')) {
    return 'Clear the cell or enter a number for cost price.';
  }
  if (m.includes('cost price cannot be negative')) {
    return 'Use zero or a positive cost price.';
  }
  if (m.includes('min stock must be a number') || m.includes('min stock cannot be negative')) {
    return 'Clear Min stock or enter a whole number ≥ 0.';
  }
  if (m.includes('duplicate variant sku in file')) {
    return 'Give each variant a unique Variant SKU, or remove the duplicate row.';
  }
  if (m.includes('duplicate product sku in file')) {
    return 'Use one row per product when Variant SKU is blank, or add distinct Variant SKUs.';
  }
  if (m.includes('duplicate barcode in file')) {
    return 'Use each barcode once in the file, or leave Barcode empty.';
  }
  if (m.includes('barcode already exists in catalogue')) {
    return 'Change the barcode, clear it, or switch import mode to “Create and update” if this is the same item.';
  }
  if (m.includes('variant sku already belongs to a different product')) {
    return 'Match Product SKU to the product that already owns this Variant SKU in Gorovian.';
  }
  if (kind === 'opening-stock') {
    if (m.includes('variant sku, product sku, or product name is required')) {
      return 'Fill Variant SKU (preferred), or Product SKU / product name from your catalogue.';
    }
    if (m.includes('quantity must be greater than zero')) {
      return 'Enter a whole number greater than 0 in Quantity.';
    }
    if (m.includes('quantity must be a positive whole number')) {
      return 'Enter a whole number greater than 0 (no decimals or text).';
    }
    if (m.includes('no matching product/variant')) {
      return 'Import the PRODUCTS sheet first, or fix the SKU to match an existing variant.';
    }
    if (m.includes('importing again will add the quantities twice')) {
      return 'Skip this row if stock was already imported, or adjust quantity to only the extra units you need.';
    }
  }

  if (m.includes('already in catalogue')) {
    return 'Expected in create-only mode. Switch to “Create and update” to refresh prices, or remove the row.';
  }

  return 'Correct the cell values on this row and preview again.';
}

export function downloadImportErrorCsv(
  filename: string,
  errors: Array<{ rowNumber: number; message: string }>,
  kind: 'products' | 'opening-stock'
) {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [
    'Row,Problem,How to fix',
    ...errors.map((e) =>
      [e.rowNumber, escape(e.message), escape(shopImportFixHint(e.message, kind))].join(',')
    ),
  ];
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/\.xlsx$/i, '') || 'shop-import'}-errors.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
