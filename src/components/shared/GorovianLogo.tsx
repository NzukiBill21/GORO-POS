import { cn } from '@/lib/utils';

/** Platform owner / GOROVIAN admin only — do not use on tenant login or store UI. */
const LOGO_SRC = '/gorovian-logo.png';

interface GorovianLogoProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  alt?: string;
}

const sizeClass: Record<NonNullable<GorovianLogoProps['size']>, string> = {
  sm: 'h-9 w-9',
  md: 'h-16 w-16',
  lg: 'h-20 w-20',
};

export function GorovianLogo({ size = 'md', className, alt = 'GOROVIAN' }: GorovianLogoProps) {
  return (
    <img
      src={LOGO_SRC}
      alt={alt}
      className={cn('object-contain', sizeClass[size], className)}
      draggable={false}
    />
  );
}
