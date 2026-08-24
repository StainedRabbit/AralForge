# AralForge Frontend

AralForge is an academic coding platform for lessons, activities, assessments, attendance, grades, and student progress.

## Development

```bash
npm install
npm run dev
```

The frontend reads `VITE_API_BASE_URL` from the active environment. The Vite development server defaults to `http://127.0.0.1:8000/api`, but production builds require an explicit non-loopback HTTPS URL ending in `/api`:

```text
VITE_API_BASE_URL=https://your-api-host.example/api
```

Hosted frontend providers must configure this as a build variable because Vite substitutes it while creating the bundle.

## Validation

```bash
npm run lint
npm run build
npm run test:e2e
```

The browser test runner starts an isolated Django E2E server and Vite instance. It does not use the local development database or uploaded media directory.

## Brand

AralForge uses the approved forge-inspired identity: deep navy, ember orange, and warm gold. The product tagline is “Forge Knowledge, Build Future.” Approved full-color, dark-background, and monochrome raster logos and icons live in `public/brand`; the dark-background icon is used in the browser tab. Touch and fallback browser icons live at the root of `public`, while the optimized login and dashboard hero is bundled from `src/assets`.
