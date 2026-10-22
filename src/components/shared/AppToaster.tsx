import { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subscribeToasts, type ToastPayload } from '@/lib/toast';

export function AppToaster() {
  const [toast, setToast] = useState<ToastPayload | null>(null);

  useEffect(() => subscribeToasts(setToast), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  const isSuccess = toast.variant === 'success';

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'fixed bottom-4 right-4 z-[100] flex max-w-sm items-start gap-3 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-bottom-4',
        isSuccess
          ? 'border-primary/30 bg-background text-foreground'
          : 'border-destructive/40 bg-background text-destructive'
      )}
    >
      {isSuccess ? (
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden />
      ) : (
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      )}
      <p className="text-sm font-medium leading-snug">{toast.message}</p>
    </div>
  );
}
