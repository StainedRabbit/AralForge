import os
from urllib.parse import parse_qsl, urlparse

from pathlib import Path


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
        }

    raise RuntimeError(f'Unsupported DATABASE_URL scheme: {parsed.scheme}')


# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


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

CORS_ALLOWED_ORIGINS = env_list(
    'CORS_ALLOWED_ORIGINS',
    default=['http://localhost:5173', 'http://127.0.0.1:5173'],
)

CSRF_TRUSTED_ORIGINS = env_list('CSRF_TRUSTED_ORIGINS')


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
    'accounts',
    'subjects',
    'learning_modules',
    'assessments',
    'attendance',
    'grades.apps.GradesConfig',
    'coding',
    'gamification',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
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

DATABASES = {
    'default': database_config(os.getenv('DATABASE_URL'), BASE_DIR / 'db.sqlite3')
}


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

STATIC_URL = os.getenv('STATIC_URL', 'static/')
STATIC_ROOT = os.getenv('STATIC_ROOT', BASE_DIR / 'staticfiles')

MEDIA_URL = os.getenv('MEDIA_URL', '/media/')
MEDIA_ROOT = os.getenv('MEDIA_ROOT', BASE_DIR / 'media')

AUTH_USER_MODEL = 'accounts.User'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
    ),
}


if not DEBUG:
    if SECRET_KEY == 'django-insecure-dev-only-change-me-before-production':
        raise RuntimeError('SECRET_KEY must be set when DEBUG=False.')
    if not ALLOWED_HOSTS:
        raise RuntimeError('ALLOWED_HOSTS must be set when DEBUG=False.')

    SESSION_COOKIE_SECURE = env_bool('SESSION_COOKIE_SECURE', default=True)
    CSRF_COOKIE_SECURE = env_bool('CSRF_COOKIE_SECURE', default=True)
    SECURE_SSL_REDIRECT = env_bool('SECURE_SSL_REDIRECT', default=True)
    SECURE_HSTS_SECONDS = int(os.getenv('SECURE_HSTS_SECONDS', '31536000'))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool(
        'SECURE_HSTS_INCLUDE_SUBDOMAINS',
        default=True,
    )
    SECURE_HSTS_PRELOAD = env_bool('SECURE_HSTS_PRELOAD', default=True)
