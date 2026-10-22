import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle } from 'lucide-react';

interface ChecklistResponse {
  isOwner: boolean;
  subscriptionStatus: string;
  steps: Array<{ id: string; label: string; done: boolean; href?: string }>;
  completedCount: number;
}

export function OwnerSetupBanner() {
  const { data } = useQuery<ChecklistResponse>({
    queryKey: ['onboarding-checklist'],
    queryFn: () => api.get('/onboarding/checklist'),
  });

  if (!data?.isOwner || data.completedCount >= data.steps.length) return null;

  const next = data.steps.find((s) => !s.done && s.href);

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="py-4 space-y-3">
        <div>
          <p className="font-medium text-sm">Welcome — finish setting up your shop</p>
          <p className="text-xs text-muted-foreground">
            Subscription: {data.subscriptionStatus} (trial does not mean payment completed)
          </p>
        </div>
        <ul className="space-y-1 text-sm">
          {data.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2">
              {step.done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
              {step.label}
            </li>
          ))}
        </ul>
        {next?.href && (
          <Button size="sm" asChild>
            <Link to={next.href}>Continue setup</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
