import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { TenantBrandMark } from '@/components/shared/TenantBrandMark';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.get<{ emailRecoveryAvailable: boolean }>('/auth/password-reset/status');
        setAvailable(status.emailRecoveryAvailable);
        if (!status.emailRecoveryAvailable) {
          setStatusHint(
            'SMTP is not configured on the API server. Add SMTP_* to .env, restart npm run dev:web, then run npm run smtp:verify.'
          );
        }
      } catch {
        // Do not block the form — status check can fail while SMTP still works after a server restart.
        setAvailable(true);
        setStatusHint('Could not read mail status from the server. You can still try — if nothing arrives, restart the API and check SMTP in .env.');
      }
    })();
  }, []);

  const resetPasswordPath = `/reset-password?email=${encodeURIComponent(email)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const res = await api.post<{ message: string }>('/auth/password-reset/request', { email });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const goEnterCode = () => navigate(resetPasswordPath);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <TenantBrandMark variant="login" />
          <p className="mt-2 text-muted-foreground">Password recovery</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Forgot password</CardTitle>
            <CardDescription>
              Enter your work email. We will send a 6-digit code valid for 15 minutes. Enter the code on this computer
              (login → reset password).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {statusHint && (
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{statusHint}</div>
            )}
            {available === false && !statusHint && (
              <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                Email recovery is not configured on this system yet. Ask your manager or Gorovian support to reset your
                password.
              </div>
            )}

            {message ? (
              <div className="space-y-4">
                <div className="rounded-lg border-2 border-primary bg-primary/10 p-4 text-center shadow-sm">
                  <KeyRound className="mx-auto mb-2 h-8 w-8 text-primary" aria-hidden />
                  <p className="text-sm text-foreground">{message}</p>
                  <p className="mt-2 text-base font-semibold text-foreground">
                    Check your inbox, then enter the 6-digit code on the next screen.
                  </p>
                </div>
                <Button type="button" className="w-full" size="lg" onClick={goEnterCode}>
                  Enter verification code
                </Button>
                <Button type="button" variant="outline" className="w-full" onClick={() => setMessage('')}>
                  Send another code
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {error && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="email">Work email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={available === false && statusHint === null}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use the email your manager set on your staff account (Employees).
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading || (available === false && statusHint === null)}
                >
                  {loading ? 'Sending…' : 'Send reset code'}
                </Button>
              </form>
            )}

            <p className="text-center text-sm">
              <Link to="/login" className="text-primary hover:underline">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
