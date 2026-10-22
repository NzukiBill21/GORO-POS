import { sanitizePrintHtml } from '@/lib/sanitizePrint';

declare global {
  interface Window {
    electronAPI?: {
      getVersion?: () => Promise<string>;
      getPlatform?: () => Promise<string>;
      printReceipt: (html: string | { html: string; deviceName?: string }) => Promise<boolean>;
      listPrinters?: () => Promise<Array<{ name: string; isDefault?: boolean }>>;
      getDefaultReceiptPrinter?: () => Promise<string | null>;
      setDefaultReceiptPrinter?: (deviceName: string | null) => Promise<boolean>;
      getDesktopApiSecret?: () => Promise<string | null>;
    };
  }
}

export async function printReceiptHtml(html: string): Promise<void> {
  const safeHtml = sanitizePrintHtml(html);
  if (window.electronAPI?.printReceipt) {
    await window.electronAPI.printReceipt(safeHtml);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = 'none';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    throw new Error('Could not open print frame');
  }

  doc.open();
  doc.write(safeHtml);
  doc.close();

  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();

  setTimeout(() => iframe.remove(), 1000);
}
