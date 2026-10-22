import { cn } from '@/lib/utils';

/** Standard page wrapper — scrollable content inside fixed app shell */
export function PageContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('h-full overflow-y-auto scrollbar-thin', className)}>
      {children}
    </div>
  );
}
