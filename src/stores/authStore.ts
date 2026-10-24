import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { api } from '@/lib/api';
import { useBusinessStore } from '@/stores/businessStore';
interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  currency?: string;
  branchId?: string;
  branchName?: string;
  avatar?: string;
  permissions?: string[];
  mustChangePassword?: boolean;
}

interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  user: User;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  sessionId: string | null;
  isAuthenticated: boolean;
  /** False until sessionStorage rehydrate + optional /auth/me check finish. */
  authReady: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loadUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      sessionId: null,
      isAuthenticated: false,
      authReady: false,

      login: async (email, password) => {
        const response = await api.post<LoginResponse>('/auth/login', { email, password });
        api.setTokens({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          sessionId: response.sessionId,
        });
        api.onTokenRefresh = (tokens) => {
          set({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          });
        };
        set({
          user: response.user,
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          sessionId: response.sessionId,
          isAuthenticated: true,
          authReady: true,
        });
        if (response.user.currency) {
          useBusinessStore.getState().setCurrency(response.user.currency);
        }
      },

      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          // proceed with local logout
        }
        api.setTokens(null);
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          sessionId: null,
          isAuthenticated: false,
          authReady: true,
        });
      },

      loadUser: async () => {
        const { accessToken, refreshToken, sessionId } = get();
        if (!accessToken || !refreshToken || !sessionId) {
          set({ authReady: true });
          return;
        }
        api.setTokens({ accessToken, refreshToken, sessionId });
        api.onTokenRefresh = (tokens) => {
          set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
        };
        api.onAuthFailure = () => get().logout();
        try {
          const user = await api.get<User>('/auth/me');
          set({ user, isAuthenticated: true, authReady: true });
          if (user.currency) {
            useBusinessStore.getState().setCurrency(user.currency);
          }
        } catch {
          await get().logout();
        }
      },
    }),
    {
      name: 'pos-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        sessionId: state.sessionId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken && state.refreshToken && state.sessionId) {
          api.setTokens({
            accessToken: state.accessToken,
            refreshToken: state.refreshToken,
            sessionId: state.sessionId,
          });
          api.onTokenRefresh = (tokens) => {
            useAuthStore.setState({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
            });
          };
          api.onAuthFailure = () => state.logout();
          void state.loadUser();
        } else {
          useAuthStore.setState({ authReady: true });
        }
      },
    }
  )
);
