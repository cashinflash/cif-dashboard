/* CIF Admin service worker — instant launches + graceful offline.
 *
 * Deliberately conservative:
 *  - GET only. /api/, /fb/, and /login are NEVER touched (auth + live
 *    data go straight to the network, zero staleness risk).
 *  - Navigations are NETWORK-FIRST (a deploy is visible on the very
 *    next online launch) with a cached copy of /app as the fallback,
 *    then a minimal offline screen. The /app copy is only cached from
 *    a clean 200 (never a login redirect), so an unauthenticated
 *    session can't poison the shell cache.
 *  - Static assets (icons, logo, manifest, Google Fonts) are served
 *    cache-first with a background refresh.
 * Bump VERSION to invalidate everything on deploy-sensitive changes.
 */

const VERSION = 'cif-shell-v1';
const STATIC_CACHE = VERSION + '-static';
const SHELL_CACHE = VERSION + '-shell';

const STATIC_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const OFFLINE_HTML = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline — CIF Admin</title>
<style>body{margin:0;font-family:Inter,-apple-system,system-ui,sans-serif;background:#f5f7f5;
display:flex;align-items:center;justify-content:center;min-height:100vh;color:#374151}
.card{text-align:center;padding:40px 28px;max-width:340px}
.icn{width:72px;height:72px;border-radius:18px;margin:0 auto 18px;
background:linear-gradient(180deg,#1cb254,#128a3e);display:flex;align-items:center;
justify-content:center;color:#fff;font-size:34px;font-weight:800}
h1{font-size:18px;margin:0 0 8px}p{font-size:13.5px;color:#6b7280;line-height:1.5;margin:0 0 20px}
button{background:#16a34a;color:#fff;border:none;border-radius:10px;padding:12px 22px;
font-size:14px;font-weight:700;font-family:inherit;cursor:pointer}</style></head>
<body><div class="card"><div class="icn">F</div><h1>You're offline</h1>
<p>CIF Admin needs a connection to load live applications and loan data.
Reconnect and try again.</p>
<button onclick="location.reload()">Retry</button></div></body></html>`;

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((n) => !n.startsWith(VERSION))
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function isStaticAsset(url) {
  if (STATIC_HOSTS.includes(url.hostname)) return true;
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith('/static/')
      || url.pathname === '/favicon.png'
      || url.pathname === '/manifest.json';
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Live data + auth: hands off, always.
  if (url.origin === self.location.origin &&
      (url.pathname.startsWith('/api/') || url.pathname.startsWith('/fb/')
       || url.pathname.startsWith('/login'))) {
    return;
  }

  // App shell navigations: network-first, cached /app fallback,
  // offline screen last.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const resp = await fetch(req);
        if (resp.ok && !resp.redirected &&
            (url.pathname === '/app' || url.pathname === '/app.html')) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put('/app', resp.clone());
        }
        return resp;
      } catch (err) {
        // Cached shell ONLY for the app itself — an offline hit on '/'
        // (login) or any other page gets the offline screen instead of
        // silently impersonating /app.
        if (url.pathname === '/app' || url.pathname === '/app.html') {
          const cache = await caches.open(SHELL_CACHE);
          const shell = await cache.match('/app');
          if (shell) return shell;
        }
        return new Response(OFFLINE_HTML,
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // Static assets: cache-first with background refresh.
  if (isStaticAsset(url)) {
    e.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(req);
      const refresh = fetch(req).then((resp) => {
        if (resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => hit);
      return hit || refresh;
    })());
  }
});
