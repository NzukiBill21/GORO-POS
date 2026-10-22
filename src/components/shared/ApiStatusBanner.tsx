import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';

export function ApiStatusBanner() {
  const { data: healthy } = useQuery({
    queryKey: ['api-health'],
    queryFn: () => api.checkHealth(),
    refetchInterval: 15000,
    retry: false,
  });

  if (healthy !== false) return null;

  return (
    <div className="flex items-center gap-2 bg-destructive text-destructive-foreground px-4 py-2 text-sm shrink-0">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span>
        API server offline — run <code className="font-mono bg-black/20 px-1 rounded">npm run dev:web</code> (or{' '}
        <code className="font-mono bg-black/20 px-1 rounded">npm run dev:server</code> in a separate terminal), then
        refresh.
      </span>
    </div>
  );
}
