import { formatApiErrorBody, type ApiErrorBody } from './apiError.js';

const API_BASE = '/api';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private sessionId: string | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private desktopSecret: string | null | undefined;
  onAuthFailure?: () => void;
  onTokenRefresh?: (tokens: { accessToken: string; refreshToken: string }) => void;

  setTokens(tokens: AuthTokens | null) {
    if (tokens) {
      this.accessToken = tokens.accessToken;
      this.refreshToken = tokens.refreshToken;
      this.sessionId = tokens.sessionId;
    } else {
      this.accessToken = null;
      this.refreshToken = null;
      this.sessionId = null;
    }
  }

  setToken(token: string | null) {
    this.accessToken = token;
  }

  getTokens(): AuthTokens | null {
    if (!this.accessToken || !this.refreshToken || !this.sessionId) return null;
    return { accessToken: this.accessToken, refreshToken: this.refreshToken, sessionId: this.sessionId };
  }

  private async tryRefresh(): Promise<boolean> {
    if (!this.refreshToken || !this.sessionId) return false;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const refreshHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        const desktopSecret = await this.resolveDesktopSecret();
        if (desktopSecret) refreshHeaders['X-Goro-Desktop-Secret'] = desktopSecret;

        const response = await fetch(`${API_BASE}/auth/refresh`, {
          method: 'POST',
          headers: refreshHeaders,
          body: JSON.stringify({ refreshToken: this.refreshToken, sessionId: this.sessionId }),
        });
        if (!response.ok) return false;
        const data = await response.json();
        this.accessToken = data.accessToken;
        if (data.refreshToken) {
          this.refreshToken = data.refreshToken;
          this.onTokenRefresh?.({
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          });
        }
        return true;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async resolveDesktopSecret(): Promise<string | null> {
    if (this.desktopSecret !== undefined) return this.desktopSecret;
    try {
      this.desktopSecret = (await window.electronAPI?.getDesktopApiSecret?.()) ?? null;
    } catch {
      this.desktopSecret = null;
    }
    return this.desktopSecret;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}, retry = true): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const desktopSecret = await this.resolveDesktopSecret();
    if (desktopSecret) {
      headers['X-Goro-Desktop-Secret'] = desktopSecret;
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    } catch {
      throw new Error(
        'Cannot reach API server. Start it with: npm run dev:server (port 3001)'
      );
    }

    if (response.status === 401 && retry && this.refreshToken) {
      const refreshed = await this.tryRefresh();
      if (refreshed) return this.request<T>(endpoint, options, false);
      this.onAuthFailure?.();
    }

    if (!response.ok) {
      const error = (await response.json().catch(() => ({}))) as ApiErrorBody & { code?: string };
      if (response.status === 401) {
        this.onAuthFailure?.();
      }
      if (
        response.status === 403 &&
        (error.code === 'PASSWORD_SETUP_REQUIRED' || error.code === 'ORG_SUSPENDED')
      ) {
        this.onAuthFailure?.();
      }
      if (response.status === 500 && !error.error && !error.message) {
        throw new Error(
          'API server error or unavailable. Ensure npm run dev:server is running on port 3001.'
        );
      }
      throw new Error(formatApiErrorBody(error, response.status));
    }

    return response.json();
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  get<T>(endpoint: string) { return this.request<T>(endpoint); }
  post<T>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, { method: 'POST', body: data ? JSON.stringify(data) : undefined });
  }
  put<T>(endpoint: string, data?: unknown) {
    return this.request<T>(endpoint, { method: 'PUT', body: data ? JSON.stringify(data) : undefined });
  }
  delete<T>(endpoint: string) { return this.request<T>(endpoint, { method: 'DELETE' }); }
}

export const api = new ApiClient();
