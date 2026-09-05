# Student name rollout

This release adds `accounts.User.middle_name` and migration `0007_user_middle_name`.
Screen labels use `display_name` / `student_name`; exports use `full_name` /
`student_full_name`. New entries and imports use explicit first, middle, and last
fields. They never infer a middle name from a new first name.

## Production deployment

1. Schedule maintenance and pause roster imports (block import requests at the
   deployment edge or take the API offline). There is no new import-pause toggle
   in this release. Allow running imports to finish; record any pending jobs.
2. Stop the old Celery worker and take a verified database backup. Keep the backup
   through acceptance checks. Record the API, worker, and frontend revisions.
3. With imports still blocked, run `python manage.py migrate --noinput` using the
   new backend release and production configuration. The migration changes only
   student first/middle names, using historical models and batches of 500. IDs,
   usernames, last names, and related records remain unchanged.
4. Deploy the matching API and worker revision. Do not restart the old worker:
   its import code concatenates middle names into first names. Deploy the new
   frontend before reopening access.
5. Check sample students, including `Mary Ann` → first `Mary`, middle `Ann`,
   compound middle names, existing initials, and single-word given names. Compare
   student/enrollment/grade/attendance counts with the backup. Check roster and
   attendance exports retain full middle names while screens show initials.
6. Verify API health and worker Redis connection, then resume imports. Confirm a
   small explicit three-field import completes and does not rename an existing
   student. Check recorded pending jobs before resubmitting imports.

## Reversal

Pause writes and stop workers before rollback. Reversing migration 0007 joins
first and middle names with a space and removes the middle-name column. It does
not restore original whitespace. New post-release first+middle names can exceed
the old first-name field's 150-character limit; review those records before
reversing, or restore the verified backup as part of a coordinated rollback.
Never deploy the old importer while new-format writes continue.

Production backup, migration, and deployment must be performed against the actual
production services; local tests do not perform these operations.
