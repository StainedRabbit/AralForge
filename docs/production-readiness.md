# Ezoryx Production Runbook

Ezoryx deploys as two isolated environments:

- `main` deploys staging: Vercel frontend, paid Render API, Supabase PostgreSQL, and private Supabase Storage.
- `production` deploys production with separate services, database, bucket, and secrets.

Production is promoted by pushing the exact staging-validated commit to `production`; do not merge additional changes during promotion.

## Required configuration

Render requires these values for each environment:

- `DEBUG=False`
- `SECRET_KEY` (unique per environment)
- `DATABASE_URL` (PostgreSQL only)
- `ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS` (the exact Vercel origin)
- `CSRF_TRUSTED_ORIGINS` (the exact HTTPS origins)
- `SUPABASE_S3_ENDPOINT` (use the direct `project-ref.storage.supabase.co/storage/v1/s3` endpoint)
- `SUPABASE_S3_REGION`
- `SUPABASE_S3_ACCESS_KEY_ID`
- `SUPABASE_S3_SECRET_ACCESS_KEY`
- `SUPABASE_STORAGE_BUCKET`

Vercel requires `VITE_API_BASE_URL`, including the backend `/api` suffix. Configure two Vercel projects rooted at `frontend`: staging tracks `main`, production tracks `production`.

Never place production values in `.env`, GitHub Actions, fixtures, screenshots, or support messages. Supabase S3 access keys are server-only and the media buckets must remain private.

## Secure source-data export

Before migration, stop writes to the SQLite source and create an off-repository backup:

```powershell
powershell -File scripts/backup-sqlite.ps1 -BackupDir "D:\secure\ezoryx-cutover"
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
  --output "D:\secure\ezoryx-cutover\data-export.json"
```

Encrypt the backup directory with the organization-approved encryption tool before transferring it. Record SHA-256 hashes and never commit the artifacts.

## Staging migration

1. Create the staging Supabase project and private `ezoryx-media-staging` bucket. Enable the S3 protocol and generate server-only keys.
2. Apply the Render Blueprint and provide every `sync: false` value.
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

5. Rotate all migrated credentials. The output must be outside the repository and securely deleted after distribution:

   ```bash
   python manage.py prepare_migrated_users --confirm --output /secure/temporary-credentials.csv
   ```

6. Confirm `learning_modules.0019_activity_reliability` is applied and create/delete a disposable record to prove PostgreSQL sequences advanced correctly.

## Staging acceptance

- `GET /api/health/` returns `200 {"status":"ok"}`.
- Admin and student logins work, and every migrated account must change its temporary password.
- Students cannot see another student's grades, attendance, attempts, submissions, or uploaded files.
- Free/paid module access, mock exams, activity grading, attendance, and gradebook workflows pass.
- Uploaded files remain available after a Render redeploy; unsigned private bucket URLs fail.
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
2. Import the final data into the separate production Supabase project and private `ezoryx-media-production` bucket.
3. Run media verification and credential rotation before exposing the frontend.
4. Push only the validated commit to `production`, then run the health, login, authorization, upload, PDF, grades, and attendance smoke tests.
5. Keep the previous application commit, database backup/PITR point, and independent media backup. Supabase Storage does not provide S3 object versioning.
6. For an application rollback, redeploy the prior commit and leave forward-compatible schema in place. Restore database or media only for confirmed data corruption; never delete storage objects during an application-only rollback.

## Sensitive-history cleanup

The committed `backend/sqlite_export_for_postgres.json` contained account and school records. History was rewritten locally with `git-filter-repo`. Before the next shared push:

- Verify the backup bundle and SQLite backup stored outside Git.
- Force-push rewritten branches and tags as a coordinated maintenance event.
- Ask GitHub support/admins to purge cached sensitive objects if necessary.
- Require every collaborator and deployment checkout to re-clone; do not merge an old clone back into rewritten history.
- Rotate credentials even if the repository was private.
