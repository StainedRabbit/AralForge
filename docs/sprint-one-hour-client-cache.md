# Sprint: One-hour browser cache for non-grade pages

## Goal

Previously visited pages should open quickly for one hour, including after the browser closes and reopens. Grades and scores remain fresh. Saved data belongs to the verified account and is removed on sign-out.

## Work items

- [x] Set one-hour freshness and retention for stable page data. Keep grades, scores, active attendance entry, and job status on short live queries; update or invalidate affected queries after saves.
- [x] Persist successful, approved non-grade queries in IndexedDB for at most one hour per query. Include course content, class and roster data, attendance history, and student directory data. Use memory caching when browser storage is unavailable.
- [x] Split module, activity, Quiz editor, and roster responses into cacheable content and live state. Keep existing default API response shapes for compatibility and preserve authorization and learning-context checks.
- [x] Restore browser data only after session renewal and a fresh identity request. Version and scope the saved data to that account. Clear it on sign-out, session expiry, or account change. Never save tokens, grades, scores, attempts, active attendance entry, or job status.
- [x] Update the browser storage notice for saved roster and attendance data.
- [ ] Obtain the school DPO's confirmation of one-hour browser-cache retention before production rollout, as required by the privacy governance pack.

## Acceptance checks

- [x] A same-account revisit and browser reopen use eligible cached data while it is younger than one hour. Expired data refetches.
- [x] Edits invalidate affected cached data. Grades and scores are absent from IndexedDB and use fresh requests.
- [x] Sign-out and account changes cannot restore another account's data. Storage failure still permits normal API loading.
- [x] Backend tests cover split response shapes and access rules. Frontend E2E tests cover expiry, invalidation, account isolation, reload, and reopen. The frontend build and relevant Quiz, class, and activity flows pass.

## Rollout

Keep API and CDN `Cache-Control: no-store` behavior. Record the school DPO's one-hour cache-retention approval before enabling browser persistence in production. Compare repeat-visit requests and response bytes in staging, then verify grade updates remain current.

Implementation uses TanStack Query's `dehydrate` and `hydrate` persistence APIs with IndexedDB. The global `gcTime` is one hour, matching the maximum persisted age. The browser rejects old queries individually and deletes an expired or differently owned saved snapshot on the next authenticated opening. Browser storage failures fall back to normal API requests.

Verification on 2026-10-22: 46 targeted learning-module and roster backend tests passed; page-cache, Quiz, activity-context, and all class E2E cases passed (the score-sheet case passed on isolated rerun after a full-suite 30-second timeout); `npm run build` and `npm run lint` passed. DPO approval and production observation remain open.
