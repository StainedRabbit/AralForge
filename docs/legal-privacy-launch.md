# AralForge Browser Storage Baseline

AralForge uses essential browser and session storage only:

- a rotated Secure/HttpOnly refresh cookie for signed-in sessions;
- a short-lived access token held only in memory;
- CSRF protection for cookie-session operations;
- local editing drafts, interface preferences, and the storage-notice acknowledgment.

The application does not include payment, subscription, refund, advertising, analytics, marketing, tracking, or public-registration features in this baseline.

Production configuration must use HTTPS, exact CORS and CSRF origins, a Secure refresh cookie, and private infrastructure credentials.

## Verification

- No public legal, privacy-request, retention, grade-publication, or instructor-assignment route is exposed in the baseline.
- `ADVANCED_PRIVACY_FEATURES=False` keeps the retained advanced workflows and their routes disabled.

Verified on 2026-09-11:

- `python manage.py test --settings=config.settings_e2e` — 278 passed; 13 advanced-workflow tests skipped by design.
- `npm run lint` — passed.
- `npm run build` — passed.
- `npm run test:e2e` — 59 passed.
- `git diff --check` — passed.
