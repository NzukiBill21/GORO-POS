import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { TenantBrandMark } from '@/components/shared/TenantBrandMark';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const isDev = import.meta.env.DEV;

const DEMO_ACCOUNTS = [
  { email: 'admin@demostore.com', role: 'Demo owner', password: 'DemostoreAdmin1!' },
  { email: 'manager@demostore.com', role: 'Manager', password: 'DemostoreAdmin1!' },
  { email: 'supervisor@demostore.com', role: 'Supervisor', password: 'DemostoreAdmin1!' },
  { email: 'cashier@demostore.com', role: 'Cashier', password: 'DemostoreAdmin1!' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const locationState = location.state as { resetSuccess?: boolean; message?: string } | null;
  const resetSuccess = locationState?.resetSuccess;
  const successMessage = locationState?.message;
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  useEffect(() => {
    void api.get<{ publicRegistrationEnabled: boolean }>('/onboarding/status').then((s) => {
      setRegistrationEnabled(s.publicRegistrationEnabled);
    }).catch(() => setRegistrationEnabled(false));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const status = await api.get<{ needsSetup: boolean; desktopMode: boolean }>('/setup/status');
        if (status.needsSetup && status.desktopMode) {
          navigate('/setup', { replace: true });
        }
      } catch {
        /* web dev without setup route errors is fine */
      }
    })();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (account: (typeof DEMO_ACCOUNTS)[0]) => {
    setEmail(account.email);
    setPassword(account.password);
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md animate-slide-up">
        <div className="mb-8 text-center">
          <TenantBrandMark variant="login" />
          <p className="mt-2 text-muted-foreground">Sign in to your store</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome back</CardTitle>
            <CardDescription>Enter your credentials to access the system</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {resetSuccess && (
                <div className="rounded-lg bg-primary/10 p-3 text-sm text-foreground">
                  {successMessage ?? 'Password updated. Sign in with your new password.'}
                </div>
              )}
              {error && (
                <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-medium">Email</label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@yourshop.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-medium">Password</label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>

            {isDev && (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <p className="text-center text-xs text-muted-foreground">Development: quick demo logins</p>
                <div className="grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((account) => (
                    <Button
                      key={account.email}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs h-auto py-2"
                      onClick={() => fillDemo(account)}
                    >
                      {account.role}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {registrationEnabled && (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                New shop owner?{' '}
                <Link to="/register" className="text-primary hover:underline">Register your business</Link>
              </p>
            )}
            {isDev && (
              <p className="mt-2 text-center text-sm text-muted-foreground">
                <a href="/platform/login" className="underline hover:text-foreground">GOROVIAN platform admin</a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
