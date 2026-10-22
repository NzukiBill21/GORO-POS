import { useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/stores/themeStore';

const LOGIN_LOGO = '/branding/goro-logo-login.png';
const SYMBOL_LIGHT = '/branding/goro-symbol-light.png';
const SYMBOL_DARK = '/branding/goro-symbol-dark.png';

function subscribeSystemDark(cb: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

interface TenantBrandMarkProps {
  variant?: 'login' | 'sidebar';
  className?: string;
  alt?: string;
}

export function TenantBrandMark({
  variant = 'login',
  className,
  alt = 'Goro',
}: TenantBrandMarkProps) {
  const themePref = useThemeStore((s) => s.theme);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);

  const isDarkUi =
    themePref === 'dark' || (themePref === 'system' && systemDark);

  const symbolSrc = isDarkUi ? SYMBOL_LIGHT : SYMBOL_DARK;

  if (variant === 'login') {
    return (
      <div
        className={cn(
          'mx-auto mb-4 flex w-full max-w-[280px] items-center justify-center rounded-xl bg-neutral-950 px-6 py-5',
          className
        )}
      >
        <img
          src={LOGIN_LOGO}
          alt={alt}
          className="h-auto w-full max-h-36 object-contain"
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-neutral-950',
        className
      )}
    >
      <img
        src={symbolSrc}
        alt={alt}
        className="h-7 w-7 object-contain"
        draggable={false}
      />
    </div>
  );
}
