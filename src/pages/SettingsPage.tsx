import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Building2,
  Receipt,
  Palette,
  Percent,
  Plus,
  Save,
  Sun,
  Moon,
  Monitor,
  LayoutTemplate,
  Shield,
  Wallet,
  Package,
} from 'lucide-react';
import { SecurityPanel } from '@/components/settings/SecurityPanel';
import { PosPaymentsSettings } from '@/components/settings/PosPaymentsSettings';
import { DesktopPrinterSettings } from '@/components/settings/DesktopPrinterSettings';
import { api } from '@/lib/api';
import { toastSuccess } from '@/lib/toast';
import { usePermissions } from '@/hooks/usePermissions';
import { useThemeStore } from '@/stores/themeStore';
import { PageHeader } from '@/components/shared/PageHeader';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { PageContainer } from '@/components/shared/PageContainer';
import { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY } from '@/lib/currencies';
import { useBusinessStore } from '@/stores/businessStore';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Business {
  id: string;
  name: string;
  legalName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  taxId?: string;
  currency: string;
  timezone: string;
}

interface Tax {
  id: string;
  name: string;
  rate: number;
  isInclusive: boolean;
  isDefault: boolean;
}

interface SettingsData {
  business: Business | null;
  settings: Record<string, string>;
  taxes: Tax[];
  branches: Array<{ id: string; name: string }>;
}

const RECEIPT_KEYS = [
  { key: 'receipt_footer', label: 'Receipt message', placeholder: 'Thank you for shopping with us!' },
  { key: 'receipt_terms', label: 'Terms text', placeholder: 'Payment due at point of sale…' },
  { key: 'receipt_show_logo', label: 'Show Logo (true/false)', placeholder: 'true' },
  { key: 'receipt_logo_url', label: 'Logo path', placeholder: '/branding/receipt-logo.png' },
  { key: 'receipt_paper_width', label: 'Paper Width (mm)', placeholder: '80' },
  { key: 'receipt_bank_name', label: 'Bank name (footer)', placeholder: 'Kenya Commercial Bank' },
  { key: 'receipt_bank_account', label: 'Bank account (footer)', placeholder: 'Account number' },
  { key: 'receipt_bank_routing', label: 'Bank branch / paybill', placeholder: 'Branch or paybill code' },
];

type Tab = 'business' | 'taxes' | 'receipt' | 'inventory' | 'appearance' | 'security' | 'payments';

