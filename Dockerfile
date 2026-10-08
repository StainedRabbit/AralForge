FROM python:3.13.3-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        fonts-dejavu-core \
        libffi8 \
        libgdk-pixbuf-2.0-0 \
        libharfbuzz-subset0 \
        libjpeg62-turbo \
        libopenjp2-7 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        shared-mime-info \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error \
        https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && printf 'Types: deb\nURIs: https://apt.postgresql.org/pub/repos/apt\nSuites: bookworm-pgdg\nComponents: main\nSigned-By: /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc\n' \
        > /etc/apt/sources.list.d/pgdg.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && pg_dump --version | grep -Eq '^pg_dump \(PostgreSQL\) 17\.' \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend/public/lesson-assets ./frontend/public/lesson-assets

RUN SECRET_KEY=django-build-only DEBUG=True python backend/manage.py collectstatic --noinput \
    && addgroup --system aralforge \
    && adduser --system --ingroup aralforge --home /app aralforge \
    && chown -R aralforge:aralforge /app

WORKDIR /app/backend
USER aralforge

EXPOSE 10000

CMD ["gunicorn", "--bind", "0.0.0.0:10000", "--workers", "3", "--timeout", "120", "config.wsgi:application"]
