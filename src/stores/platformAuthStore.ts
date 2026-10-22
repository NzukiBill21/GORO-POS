import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { platformApi } from '@/lib/platformApi';

interface PlatformUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  scope: 'platform';
  permissions: string[];
}

interface PlatformLoginResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: PlatformUser;
}

interface PlatformAuthState {
  user: PlatformUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const usePlatformAuthStore = create<PlatformAuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      login: async (email, password) => {
        const response = await fetch('/api/platform/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: 'Login failed' }));
          throw new Error(err.error || 'Login failed');
        }
        const data: PlatformLoginResponse = await response.json();
        platformApi.setToken(data.accessToken);
        set({ user: data.user, accessToken: data.accessToken, isAuthenticated: true });
      },

      logout: () => {
        platformApi.setToken(null);
        set({ user: null, accessToken: null, isAuthenticated: false });
      },
    }),
    {
      name: 'pos-platform-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ accessToken: state.accessToken, user: state.user }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) platformApi.setToken(state.accessToken);
      },
    }
  )
);

export function platformCan(permissions: string[], required: string): boolean {
  return permissions.includes('*') || permissions.includes(required);
}
