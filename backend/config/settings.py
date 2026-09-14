import os
from pathlib import Path
import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get("ZPAY_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("ZPAY_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("Set ZPAY_SECRET_KEY; use ZPAY_DEBUG=1 only for local development.")
    SECRET_KEY = "local-development-only-do-not-deploy"
ALLOWED_HOSTS = os.environ.get("ZPAY_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "rest_framework", "payments"]
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware"]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
DATABASES = {"default": dj_database_url.config(default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}")}
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 12}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["payments.auth.BearerAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.AnonRateThrottle", "rest_framework.throttling.UserRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {"anon": "30/min", "user": "120/min"},
}
# The Rust service is a private dependency; no caller-supplied URL is accepted.
WALLET_SERVICE_URL = os.environ.get("ZPAY_WALLET_URL", "")
WALLET_SERVICE_TOKEN = os.environ.get("ZPAY_WALLET_TOKEN", "")
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_SSL_REDIRECT = not DEBUG
