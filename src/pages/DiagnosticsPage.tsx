import { useQuery } from '@tanstack/react-query';
import { Activity, Database, Printer, ScanLine } from 'lucide-react';
import { api } from '@/lib/api';
import { PageContainer } from '@/components/shared/PageContainer';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Pulse } from '@/components/shared/Pulse';
import { ListSkeleton } from '@/components/shared/ListSkeleton';
import { formatDateTime } from '@/lib/utils';

interface DiagnosticsPayload {
  version: string;
  platform: string;
  dbSizeBytes: number;
  dbPath?: string;
  integrityOk: boolean;
  lastBackupAt?: string | null;
  lastBackupStatus?: string | null;
  backupCount: number;
  desktop: boolean;
}

export default function DiagnosticsPage() {
  const { data, isLoading, isError } = useQuery<DiagnosticsPayload>({
    queryKey: ['system-diagnostics'],
    queryFn: async () => {
      const server = await api.get<Omit<DiagnosticsPayload, 'version' | 'platform'>>('/system/diagnostics');
      let version = import.meta.env.VITE_APP_VERSION ?? 'web';
      let platform = 'browser';
      if (window.electronAPI) {
        version = await window.electronAPI.getVersion();
        platform = await window.electronAPI.getPlatform();
      }
      return { ...server, version, platform };
    },
  });

  return (
    <PageContainer className="p-6 space-y-6">
      <PageHeader title="Diagnostics" description="Local system health for this till" icon={Activity} />
      {isLoading && (
        <>
          <Pulse className="text-primary" label="Loading diagnostics" />
          <ListSkeleton rows={4} />
        </>
      )}
      {isError && <p className="text-destructive text-sm">Could not load diagnostics.</p>}
      {data && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Database className="h-4 w-4" /> Database</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>Size: {(data.dbSizeBytes / (1024 * 1024)).toFixed(2)} MB</p>
              <p>Integrity: {data.integrityOk ? 'OK' : 'Check failed'}</p>
              {data.dbPath && <p className="text-muted-foreground break-all">{data.dbPath}</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Backups</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>Stored copies: {data.backupCount}</p>
              <p>Last backup: {data.lastBackupAt ? formatDateTime(data.lastBackupAt) : 'None yet'}</p>
              <p>Status: {data.lastBackupStatus ?? '—'}</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Printer className="h-4 w-4" /> Printer</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Use Pay → receipt print, or Shift → Z-report. Configure default printer in Windows.
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-2"><ScanLine className="h-4 w-4" /> Scanner</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              USB barcode scanners act as keyboards — focus the POS search field (F2) and scan.
            </CardContent>
          </Card>
          <Card className="md:col-span-2">
            <CardHeader><CardTitle className="text-sm">Application</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>Version: {data.version}</p>
              <p>Platform: {data.platform}</p>
              <p>Mode: {data.desktop ? 'Desktop (local-first)' : 'Browser + API'}</p>
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
