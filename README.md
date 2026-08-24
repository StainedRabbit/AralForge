# AralForge

AralForge is an academic coding platform that brings lessons, coding practice, assessments, attendance, grading, and student progress into one focused workspace.

**Forge Knowledge, Build Future.**

## Project structure

- `backend` — Django REST API and local media storage
- `frontend` — React, TypeScript, and Vite application
- `docs` — deployment and production-readiness guidance
- `scripts` — backup, migration, verification, and benchmark utilities

## Local development

Create a local `.env` from `.env.example`, install the Python requirements and frontend packages, then run Django on port 8000 and Vite on port 5173.

```powershell
python backend/manage.py migrate
python backend/manage.py runserver
```

```powershell
cd frontend
npm install
npm run dev
```

## Validation

```powershell
python backend/manage.py test
cd frontend
npm run lint
npm run build
npm run test:e2e
```

See `docs/production-readiness.md` before preparing staging or production infrastructure.
