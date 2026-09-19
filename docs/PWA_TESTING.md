# PWA testing (C4)

What the service worker does, what was verified and how, and the checklist for
installing on real Android and iOS devices.

## What ships

| Piece | File |
|---|---|
| Service worker | `public/sw.js` |
| Registration, kill switch, session check | `src/components/pwa/service-worker-registration.tsx` |
| Saved-data status and sign-out clearing | `src/lib/pwa/offline-data.ts` |
| Banner | `src/components/pwa/offline-banner.tsx` (in `AppShell`) |
| Page for a page never saved | `src/app/offline/page.tsx` |
| Manifest | `public/manifest.json` |
| Icons | `public/icons/*.svg` → `node scripts/render-icons.mjs` → PNGs |
| Automated checks | `scripts/pwa-check.mjs` |

### Caching strategies

| Requests | Strategy | Why |
|---|---|---|
| `/_next/static/*`, `/icons/*` | **Cache-first** | File names carry a content hash: a saved copy is never out of date. |
| `GET` on `/api/market/*`, `/api/rates`, `/api/dashboard`, `/api/portfolio*`, `/api/transaction*`, `/api/watchlist`, `/api/analytics/*`, `/api/goals`, `/api/alerts` | **Network-first**, saved copy as fallback | The network always wins. The copy is read only when the request fails. |
| Page navigations (except `/login`, `/register`, `/auth`, `/offline`, `/admin`) | **Stale-while-revalidate** | A page opened before opens instantly and offline; the network refreshes the copy in the background. |
| Everything else (non-GET, other origins such as Supabase, RSC fetches, `/api/jobs/*`, `/api/market/search`, `/api/analytics/vitals`, `/api/cron/*`) | Untouched | |

### Saved data is never shown as current

- A response served from the saved copy carries `x-sw-source: cache` and
  `x-sw-stored-at`. `apiFetcher` reports every response; while any number on
  screen came from a saved copy the app shows, under the top bar:

  > Estás viendo datos guardados, sin conexión. Guardados el 14 sep 2026, 1:01 a.m.

  The date is that of the **oldest** saved response on screen.
- The banner stays until each of those URLs has been fetched from the network
  again. After reconnecting, entries for components no longer on screen (which
  would never refetch) are dropped after 10 s.
- Offline with nothing saved, API requests return an explicit
  `503 {"error":"Sin conexión"}` marked `x-sw-source: offline` — an error state,
  never an empty portfolio.
- Offline without saved data on screen the banner still says
  "Sin conexión. Los datos no se actualizarán hasta que vuelvas a estar en línea."

### Privacy on shared devices

Saved pages and API responses are a user's portfolio. They are deleted from the
page (not relying on the worker being awake):

- on sign-out (`topbar.tsx`, `header.tsx`);
- on sign-in and on sign-up, in case the previous user never signed out.

Asset caches hold only public build files and are kept.

If a saved page is served and its background refresh comes back as a redirect
(the session ended), the worker deletes the copy; the page asks the worker how
the refresh went once it has loaded, and reloads into the login redirect.

### Deploys and the kill switch

- The page registers `/sw.js?v=<commit>` (`NEXT_PUBLIC_BUILD_VERSION`, set in
  `next.config.ts`). Each deploy is a new script URL → a new worker installs,
  takes over, and deletes the previous build's asset, shell and offline caches.
  Saved data (`it-data-v1`) survives deploys.
- `/sw.js` is served `Cache-Control: no-cache, no-store, must-revalidate` and is
  excluded from the proxy, so signed-out visitors can register it.
- **`FEATURE_PWA=false`** (Vercel env var, then redeploy): every page unregisters
  the worker and deletes all `it-*` caches.
- Registration only happens in production builds.

## Verified (2026-09-14, re-run 2026-09-19, local production build)

The 2026-09-19 re-run (Ola 6, item 5 of the correction plan) was made against
`npx next build && npx next start -p 3100` on the current master and produced
the same result as the table below: no installability errors, no manifest
errors, the worker controlling the page, and all three offline cases served by
it. Installing on real devices is still open — see the manual checklist.

### Automated: `node scripts/pwa-check.mjs http://localhost:3100`

Headless Chromium, signed out. Result:

