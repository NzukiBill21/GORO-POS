import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface ListSkeletonProps {
  rows?: number;
  rowClassName?: string;
  className?: string;
}

export function ListSkeleton({ rows = 5, rowClassName, className }: ListSkeletonProps) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className={cn('h-12 w-full rounded-sm', rowClassName)} />
      ))}
    </div>
  );
}
