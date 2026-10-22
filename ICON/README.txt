Tenant branding (Goro)
======================

Login (all tenants): public/branding/goro-logo-login.png — card icon + "Goro" wordmark
Dashboard sidebar:     public/branding/goro-symbol-light.png (dark UI)
                       public/branding/goro-symbol-dark.png (light UI)

Platform owner (GOROVIAN admin) only: public/gorovian-logo.png on /platform/login

Replace files in public/branding/ to rebrand tenant-facing UI.

Icons.aco is an Adobe Color swatch file, not a web icon.

App favicon / install icons (source of truth: public/)
  favicon.ico, favicon-16x16.png, favicon-32x32.png
  apple-touch-icon.png (iOS / macOS)
  android-chrome-192x192.png, android-chrome-512x512.png
  site.webmanifest — linked from index.html

After replacing art, rebuild (npm run build) and hard-refresh the browser (Ctrl+F5).
