# AralForge Production Runbook

AralForge deploys as two isolated environments:

- `main` deploys staging: Cloudflare frontend, Railway API, Supabase PostgreSQL, and private Cloudflare R2 storage.
- `production` deploys production with separate services, database, bucket, and secrets.

Production is promoted by pushing the exact staging-validated commit to `production`; do not merge additional changes during promotion.

## Required configuration

Railway requires these values for each environment:

- `DEBUG=False`
- `SECRET_KEY` (unique per environment)
- `DATABASE_URL` (PostgreSQL only)
- `ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS` (only the exact frontend origins)
- `CORS_ALLOWED_ORIGIN_REGEXES` (leave empty unless a reviewed, narrowly scoped pattern is required)
- `CSRF_TRUSTED_ORIGINS` (the exact HTTPS origins)
- `SUPABASE_S3_ENDPOINT` (the existing compatibility name for the Cloudflare R2 S3 endpoint)
- `SUPABASE_S3_REGION`
- `SUPABASE_S3_ACCESS_KEY_ID`
- `SUPABASE_S3_SECRET_ACCESS_KEY`
- `SUPABASE_STORAGE_BUCKET`

Cloudflare requires `VITE_API_BASE_URL` as a build variable, including the backend `/api` suffix. Production builds reject missing, insecure, or loopback values. Keep separate frontend deployments for staging and production.

## Staging frontend and API connection

1. In the Railway staging API service, open **Settings > Networking > Public Networking**, select **Generate Domain**, and copy the generated HTTPS URL. Do not guess it or use `api-staging.aralforge.com` until that custom domain resolves and passes the health check.
2. If the generated URL is `https://<railway-host>`, configure Railway staging with:

   ```text
   ALLOWED_HOSTS=<railway-host>
   CORS_ALLOWED_ORIGINS=https://frontend.kevinezertanierla.workers.dev
   CSRF_TRUSTED_ORIGINS=https://frontend.kevinezertanierla.workers.dev
   ```

   Leave `CORS_ALLOWED_ORIGIN_REGEXES` unset or empty. Railway also supplies `RAILWAY_PUBLIC_DOMAIN`, which Django adds to `ALLOWED_HOSTS` automatically.
3. In the existing Cloudflare Worker, open **Settings > Builds**, record the current build/deploy commands, disconnect the incorrect `StainedRabbit/frontend` source, and reconnect `StainedRabbit/AralForge` with branch `main` and root directory `frontend`. Keep the existing Worker name and deploy command.
4. Add this Cloudflare build variable before rebuilding:

   ```text
   VITE_API_BASE_URL=https://<railway-host>/api
   ```

5. Verify `https://<railway-host>/api/health/`, the login request, token refresh, bearer-authenticated requests, and the exact CORS response before treating staging as ready.

Production must remain separate and restricted to:

```text
CORS_ALLOWED_ORIGINS=https://aralforge.com,https://www.aralforge.com
CSRF_TRUSTED_ORIGINS=https://aralforge.com,https://www.aralforge.com
CORS_ALLOWED_ORIGIN_REGEXES=
```

Production Cloudflare must use the exact production Railway API URL followed by `/api`; it must never reuse the staging URL.

Never place production values in `.env`, GitHub Actions, fixtures, screenshots, or support messages. S3-compatible storage access keys are server-only and the R2 media buckets must remain private.

## Secure source-data export

Before migration, stop writes to the SQLite source and create an off-repository backup:

```powershell
powershell -File scripts/backup-sqlite.ps1 -BackupDir "D:\secure\aralforge-cutover"
```

Create the migration fixture outside the repository. Exclude sessions, admin logs, content types, and permissions:

```powershell
cd backend
python manage.py dumpdata `
  --natural-foreign `
  --natural-primary `
  --exclude contenttypes `
  --exclude auth.permission `
  --exclude sessions.session `
  --exclude admin.logentry `
  --indent 2 `
  --output "D:\secure\aralforge-cutover\data-export.json"
```

Encrypt the backup directory with the organization-approved encryption tool before transferring it. Record SHA-256 hashes and never commit the artifacts.

## Staging migration

1. Create the staging Supabase database and private Cloudflare R2 `aralforge-media-staging` bucket. Generate server-only S3-compatible keys.
2. Deploy the Railway staging API and provide every required environment value.
3. Run migrations and import the off-repository fixture:

   ```bash
   python manage.py migrate --noinput
   python manage.py loaddata /secure/data-export.json
   ```

4. Upload every media object using the same relative key, then verify database references and source objects:

   ```bash
   python manage.py sync_media_to_storage --source /secure/media --dry-run
   python manage.py sync_media_to_storage --source /secure/media
   python manage.py verify_media_storage --source /secure/media
   ```

5. Back up the staging database, preflight every student number, then synchronize all active and inactive student credentials:

   ```bash
   python manage.py sync_student_credentials --dry-run
   python manage.py sync_student_credentials --confirm
   ```

   The confirmed command sets each student username and temporary password to the exact student number and requires the existing first-login password setup. It aborts without changes if it finds an invalid number, a case-insensitive duplicate, a non-student username conflict, or a profile linked to a non-student account. Admin and teacher credentials are not changed.

6. Confirm `learning_modules.0019_activity_reliability` is applied and create/delete a disposable record to prove PostgreSQL sequences advanced correctly.

## Staging acceptance

- `GET /api/health/` returns `200 {"status":"ok"}`.
- Admin logins remain unchanged. Students sign in with their student number as both username and temporary password, then must create a secure password.
- Students cannot see another student's grades, attendance, attempts, submissions, or uploaded files.
- Teacher-controlled module access, mock exams, activity grading, attendance, and gradebook workflows pass.
- Uploaded files remain available after a Railway redeploy; unsigned private bucket URLs fail.
- Lesson and module PDFs render remote images and download correctly.
- The browser E2E suite passes against the release code.
- The authenticated benchmark completes with no errors and read p95 below 500 ms:

  ```powershell
  python scripts/benchmark_api.py `
    --base-url https://staging-api.example.com/api/ `
    --username load-test-teacher `
    --password "replace-me" `
    --requests 100 `
    --concurrency 10 `
    --p95-budget-ms 500
  ```

## Production promotion and rollback

1. Freeze source writes and repeat the encrypted database/media backups.
2. Import the final data into the separate production Supabase project and private Cloudflare R2 `aralforge-media-production` bucket.
3. Run media verification, back up Supabase, then run `sync_student_credentials --dry-run` followed by `sync_student_credentials --confirm` before exposing the frontend.
4. Push only the validated commit to `production`, then run the health, login, authorization, upload, PDF, grades, and attendance smoke tests.
5. Keep the previous application commit, database backup/PITR point, and independent media backup.
6. For an application rollback, redeploy the prior commit and leave forward-compatible schema in place. Restore database or media only for confirmed data corruption; never delete storage objects during an application-only rollback.

## Sensitive-history cleanup

The committed `backend/sqlite_export_for_postgres.json` contained account and school records. History was rewritten locally with `git-filter-repo`. Before the next shared push:

- Verify the backup bundle and SQLite backup stored outside Git.
- Force-push rewritten branches and tags as a coordinated maintenance event.
- Ask GitHub support/admins to purge cached sensitive objects if necessary.
- Require every collaborator and deployment checkout to re-clone; do not merge an old clone back into rewritten history.
- Rotate credentials even if the repository was private.
