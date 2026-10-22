import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const SHORTCUTS: Record<string, { path?: string; key?: string; ctrl?: boolean }> = {
  'ctrl+1': { path: '/' },
  'ctrl+2': { path: '/pos' },
  'ctrl+3': { path: '/products' },
  'ctrl+4': { path: '/inventory' },
  'ctrl+5': { path: '/customers' },
  'ctrl+6': { path: '/sales' },
};

export function useGlobalShortcuts(onCommandPalette?: () => void) {
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onCommandPalette?.();
        return;
      }

      const combo = `ctrl+${e.key}`;
      const shortcut = SHORTCUTS[combo];
      if (e.ctrlKey && shortcut?.path) {
        e.preventDefault();
        navigate(shortcut.path);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, onCommandPalette]);
}
