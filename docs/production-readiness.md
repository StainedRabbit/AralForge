# Ezoryx Production Readiness

## Immediate Foundation

1. Reinstall dependencies after pulling production-readiness changes.

   ```powershell
   pip install -r requirements.txt
   ```

2. Verify Django can start.

   ```powershell
   cd backend
   python manage.py check
   python manage.py migrate
   python manage.py test
   ```

3. Keep SQLite for local development unless `DATABASE_URL` is set.

## Environment Variables

Use `.env.example` as the checklist for local, staging, and production values.

Required for production:

- `SECRET_KEY`
- `DEBUG=False`
- `ALLOWED_HOSTS`
- `CORS_ALLOWED_ORIGINS`
- `CSRF_TRUSTED_ORIGINS`
- `DATABASE_URL`

Supabase uses a PostgreSQL URL. Keep the production database separate from any staging database.

## Database Discipline

- Migrations are the only source of schema changes.
- Do not manually alter SQLite or Supabase tables unless recovering from an emergency.
- Before production migrations, take a database backup.
- Test migrations on staging before production.

## Backup / Export

Local SQLite backup:

```powershell
Copy-Item backend/db.sqlite3 backend/backups/db-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite3
```

Django fixture export after `manage.py` works:

```powershell
cd backend
python manage.py dumpdata --natural-foreign --natural-primary --exclude contenttypes --exclude auth.permission --exclude sessions.session --indent 2 > data-export.json
```

Import to staging after migrations:

```powershell
cd backend
python manage.py loaddata data-export.json
```

## Staging Checklist

- `python manage.py migrate` runs on an empty Supabase staging database.
- Admin login works.
- Student login works.
- Students only see their own records.
- Module access works for free and paid modules.
- Mock exam generation and scoring work.
- Grades and attendance are isolated per student.
- Uploaded PDFs/files open correctly.

## Production Checklist

- `DEBUG=False`.
- Strong `SECRET_KEY`.
- Production domains are in `ALLOWED_HOSTS`, `CORS_ALLOWED_ORIGINS`, and `CSRF_TRUSTED_ORIGINS`.
- Supabase backups are enabled.
- No test users or demo grades are exposed.
- Frontend build uses production `VITE_API_BASE_URL`.
