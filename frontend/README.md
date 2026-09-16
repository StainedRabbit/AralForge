# AralForge Frontend

AralForge is an academic learning platform for lessons, Main Activities, attendance, grades, and student progress.

## Development

```bash
npm install
npm run dev
```

The frontend calls the API through its own origin. Development defaults to `/api`, with Vite forwarding API and local media requests to Django on port 8000. Set `API_UPSTREAM_ORIGIN` in the frontend development environment to change that target. E2E uses its isolated Django server on port 8001.

Production builds require an explicit API base; use:

```text
VITE_API_BASE_URL=/api
```

Hosted frontend providers must configure this as a build variable because Vite substitutes it while creating the bundle. Legacy absolute non-loopback HTTPS URLs ending in `/api` remain accepted, but cross-site cookies may be blocked by browsers.

## Cloudflare deployment

`wrangler.jsonc` serves `dist` and invokes `worker/index.mjs` before the SPA fallback for `/api/*`. Before deployment, review the authenticated Cloudflare account and copy the existing Worker's domain routes and any additional bindings into this configuration. `keep_vars` preserves variables, not routes. Build and deploy to the existing Worker name:

```bash
npm run build
npm run deploy:cloudflare -- --name <existing-worker-name>
```

Keep the existing domain routes and runtime variables. Configure `API_UPSTREAM_ORIGIN` as a runtime variable on that Worker using the exact environment's Railway HTTPS origin, without `/api`. There is no default upstream and no default Worker name; missing upstream configuration returns an API `503` instead of a login loop or routing staging traffic to production. Deployment with an explicit name is required.

Use Secure, host-only refresh and CSRF cookies with `SameSite=Lax` in Django. See the production runbook for rollout order, trusted origins, session migration, and browser verification.

## Validation

```bash
npm run lint
npm run build
npm run test:worker
npm run test:e2e
```

The browser test runner starts an isolated Django E2E server and Vite instance. It does not use the local development database or uploaded media directory.

## Brand

AralForge uses the approved forge-inspired identity: deep navy, ember orange, and warm gold. The product tagline is “Forge Knowledge, Build Future.” Approved full-color, dark-background, and monochrome raster logos and icons live in `public/brand`; the dark-background icon is used in the browser tab. Touch and fallback browser icons live at the root of `public`, while the optimized login and dashboard hero is bundled from `src/assets`.
