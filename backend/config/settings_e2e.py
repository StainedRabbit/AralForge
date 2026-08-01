import os

os.environ['DEBUG'] = '1'

from .settings import *  # noqa: E402,F403


E2E_TESTING = True
DEBUG = True
ALLOWED_HOSTS = ['127.0.0.1', 'localhost']
CORS_ALLOWED_ORIGINS = ['http://127.0.0.1:4173', 'http://localhost:4173']
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'e2e.sqlite3',  # noqa: F405
    },
}
MEDIA_ROOT = BASE_DIR / 'e2e_media'  # noqa: F405
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
