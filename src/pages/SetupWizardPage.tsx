import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TenantBrandMark } from '@/components/shared/TenantBrandMark';
import { Pulse } from '@/components/shared/Pulse';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function SetupWizardPage() {
  const navigate = useNavigate();
  const [businessName, setBusinessName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerFirstName, setOwnerFirstName] = useState('');
  const [ownerLastName, setOwnerLastName] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (ownerPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.post('/setup/complete', {
        businessName,
        ownerEmail,
        ownerFirstName,
        ownerLastName,
        ownerPassword,
        currency: 'KES',
      });
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg animate-slide-up">
        <div className="mb-8 text-center">
          <TenantBrandMark variant="login" />
          <h1 className="text-3xl font-bold tracking-tight">First-time setup</h1>
          <p className="mt-2 text-muted-foreground">Create your shop and owner account. No demo data.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Your business</CardTitle>
            <CardDescription>Choose a strong password — nothing is pre-filled.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-sm bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              )}
              <div className="space-y-2">
                <Label htmlFor="businessName">Business name</Label>
                <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Owner first name</Label>
                  <Input id="firstName" value={ownerFirstName} onChange={(e) => setOwnerFirstName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Owner last name</Label>
                  <Input id="lastName" value={ownerLastName} onChange={(e) => setOwnerLastName(e.target.value)} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Owner email (login)</Label>
                <Input id="email" type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password (min 10 characters)</Label>
                <Input id="password" type="password" value={ownerPassword} onChange={(e) => setOwnerPassword(e.target.value)} required minLength={10} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm password</Label>
                <Input id="confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={10} />
              </div>
              <Button type="submit" className="w-full min-h-11" disabled={loading}>
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Pulse /> Creating…
                  </span>
                ) : (
                  'Complete setup'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