export default function SettingsPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useThemeStore();
  const setCurrency = useBusinessStore((s) => s.setCurrency);

  const canView = can('settings.view');
  const canEdit = can('settings.edit');

  const [tab, setTab] = useState<Tab>('business');
  const [businessForm, setBusinessForm] = useState<Partial<Business>>({});
  const [receiptSettings, setReceiptSettings] = useState<Record<string, string>>({});
  const [businessError, setBusinessError] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [taxDialogOpen, setTaxDialogOpen] = useState(false);
  const [taxForm, setTaxForm] = useState({ name: '', rate: '', isInclusive: false, isDefault: false });
  const [taxError, setTaxError] = useState('');
  const [allowNegativeStock, setAllowNegativeStock] = useState(false);
  const [inventoryError, setInventoryError] = useState('');

  const { data, isLoading, error, refetch } = useQuery<SettingsData>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings'),
    enabled: canView,
  });

  useEffect(() => {
    if (data?.business) {
      setBusinessForm(data.business);
    }
    if (data?.settings) {
      const receipt: Record<string, string> = {};
      RECEIPT_KEYS.forEach(({ key }) => {
        receipt[key] = data.settings[key] ?? '';
      });
      setReceiptSettings(receipt);
      setAllowNegativeStock(data.settings['inventory.allowNegativeStock'] === 'true');
    }
  }, [data]);

  const updateBusinessMutation = useMutation({
    mutationFn: (payload: Partial<Business>) => api.put('/settings/business', payload),
    onSuccess: (_data, payload) => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      if (payload.currency) {
        setCurrency(payload.currency);
      }
      setBusinessError('');
      toastSuccess('Business settings saved');
    },
    onError: (err: Error) => setBusinessError(err.message),
  });

  const saveSettingMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.post('/settings/setting', { key, value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setReceiptError('');
    },
    onError: (err: Error) => setReceiptError(err.message),
  });

  const createTaxMutation = useMutation({
    mutationFn: (payload: { name: string; rate: number; isInclusive?: boolean; isDefault?: boolean }) =>
      api.post('/settings/taxes', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      setTaxDialogOpen(false);
      setTaxForm({ name: '', rate: '', isInclusive: false, isDefault: false });
      setTaxError('');
      toastSuccess('Tax rate added');
    },
    onError: (err: Error) => setTaxError(err.message),
  });

  const handleSaveBusiness = () => {
    if (!businessForm.name?.trim()) {
      setBusinessError('Business name is required.');
      return;
    }
    updateBusinessMutation.mutate(businessForm);
  };

  const handleSaveReceipt = async () => {
    setReceiptError('');
    try {
      await Promise.all(
        Object.entries(receiptSettings).map(([key, value]) =>
          saveSettingMutation.mutateAsync({ key, value })
        )
      );
      toastSuccess('Receipt settings saved');
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const handleCreateTax = () => {
    const rate = parseFloat(taxForm.rate);
    if (!taxForm.name.trim()) {
      setTaxError('Tax name is required.');
      return;
    }
    if (isNaN(rate) || rate < 0) {
      setTaxError('Enter a valid tax rate.');
      return;
    }
    createTaxMutation.mutate({
      name: taxForm.name.trim(),
      rate,
      isInclusive: taxForm.isInclusive,
      isDefault: taxForm.isDefault,
    });
  };

  const tabs: { id: Tab; label: string; icon: typeof Settings }[] = [
    { id: 'business', label: 'Business Info', icon: Building2 },
    { id: 'taxes', label: 'Taxes', icon: Percent },
    { id: 'receipt', label: 'Receipt', icon: Receipt },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'appearance', label: 'Appearance', icon: Palette },
    ...(canEdit || can('settings.manage')
      ? [{ id: 'payments' as Tab, label: 'Payments', icon: Wallet }]
      : []),
    ...(can('security.view') ? [{ id: 'security' as Tab, label: 'Security', icon: Shield }] : []),
  ];

  const themeOptions = [
    {
      value: 'default' as const,
      label: 'Default',
      description: 'Standard Goro POS',
      icon: LayoutTemplate,
      preview: 'bg-[hsl(210,16%,93%)] border-border',
    },
    {
      value: 'light' as const,
      label: 'Light',
      description: 'Bright blue accent',
      icon: Sun,
      preview: 'bg-[hsl(220,14%,96%)] border-blue-200',
    },
    {
      value: 'dark' as const,
      label: 'Dark',
      description: 'Low light',
      icon: Moon,
      preview: 'bg-[hsl(224,71%,8%)] border-slate-600',
    },
    {
      value: 'system' as const,
      label: 'System',
      description: 'Match device',
      icon: Monitor,
      preview: 'bg-gradient-to-br from-[hsl(220,14%,96%)] to-[hsl(224,71%,8%)] border-border',
    },
  ];

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Settings}
          title="Access Denied"
          description="You don't have permission to view settings."
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Settings}
          title="Failed to load settings"
          description={error.message}
          action={{ label: 'Try Again', onClick: () => refetch() }}
        />
      </div>
    );
  }

  return (
    <PageContainer className="p-6 animate-fade-in pb-12">
      <PageHeader
        title="Settings"
        description="Configure business info, taxes, receipts, and appearance."
        icon={Settings}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        {tabs.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            variant={tab === id ? 'default' : 'outline'}
            onClick={() => setTab(id)}
          >
            <Icon className="h-4 w-4 mr-2" />
            {label}
          </Button>
        ))}
      </div>

      {tab === 'business' && (
        <Card>
          <CardHeader>
            <CardTitle>Business Information</CardTitle>
            <CardDescription>Update your store details and contact information.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 max-w-2xl">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label htmlFor="name">Business Name *</Label>
                <Input
                  id="name"
                  value={businessForm.name ?? ''}
                  onChange={(e) => setBusinessForm({ ...businessForm, name: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2 col-span-2 sm:col-span-1">
                <Label htmlFor="legalName">Legal Name</Label>
                <Input
                  id="legalName"
                  value={businessForm.legalName ?? ''}
                  onChange={(e) => setBusinessForm({ ...businessForm, legalName: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={businessForm.email ?? ''}
                  onChange={(e) => setBusinessForm({ ...businessForm, email: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  value={businessForm.phone ?? ''}
                  onChange={(e) => setBusinessForm({ ...businessForm, phone: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                value={businessForm.address ?? ''}
                onChange={(e) => setBusinessForm({ ...businessForm, address: e.target.value })}
                disabled={!canEdit}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  value={businessForm.city ?? ''}
                  onChange={(e) => setBusinessForm({ ...businessForm, city: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country</Label>
                <Input
                  id="country"
                  value={businessForm.country ?? ''}
                  onChange={(e) => setBusinessForm({ ...businessForm, country: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="taxId">Tax ID</Label>
                <Input
                  id="taxId"
                  value={businessForm.taxId ?? ''}
                  onChange={(e) => setBusinessForm({ ...businessForm, taxId: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency</Label>
                <Select
                  value={businessForm.currency ?? DEFAULT_CURRENCY}
                  onValueChange={(v) => setBusinessForm({ ...businessForm, currency: v })}
                  disabled={!canEdit}
                >
                  <SelectTrigger id="currency">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Applies to prices, reports, and receipts for your entire business.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  value={businessForm.timezone ?? 'UTC'}
                  onChange={(e) => setBusinessForm({ ...businessForm, timezone: e.target.value })}
                  disabled={!canEdit}
                />
              </div>
            </div>

            {businessError && <p className="text-sm text-destructive">{businessError}</p>}

            {canEdit && (
              <Button onClick={handleSaveBusiness} disabled={updateBusinessMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                {updateBusinessMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'taxes' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Tax Management</CardTitle>
              <CardDescription>Configure tax rates for your products.</CardDescription>
            </div>
            {canEdit && (
              <Button onClick={() => setTaxDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Tax
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {data?.taxes.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No taxes configured yet.</p>
            ) : (
              <div className="space-y-3">
                {data?.taxes.map((tax) => (
                  <div
                    key={tax.id}
                    className="flex items-center justify-between rounded-lg border p-4"
                  >
                    <div>
                      <p className="font-medium">{tax.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {tax.rate}% {tax.isInclusive ? '(inclusive)' : '(exclusive)'}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {tax.isDefault && <Badge variant="default">Default</Badge>}
                      <Badge variant="success">Active</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'receipt' && (
        <div className="space-y-6 max-w-2xl">
        <DesktopPrinterSettings />
        <Card>
          <CardHeader>
            <CardTitle>Receipt Settings</CardTitle>
            <CardDescription>
              Applies to every cashier and manager in this store — saved to the business, not your user account.
              Reprint or new sales pick up changes immediately.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {RECEIPT_KEYS.map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-2">
                <Label htmlFor={key}>{label}</Label>
                <Input
                  id={key}
                  value={receiptSettings[key] ?? ''}
                  placeholder={placeholder}
                  onChange={(e) =>
                    setReceiptSettings({ ...receiptSettings, [key]: e.target.value })
                  }
                  disabled={!canEdit}
                />
              </div>
            ))}

            {receiptError && <p className="text-sm text-destructive">{receiptError}</p>}

            {canEdit && (
              <Button
                onClick={handleSaveReceipt}
                disabled={saveSettingMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                {saveSettingMutation.isPending ? 'Saving...' : 'Save Receipt Settings'}
              </Button>
            )}
          </CardContent>
        </Card>
        </div>
      )}

      {tab === 'inventory' && (
        <Card>
          <CardHeader>
            <CardTitle>Inventory policy</CardTitle>
            <CardDescription>Control stock enforcement at POS checkout.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 max-w-2xl">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <p className="font-medium">Allow negative stock</p>
                <p className="text-sm text-muted-foreground">
                  When off (recommended), checkout blocks sales when quantity exceeds on-hand stock.
                </p>
              </div>
              <input
                type="checkbox"
                className="h-5 w-5 rounded border"
                checked={allowNegativeStock}
                onChange={(e) => setAllowNegativeStock(e.target.checked)}
                disabled={!canEdit}
              />
            </div>
            {inventoryError && <p className="text-sm text-destructive">{inventoryError}</p>}
            {canEdit && (
              <Button
                onClick={async () => {
                  setInventoryError('');
                  try {
                    await saveSettingMutation.mutateAsync({
                      key: 'inventory.allowNegativeStock',
                      value: allowNegativeStock ? 'true' : 'false',
                    });
                    toastSuccess('Inventory settings saved');
                  } catch (err) {
                    setInventoryError(err instanceof Error ? err.message : 'Failed to save');
                  }
                }}
                disabled={saveSettingMutation.isPending}
              >
                <Save className="h-4 w-4 mr-2" />
                Save inventory settings
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'appearance' && (
        <Card>
          <CardHeader>
            <CardTitle>Theme</CardTitle>
            <CardDescription>
              Default is the standard store UI. Light, Dark, and System are optional overrides.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 max-w-2xl sm:grid-cols-4">
              {themeOptions.map(({ value, label, description, icon: Icon, preview }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={cn(
                    'flex flex-col items-stretch gap-3 rounded-md border p-3 text-left transition-colors hover:bg-accent/50',
                    theme === value && 'border-primary bg-primary/5 ring-2 ring-primary/25'
                  )}
                >
                  <div
                    className={cn(
                      'flex h-14 w-full items-center justify-center rounded-sm border',
                      preview
                    )}
                  >
                    <Icon
                      className={cn(
                        'h-6 w-6',
                        value === 'dark' ? 'text-white' : 'text-foreground/80'
                      )}
                    />
                  </div>
                  <div>
                    <span className="text-sm font-semibold block">{label}</span>
                    <span className="text-xs text-muted-foreground">{description}</span>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'payments' && <PosPaymentsSettings canEdit={canEdit || can('settings.manage')} />}

      {tab === 'security' && <SecurityPanel />}

      <Dialog open={taxDialogOpen} onOpenChange={setTaxDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Tax Rate</DialogTitle>
            <DialogDescription>Create a new tax rate for your business.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="taxName">Name</Label>
              <Input
                id="taxName"
                value={taxForm.name}
                onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })}
                placeholder="Sales Tax"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxRate">Rate (%)</Label>
              <Input
                id="taxRate"
                type="number"
                min="0"
                step="0.01"
                value={taxForm.rate}
                onChange={(e) => setTaxForm({ ...taxForm, rate: e.target.value })}
                placeholder="8.25"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={taxForm.isInclusive}
                  onChange={(e) => setTaxForm({ ...taxForm, isInclusive: e.target.checked })}
                  className="rounded"
                />
                Tax inclusive
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={taxForm.isDefault}
                  onChange={(e) => setTaxForm({ ...taxForm, isDefault: e.target.checked })}
                  className="rounded"
                />
                Set as default
              </label>
            </div>
            {taxError && <p className="text-sm text-destructive">{taxError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTaxDialogOpen(false)} disabled={createTaxMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={handleCreateTax} disabled={createTaxMutation.isPending}>
              {createTaxMutation.isPending ? 'Creating...' : 'Create Tax'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
