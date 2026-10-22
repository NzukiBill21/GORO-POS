import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TenantBrandMark } from '@/components/shared/TenantBrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

type Step = 'details' | 'verify';

export default function RegisterBusinessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState<Step>('details');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState(searchParams.get('email') ?? '');
  const [ownerFirstName, setOwnerFirstName] = useState('');
  const [ownerLastName, setOwnerLastName] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [token] = useState(searchParams.get('token') ?? undefined);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void api.get<{ publicRegistrationEnabled: boolean }>('/onboarding/status').then((s) => {
      setEnabled(s.publicRegistrationEnabled);
    }).catch(() => setEnabled(false));
  }, []);

  const startRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ message: string; email: string; devCode?: string }>('/onboarding/register/start', {
        businessName,
        ownerEmail,
        ownerFirstName,
        ownerLastName,
      });
      setInfo(res.message);
      if (res.devCode) setInfo(`${res.message} Dev code: ${res.devCode}`);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start registration');
    } finally {
      setLoading(false);
    }
  };

  const completeRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await api.post('/onboarding/register/complete', {
        email: ownerEmail,
        code,
        password,
        token,
      });
      navigate('/login', { state: { resetSuccess: true, message: 'Shop created. Sign in with your new password.' } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  if (enabled === null) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>;
  }

  if (!enabled) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>Registration unavailable</CardTitle>
            <CardDescription>Public signup is disabled on this server. Contact GOROVIAN support or use an invitation link.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full"><Link to="/login">Back to sign in</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <TenantBrandMark variant="login" />
          <h1 className="text-2xl font-bold">Register your business</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Step {step === 'details' ? '1' : '2'} of 2 — email verification required. No payment is taken here.
          </p>
        </div>

        <Card>
          {step === 'details' ? (
            <form onSubmit={startRegistration}>
              <CardHeader>
                <CardTitle>Your shop details</CardTitle>
                <CardDescription>You will become the owner (manager) of this shop only.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="space-y-2">
                  <Label>Business name</Label>
                  <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Your first name</Label>
                    <Input value={ownerFirstName} onChange={(e) => setOwnerFirstName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label>Your last name</Label>
                    <Input value={ownerLastName} onChange={(e) => setOwnerLastName(e.target.value)} required />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Your email (login)</Label>
                  <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>Send verification code</Button>
              </CardContent>
            </form>
          ) : (
            <form onSubmit={completeRegistration}>
              <CardHeader>
                <CardTitle>Verify email & set password</CardTitle>
                <CardDescription>{info || 'Enter the 6-digit code from your email.'}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="space-y-2">
                  <Label>Verification code</Label>
                  <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
                </div>
                <div className="space-y-2">
                  <Label>Password</Label>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
                </div>
                <div className="space-y-2">
                  <Label>Confirm password</Label>
                  <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>Create my shop</Button>
                <Button type="button" variant="ghost" className="w-full" onClick={() => setStep('details')}>Back</Button>
              </CardContent>
            </form>
          )}
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account? <Link to="/login" className="underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
