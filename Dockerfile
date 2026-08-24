FROM python:3.13.3-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-dejavu-core \
        libffi8 \
        libgdk-pixbuf-2.0-0 \
        libharfbuzz-subset0 \
        libjpeg62-turbo \
        libopenjp2-7 \
        libpango-1.0-0 \
        libpangoft2-1.0-0 \
        shared-mime-info \
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
