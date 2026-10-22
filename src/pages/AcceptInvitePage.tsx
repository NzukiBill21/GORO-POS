import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TenantBrandMark } from '@/components/shared/TenantBrandMark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState(searchParams.get('email') ?? '');
  const [token] = useState(searchParams.get('token') ?? undefined);
  const [preview, setPreview] = useState<{ businessName: string; firstName: string; inviteType: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token && email) {
      void api
        .get<{ businessName: string; firstName: string; inviteType: string }>(
          `/onboarding/invite/preview?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
        )
        .then(setPreview)
        .catch(() => setPreview(null));
    }
  }, [token, email]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const payload: { email: string; code: string; password: string; token?: string } = {
        email: email.trim().toLowerCase(),
        code: code.trim(),
        password,
      };
      const linkToken = token?.trim();
      if (linkToken) payload.token = linkToken;
      await api.post('/onboarding/invite/accept', payload);
      navigate('/login', { state: { resetSuccess: true, message: 'Password set. You can sign in now.' } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <TenantBrandMark variant="login" />
          <h1 className="text-2xl font-bold">Set up your account</h1>
        </div>
        <Card>
          <form onSubmit={submit}>
            <CardHeader>
              <CardTitle>{preview ? `Join ${preview.businessName}` : 'Accept invitation'}</CardTitle>
              <CardDescription>
                {preview
                  ? `Hello ${preview.firstName}, choose a password. This is separate from subscription payment.`
                  : 'Enter the email, code, and password from your invitation.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="space-y-2">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label>Invitation code</Label>
                <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required />
              </div>
              <div className="space-y-2">
                <Label>New password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
                <p className="text-xs text-muted-foreground">
                  At least 12 characters with uppercase, lowercase, a number, and a symbol.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Confirm password</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>Save password</Button>
            </CardContent>
          </form>
        </Card>
        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
