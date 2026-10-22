import * as React from 'react';
import { cn } from '@/lib/utils';

const Badge = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }>(
  ({ className, variant = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-primary/10 text-primary',
      success: 'bg-success/10 text-success',
      warning: 'bg-warning/10 text-warning',
      destructive: 'bg-destructive/10 text-destructive',
      secondary: 'bg-secondary text-secondary-foreground',
    };
    return (
      <div ref={ref} className={cn('inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium', variants[variant], className)} {...props} />
    );
  }
);
Badge.displayName = 'Badge';
export { Badge };
