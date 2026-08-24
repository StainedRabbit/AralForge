import os
import re
from urllib.parse import parse_qsl, urlparse

from pathlib import Path


# Keep local development configuration in the ignored project-root .env file.
# Hosted environments do not include this file and continue to use platform
# environment variables.
BASE_DIR = Path(__file__).resolve().parent.parent


def load_env_file(path):
    if not path.is_file():
        return

    for raw_line in path.read_text(encoding='utf-8-sig').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].lstrip()

        name, separator, value = line.partition('=')
        name = name.strip()
        if not separator or not name or not name.replace('_', '').isalnum():
            continue

        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        # Explicit process/platform variables take precedence over local .env
        # values so hosted settings cannot be replaced by a checked-out file.
        os.environ.setdefault(name, value)


if os.getenv('RENDER', '').strip().lower() != 'true':
    load_env_file(BASE_DIR.parent / '.env')


def env_bool(name, default=False):
    value = os.getenv(name)

    if value is None:
        return default

    return value.strip().lower() in {'1', 'true', 'yes', 'on'}


def env_list(name, default=None):
    value = os.getenv(name)

    if not value:
        return default or []

    return [item.strip() for item in value.split(',') if item.strip()]


def env_origin_list(name, default=None):
    origins = env_list(name, default)

    for origin in origins:
        parsed = urlparse(origin)
        try:
            parsed.port
        except ValueError as error:
            raise RuntimeError(f'{name} contains an invalid origin: {origin}') from error

        if (
            parsed.scheme not in {'http', 'https'}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.params
            or parsed.query
            or parsed.fragment
            or '*' in origin
        ):
            raise RuntimeError(f'{name} must contain exact HTTP(S) origins: {origin}')

    return origins


def env_regex_list(name):
    patterns = env_list(name)

    for pattern in patterns:
        try:
            re.compile(pattern)
        except re.error as error:
            raise RuntimeError(f'{name} contains an invalid regular expression: {pattern}') from error

    return patterns


def append_unique(values, value):
    normalized = (value or '').strip()
    if normalized and normalized not in values:
        values.append(normalized)


def database_config(database_url, sqlite_path):
    if not database_url:
        return {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': sqlite_path,
        }

    parsed = urlparse(database_url)

    if parsed.scheme in {'sqlite', 'sqlite3'}:
        return {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': parsed.path.lstrip('/') or sqlite_path,
        }

    if parsed.scheme in {'postgres', 'postgresql'}:
        return {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': parsed.path.lstrip('/'),
            'USER': parsed.username or '',
            'PASSWORD': parsed.password or '',
            'HOST': parsed.hostname or '',
            'PORT': str(parsed.port or ''),
            'OPTIONS': dict(parse_qsl(parsed.query)),
            'CONN_MAX_AGE': int(os.getenv('DB_CONN_MAX_AGE', '60')),
            'CONN_HEALTH_CHECKS': True,
        }

    raise RuntimeError(f'Unsupported DATABASE_URL scheme: {parsed.scheme}')


def require_production_values(names):
    missing = [name for name in names if not os.getenv(name)]
    if missing:
        raise RuntimeError(
            'Missing required production environment variables: '
            + ', '.join(sorted(missing))
        )


# Quick-start development settings - unsuitable for production
# See https://docs.djangoproject.com/en/6.0/howto/deployment/checklist/

# SECURITY WARNING: keep the secret key used in production secret.
SECRET_KEY = os.getenv(
    'SECRET_KEY',
    'django-insecure-dev-only-change-me-before-production',
)

# SECURITY WARNING: don't run with debug turned on in production.
DEBUG = env_bool('DEBUG', default=True)

ALLOWED_HOSTS = env_list('ALLOWED_HOSTS')
render_hostname = os.getenv('RENDER_EXTERNAL_HOSTNAME')
if not render_hostname:
    render_hostname = urlparse(os.getenv('RENDER_EXTERNAL_URL', '')).hostname
if not render_hostname and os.getenv('RENDER_SERVICE_TYPE') == 'web':
    render_service_name = os.getenv('RENDER_SERVICE_NAME', '').strip()
    if render_service_name:
        render_hostname = f'{render_service_name}.onrender.com'
append_unique(ALLOWED_HOSTS, render_hostname)
append_unique(ALLOWED_HOSTS, os.getenv('RAILWAY_PUBLIC_DOMAIN'))

CORS_ALLOWED_ORIGINS = env_origin_list(
    'CORS_ALLOWED_ORIGINS',
    default=['http://localhost:5173', 'http://127.0.0.1:5173'],
)
CORS_ALLOWED_ORIGIN_REGEXES = env_regex_list('CORS_ALLOWED_ORIGIN_REGEXES')

