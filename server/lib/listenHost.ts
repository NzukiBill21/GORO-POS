/**
 * Port rules (do not mix):
 * - Shop / packaged desktop: ONE URL — http://127.0.0.1:API_PORT (UI + API, default 3001).
 * - Local dev (web): ONE browser URL — http://127.0.0.1:DEV_UI_PORT (5173); API stays on API_PORT behind Vite proxy.
 */

export const API_PORT = Number(process.env.PORT || 3001);

/** Vite dev server only — never used on shop tills. */
export const DEV_UI_PORT = 5173;

export function isDesktopStaticUi(): boolean {
  return process.env.DESKTOP_MODE === 'true' && process.env.SERVE_STATIC === 'true';
}

export function resolveListenHost(): string {
  const requested = (process.env.HOST ?? '127.0.0.1').trim();

  if (process.env.DESKTOP_MODE === 'true') {
    if (requested !== '127.0.0.1' && requested !== 'localhost' && process.env.ALLOW_LAN_BIND !== 'true') {
      console.warn(`[security] DESKTOP_MODE: ignoring HOST=${requested}, binding 127.0.0.1 only`);
      return '127.0.0.1';
    }
    return requested === 'localhost' ? '127.0.0.1' : requested;
  }

  return requested === 'localhost' ? '127.0.0.1' : requested;
}

/** Exactly one browser origin per run mode — never both 5173 and 3001. */
export function resolveCorsOrigin(): string {
  if (process.env.CORS_ORIGIN?.trim()) {
    const first = process.env.CORS_ORIGIN.split(',')[0]?.trim();
    if (first) return first;
  }
  if (isDesktopStaticUi()) {
    return `http://127.0.0.1:${API_PORT}`;
  }
  return `http://127.0.0.1:${DEV_UI_PORT}`;
}

function devUiOriginAliases(): string[] {
  return [`http://127.0.0.1:${DEV_UI_PORT}`, `http://localhost:${DEV_UI_PORT}`];
}

/** Browser origins allowed for CORS + Host/Origin guard (dev: localhost and 127.0.0.1 are equivalent). */
export function resolveCorsOrigins(): string[] {
  const fromEnv = process.env.CORS_ORIGIN?.trim()
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  const origins = new Set<string>(fromEnv.length > 0 ? fromEnv : [resolveCorsOrigin()]);

  if (!isDesktopStaticUi()) {
    for (const o of devUiOriginAliases()) origins.add(o);
  }

  return [...origins];
}

/** CSP connect-src for responses this server sends (packaged UI is same-origin on API_PORT). */
export function resolveHelmetConnectSrc(): string[] {
  return ["'self'"];
}
