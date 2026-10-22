import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'default' | 'light' | 'dark' | 'system';

const THEME_CYCLE: Theme[] = ['default', 'light', 'dark', 'system'];

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'default',
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      cycleTheme: () => {
        const current = get().theme;
        const next = THEME_CYCLE[(THEME_CYCLE.indexOf(current) + 1) % THEME_CYCLE.length];
        get().setTheme(next);
      },
    }),
    {
      name: 'pos-theme',
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
        else applyTheme('default');
      },
    }
  )
);

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove('dark', 'theme-light', 'theme-default');

  if (theme === 'default') {
    root.classList.add('theme-default');
    return;
  }
  if (theme === 'light') {
    root.classList.add('theme-light');
    return;
  }
  if (theme === 'dark') {
    root.classList.add('dark');
    return;
  }
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (systemDark) root.classList.add('dark');
}

export function initTheme() {
  const stored = localStorage.getItem('pos-theme');
  if (stored) {
    try {
      const { state } = JSON.parse(stored);
      applyTheme(state.theme ?? 'default');
    } catch {
      applyTheme('default');
    }
  } else {
    applyTheme('default');
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const theme = useThemeStore.getState().theme;
    if (theme === 'system') applyTheme('system');
  });
}

export function themeLabel(theme: Theme): string {
  switch (theme) {
    case 'default':
      return 'Default';
    case 'light':
      return 'Light';
    case 'dark':
      return 'Dark';
    case 'system':
      return 'System';
  }
}