CSRF_TRUSTED_ORIGINS = env_origin_list('CSRF_TRUSTED_ORIGINS')


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'corsheaders',
    'storages',
    'accounts',
    'subjects',
    'learning_modules',
    'assessments',
    'attendance',
    'grades.apps.GradesConfig',
    'coding',
    'gamification',
    'overview',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'config.middleware.RequestTimingMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# Database
# https://docs.djangoproject.com/en/6.0/ref/settings/#databases

DATABASE_URL = os.getenv('DATABASE_URL', '')
DATABASES = {'default': database_config(DATABASE_URL, BASE_DIR / 'db.sqlite3')}


# Password validation
# https://docs.djangoproject.com/en/6.0/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
# https://docs.djangoproject.com/en/6.0/topics/i18n/

LANGUAGE_CODE = 'en-us'

TIME_ZONE = 'UTC'

USE_I18N = True

USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.0/howto/static-files/

STATIC_URL = os.getenv('STATIC_URL', '/static/')
STATIC_ROOT = os.getenv('STATIC_ROOT', BASE_DIR / 'staticfiles')

MEDIA_URL = os.getenv('MEDIA_URL', '/media/')
MEDIA_ROOT = os.getenv('MEDIA_ROOT', BASE_DIR / 'media')

SUPABASE_STORAGE_ENV_VARS = (
    'SUPABASE_S3_ENDPOINT',
    'SUPABASE_S3_REGION',
    'SUPABASE_S3_ACCESS_KEY_ID',
    'SUPABASE_S3_SECRET_ACCESS_KEY',
    'SUPABASE_STORAGE_BUCKET',
)
USE_SUPABASE_STORAGE = all(os.getenv(name) for name in SUPABASE_STORAGE_ENV_VARS)

STORAGES = {
    'default': {
        'BACKEND': 'django.core.files.storage.FileSystemStorage',
    },
    'staticfiles': {
        'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage',
    },
}

if USE_SUPABASE_STORAGE:
    STORAGES['default'] = {
        'BACKEND': 'storages.backends.s3.S3Storage',
        'OPTIONS': {
            'access_key': os.environ['SUPABASE_S3_ACCESS_KEY_ID'],
            'secret_key': os.environ['SUPABASE_S3_SECRET_ACCESS_KEY'],
            'bucket_name': os.environ['SUPABASE_STORAGE_BUCKET'],
            'endpoint_url': os.environ['SUPABASE_S3_ENDPOINT'],
            'region_name': os.environ['SUPABASE_S3_REGION'],
            'addressing_style': 'path',
            'signature_version': 's3v4',
            'default_acl': None,
            'querystring_auth': True,
            'querystring_expire': int(
                os.getenv('SUPABASE_STORAGE_SIGNED_URL_SECONDS', '3600')
            ),
            'file_overwrite': False,
        },
    }

AUTH_USER_MODEL = 'accounts.User'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
    'DEFAULT_PAGINATION_CLASS': 'config.pagination.AralForgeLimitOffsetPagination',
    'DEFAULT_FILTER_BACKENDS': ('config.filters.AralForgeQueryFilterBackend',),
    'PAGE_SIZE': 50,
}

CORS_EXPOSE_HEADERS = ['Server-Timing', 'X-Response-Time-Ms']


if not DEBUG:
    if SECRET_KEY == 'django-insecure-dev-only-change-me-before-production':
        raise RuntimeError('SECRET_KEY must be set when DEBUG=False.')
    if not ALLOWED_HOSTS:
        raise RuntimeError('ALLOWED_HOSTS must be set when DEBUG=False.')
    require_production_values((
        'DATABASE_URL',
        'CORS_ALLOWED_ORIGINS',
        'CSRF_TRUSTED_ORIGINS',
        *SUPABASE_STORAGE_ENV_VARS,
    ))
    if urlparse(DATABASE_URL).scheme not in {'postgres', 'postgresql'}:
        raise RuntimeError('Production DATABASE_URL must use PostgreSQL.')

    SESSION_COOKIE_SECURE = env_bool('SESSION_COOKIE_SECURE', default=True)
    CSRF_COOKIE_SECURE = env_bool('CSRF_COOKIE_SECURE', default=True)
    SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', default=True)
    SECURE_HSTS_SECONDS = int(os.getenv('SECURE_HSTS_SECONDS', '31536000'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
        'SECURE_HSTS_INCLUDE_SUBDOMAINS',
        default=True,
    )
    SECURE_HSTS_PRELOAD = env_bool('SECURE_HSTS_PRELOAD', default=True)
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    # Hosted health probes must reach the database check even when the platform's
    # internal request arrives over plain HTTP.
    SECURE_REDIRECT_EXEMPT = [r'^api/health/$']


LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {
        'console': {'class': 'logging.StreamHandler'},
    },
    'loggers': {
        'django': {'handlers': ['console'], 'level': 'INFO'},
        'aralforge.performance': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}
