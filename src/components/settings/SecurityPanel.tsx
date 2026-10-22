import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Key, History, AlertTriangle, Database, Users, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { usePermissions } from '@/hooks/usePermissions';
import { DataTable, Column } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';

type SecurityTab = 'audit' | 'logins' | 'sessions' | 'events' | 'backups' | 'password';

export function SecurityPanel() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SecurityTab>('audit');
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });
  const [passwordError, setPasswordError] = useState('');

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ['security-audit'],
    queryFn: () => api.get<{ data: Array<Record<string, unknown>>; pagination: { page: number; totalPages: number; total: number } }>('/security/audit-logs?limit=50'),
    enabled: can('security.view') && tab === 'audit',
  });

  const { data: loginData, isLoading: loginLoading } = useQuery({
    queryKey: ['security-logins'],
    queryFn: () => api.get<{ data: Array<{ id: string; email: string; success: boolean; ipAddress?: string; createdAt: string; reason?: string }> }>('/security/login-history?limit=50'),
    enabled: can('security.view') && tab === 'logins',
  });

  const { data: sessions } = useQuery({
    queryKey: ['security-sessions'],
    queryFn: () => api.get<Array<{ id: string; device?: string; ipAddress?: string; lastActivityAt: string; user: { firstName: string; lastName: string; email: string } }>>('/auth/sessions'),
    enabled: can('security.view') && tab === 'sessions',
  });

  const { data: events } = useQuery({
    queryKey: ['security-events'],
    queryFn: () => api.get<{ data: Array<{ id: string; type: string; severity: string; message: string; createdAt: string }> }>('/security/events?limit=50'),
    enabled: can('security.view') && tab === 'events',
  });

  const { data: backups } = useQuery({
    queryKey: ['security-backups'],
    queryFn: () => api.get<Array<{ id: string; filename: string; type: string; size: number; createdAt: string }>>('/security/backups'),
    enabled: can('security.view') && tab === 'backups',
  });

  const backupMutation = useMutation({
    mutationFn: () => api.post('/security/backups'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['security-backups'] }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post(`/security/backups/${id}/restore`),
    onSuccess: () => { setRestoreId(null); alert('Database restored. Please restart the server.'); },
  });

  const terminateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/auth/sessions/${id}/terminate`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['security-sessions'] }),
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: passwordForm.current, newPassword: passwordForm.newPass }),
    onSuccess: () => { setPasswordForm({ current: '', newPass: '', confirm: '' }); setPasswordError(''); alert('Password changed. Please log in again.'); },
    onError: (e: Error) => setPasswordError(e.message),
  });

  if (!can('security.view')) {
    return <p className="text-muted-foreground text-sm">You do not have permission to view security settings.</p>;
  }

  const tabs: { id: SecurityTab; label: string; icon: typeof Shield }[] = [
    { id: 'audit', label: 'Audit Logs', icon: History },
    { id: 'logins', label: 'Login History', icon: Key },
    { id: 'sessions', label: 'Sessions', icon: Users },
    { id: 'events', label: 'Security Events', icon: AlertTriangle },
    { id: 'backups', label: 'Backups', icon: Database },
    { id: 'password', label: 'Password', icon: Shield },
  ];

  const auditColumns: Column<Record<string, unknown>>[] = [
    { key: 'createdAt', label: 'Time', render: (r) => formatDateTime(String(r.createdAt)) },
    { key: 'action', label: 'Action', render: (r) => <Badge variant="secondary">{String(r.action)}</Badge> },
    { key: 'module', label: 'Module' },
    { key: 'details', label: 'Details', className: 'max-w-xs truncate' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Button key={t.id} variant={tab === t.id ? 'default' : 'outline'} size="sm" onClick={() => setTab(t.id)} className="gap-1.5">
            <t.icon className="h-3.5 w-3.5" />{t.label}
          </Button>
        ))}
      </div>

      {tab === 'audit' && (
        <DataTable columns={auditColumns} data={auditData?.data ?? []} loading={auditLoading} rowKey={(r) => String(r.id)} emptyTitle="No audit logs" />
      )}

      {tab === 'logins' && (
        <DataTable
          columns={[
            { key: 'createdAt', label: 'Time', render: (r) => formatDateTime(r.createdAt) },
            { key: 'email', label: 'Email' },
            { key: 'success', label: 'Status', render: (r) => <Badge variant={r.success ? 'success' : 'destructive'}>{r.success ? 'Success' : 'Failed'}</Badge> },
            { key: 'ipAddress', label: 'IP' },
            { key: 'reason', label: 'Reason' },
          ]}
          data={loginData?.data ?? []}
          loading={loginLoading}
          rowKey={(r) => r.id}
          emptyTitle="No login history"
        />
      )}

      {tab === 'sessions' && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {(sessions ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium text-sm">{s.user.firstName} {s.user.lastName}</p>
                  <p className="text-xs text-muted-foreground">{s.user.email} · {s.device || 'desktop'} · {s.ipAddress}</p>
                  <p className="text-xs text-muted-foreground">Last active: {formatDateTime(s.lastActivityAt)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => terminateMutation.mutate(s.id)}>
                  <LogOut className="h-3.5 w-3.5 mr-1" />Terminate
                </Button>
              </div>
            ))}
            {!sessions?.length && <p className="text-center text-muted-foreground py-8">No active sessions</p>}
          </CardContent>
        </Card>
      )}

      {tab === 'events' && (
        <DataTable
          columns={[
            { key: 'createdAt', label: 'Time', render: (r) => formatDateTime(r.createdAt) },
            { key: 'type', label: 'Type', render: (r) => <Badge variant={r.severity === 'CRITICAL' ? 'destructive' : 'warning'}>{r.type}</Badge> },
            { key: 'message', label: 'Message' },
          ]}
          data={events?.data ?? []}
          rowKey={(r) => r.id}
          emptyTitle="No security events"
        />
      )}

      {tab === 'backups' && (
        <div className="space-y-4">
          {can('settings.edit') && (
            <Button onClick={() => backupMutation.mutate()} disabled={backupMutation.isPending}>
              <Database className="h-4 w-4 mr-2" />Create Manual Backup
            </Button>
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">Backup History</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(backups ?? []).map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{b.filename}</p>
                    <p className="text-xs text-muted-foreground">{b.type} · {(b.size / 1024).toFixed(1)} KB · {formatDateTime(b.createdAt)}</p>
                  </div>
                  {can('settings.edit') && (
                    <Button variant="outline" size="sm" onClick={() => setRestoreId(b.id)}>Restore</Button>
                  )}
                </div>
              ))}
              {!backups?.length && <p className="text-center text-muted-foreground py-8">No backups yet</p>}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === 'password' && (
        <Card className="max-w-md">
          <CardHeader><CardTitle className="text-base">Change Password</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">Min 8 chars, uppercase, lowercase, number, special character.</p>
            {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
            <div className="space-y-2"><Label>Current Password</Label><Input type="password" value={passwordForm.current} onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })} /></div>
            <div className="space-y-2"><Label>New Password</Label><Input type="password" value={passwordForm.newPass} onChange={(e) => setPasswordForm({ ...passwordForm, newPass: e.target.value })} /></div>
            <div className="space-y-2"><Label>Confirm Password</Label><Input type="password" value={passwordForm.confirm} onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })} /></div>
            <Button
              onClick={() => {
                if (passwordForm.newPass !== passwordForm.confirm) { setPasswordError('Passwords do not match'); return; }
                changePasswordMutation.mutate();
              }}
              disabled={changePasswordMutation.isPending}
            >Change Password</Button>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={!!restoreId}
        onOpenChange={() => setRestoreId(null)}
        title="Restore Backup"
        description="This will replace the current database. The server must be restarted after restore."
        confirmLabel="Restore"
        variant="destructive"
        loading={restoreMutation.isPending}
        onConfirm={() => restoreId && restoreMutation.mutate(restoreId)}
      />
    </div>
  );
}