| Check | Result |
|---|---|
| Worker installed and controlling the page | yes, `/sw.js?v=local-…` |
| Chromium installability errors (`Page.getInstallabilityErrors`, the criteria Android Chrome applies) | **none** |
| Manifest parse errors | none |
| Manifest as parsed | id `/dashboard`, standalone, start `/dashboard`, scope `/`, orientation any, icons 192/512/maskable 512, 3 shortcuts |
| `apple-touch-icon` | 200, 180×180 |
| Caches after first visit | `it-assets-*`, `it-shell-*`, `it-offline-*` |
| Offline, landing page (saved) | served by the worker, headline rendered |
| Offline, `/discover` (never saved) | worker serves "Sin conexión" page, styled |
| Offline, `/api/rates` (never saved) | 503, `x-sw-source: offline` |

### Unit tests: `tests/pwa/`

`service-worker.test.ts` runs the real `public/sw.js` in a sandbox with an
in-memory CacheStorage (17 tests): routing and exclusions, cache-first, network
preference, marked fallback, the 503, nothing saved from errors/redirects/HTML,
stale-while-revalidate, the offline page, the redirect → delete → "redirect"
reply, the 40-page bound, install precache and activation cleanup. Five
deliberate mutations of `sw.js` (unmarked fallback, redirect reported as failed,
no cleanup, no cache hit, search endpoint cached) each failed a test.

`offline-data.test.ts` covers the banner state and text, the reconnect grace
period and sign-out clearing.

### Signed in, in the browser

On the production build, signed in, `/dashboard`:

1. Online: $2,726.90, no banner. Caches: the dashboard shell and
   `/api/market/batch?…`, `/api/watchlist`, `/api/rates`, `/api/portfolio`,
   `/api/portfolio/history?range=30`.
2. Server stopped (every request fails, as offline) and reload: the dashboard
   opened from the saved shell with $2,726.90 and the banner
   "Estás viendo datos guardados, sin conexión. Guardados el 14 sep 2026, 1:01 a.m."
   (the double period this first showed after "a.m." was fixed and has a test).
3. `/lab`, never opened: the "Sin conexión" page.
4. "Ir al panel" from there (a client-side navigation whose RSC fetch fails):
   Next fell back to a document navigation, served from the saved dashboard.
5. Server restarted with a new build: the new worker took over, the previous
   build's caches were gone, `it-data-v1` remained, no banner, no console errors
   in a fresh tab.

Not exercised live: sign-out clearing (it would end the account's session, and
signing back in is the user's to do) and the session-ended reload (needs an
expired session). Both are covered by the unit tests above.

## Manual checklist — real devices

These need a phone and the production URL (`https://project-tri0w.vercel.app`).
They were **not** run for this change: no device was available. Record the
device, OS and browser version when running them.

### Android (Chrome)

1. Open the site, sign in, open the dashboard.
2. Menu ⋮ → **Instalar app** (or the install banner). Expect name
   "InvestTracker" and the dark "IT" icon.
3. Launch from the home screen: standalone window, no address bar, opens on
   `/dashboard`. Long-press the icon: shortcuts Panel, Mercados, Portafolios.
4. Check the icon shape follows the launcher mask (circle/squircle) with "IT"
   fully visible — that is the maskable icon.
5. Airplane mode → relaunch: the dashboard opens with the saved-data banner and
   its date. Open a page never visited: "Sin conexión".
6. Airplane mode off → pull to refresh or wait: banner disappears, values update.
7. Sign out → airplane mode → relaunch: no portfolio data is shown.

### iOS (Safari, iOS 16.4+)

1. Open the site in **Safari**, sign in.
2. Share → **Agregar a inicio**. Expect title "InvestTracker" and the 180×180
   "IT" icon (iOS ignores manifest icons and uses `apple-touch-icon`).
3. Launch from the home screen: standalone, status bar translucent over the dark
   theme, content not under the notch (`viewport-fit=cover`).
4. Note: the installed app has its **own storage** separate from Safari; sign in
   again inside it. iOS may evict caches of apps unused for weeks.
5. Airplane mode → relaunch: saved dashboard with the banner; unsaved page →
   "Sin conexión".
6. Sign out → airplane mode → relaunch: no portfolio data.

### Desktop (Chrome/Edge), quick

DevTools → Application → Manifest (no warnings), Service workers (activated,
`sw.js?v=<commit>`), Cache storage (`it-*`). Network → Offline → reload.

## Known limits

- **Lie-fi:** network-first waits for the network. On a connection that hangs
  rather than fails, requests take as long as the browser's own timeout before
  the saved copy is used. A timeout was not added: a slow but valid market
  response replaced by a saved one would be worse than waiting.
- Saved data is per URL: a page whose query differs from any saved one has
  nothing saved.
- Server-rendered admin pages are not saved.
- A session that simply expires (no sign-out) leaves its saved data on the
  device until the next sign-in; the saved shell is dropped on its first online
  refresh.
