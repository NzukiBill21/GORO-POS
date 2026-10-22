import { cn } from '@/lib/utils';

const STEPS = [
  { id: 'receipt_summary', label: 'Confirm' },
  { id: 'receipt_print', label: 'Print' },
] as const;

type ReceiptPhase = (typeof STEPS)[number]['id'];

interface Props {
  phase: ReceiptPhase;
}

export function PosReceiptStepBar({ phase }: Props) {
  const activeIndex = STEPS.findIndex((s) => s.id === phase);

  return (
    <ol className="flex items-center gap-2" aria-label="Receipt steps">
      {STEPS.map((step, index) => {
        const done = index < activeIndex;
        const active = step.id === phase;
        return (
          <li key={step.id} className="flex flex-1 items-center gap-2 min-w-0">
            <div
              className={cn(
                'flex flex-1 flex-col items-center gap-1 rounded-md px-1 py-2 text-center min-w-0',
                active && 'bg-primary/10 ring-1 ring-primary/30',
                done && !active && 'opacity-70',
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                  done && !active && 'bg-primary/20 text-primary',
                )}
                aria-hidden
              >
                {done && !active ? '✓' : index + 1}
              </span>
              <span
                className={cn(
                  'text-[10px] font-medium leading-tight truncate w-full',
                  active ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <span className="text-muted-foreground/40 text-xs shrink-0" aria-hidden>
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
