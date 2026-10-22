import { cn } from '@/lib/utils';

interface PulseProps {
  className?: string;
  label?: string;
}

/** Three-dot loading indicator (transform/opacity only; respects reduced motion). */
export function Pulse({ className, label = 'Loading' }: PulseProps) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} role="status" aria-label={label}>
      <span className="dots inline-flex items-center" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </span>
  );
}
