import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type PrinterInfo = { name: string; isDefault?: boolean };

export function DesktopPrinterSettings() {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.listPrinters) {
      setDesktop(false);
      return;
    }
    setDesktop(true);
    void (async () => {
      const list = (await api.listPrinters!()) ?? [];
      setPrinters(list);
      const saved = (await api.getDefaultReceiptPrinter?.()) ?? null;
      if (saved) setSelected(saved);
      else if (list[0]?.name) setSelected(list[0].name);
    })();
  }, []);

  if (!desktop) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Receipt printer</CardTitle>
          <CardDescription>Install and open the desktop till app to choose a Windows printer.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const save = async () => {
    await window.electronAPI?.setDefaultReceiptPrinter?.(selected || null);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Receipt printer</CardTitle>
        <CardDescription>Default thermal printer for silent receipt printing (typically 80 mm).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Printer</Label>
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger>
              <SelectValue placeholder="Select printer" />
            </SelectTrigger>
            <SelectContent>
              {printers.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                  {p.isDefault ? ' (Windows default)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" onClick={() => void save()}>
          Save default
        </Button>
      </CardContent>
    </Card>
  );
}
