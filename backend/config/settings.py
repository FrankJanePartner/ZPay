import os
from pathlib import Path
import dj_database_url
from corsheaders.defaults import default_headers

BASE_DIR = Path(__file__).resolve().parent.parent
DEBUG = os.environ.get("ZPAY_DEBUG", "0") == "1"
SECRET_KEY = os.environ.get("ZPAY_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise RuntimeError("Set ZPAY_SECRET_KEY; use ZPAY_DEBUG=1 only for local development.")
    SECRET_KEY = "local-development-only-do-not-deploy"
ALLOWED_HOSTS = os.environ.get("ZPAY_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "corsheaders", "rest_framework", "drf_spectacular", "drf_spectacular_sidecar", "django.contrib.staticfiles", "payments"]
MIDDLEWARE = [
    "config.middleware.NoStoreApiMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
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
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
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
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
CSRF_COOKIE_SECURE = True
CORS_ALLOWED_ORIGINS = [
    item.strip()
    for item in os.environ.get(
        "ZPAY_CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173" if DEBUG else "",
    ).split(",") if item.strip()
]
CORS_ALLOW_CREDENTIALS = False
CORS_ALLOW_HEADERS = [*default_headers, "idempotency-key"]
CORS_EXPOSE_HEADERS = ["Retry-After"]

TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates", "APP_DIRS": True}]
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
SPECTACULAR_SETTINGS = {
    "TITLE": "ZPay API",
    "VERSION": "1.0.0",
    "DESCRIPTION": """Zcash payment requests for Private Bill and other integrations.

Quick start: register or log in, copy the returned dashboard token into **Authorize**
(paste the token only), then create an API key. Replace the dashboard token in Authorize
with that API key to create and read payment requests. Dashboard tokens expire after
12 hours. API keys can access payments but cannot manage keys or log out.

Amounts are integer strings in zatoshis: 100000000 zatoshis = 1 ZEC.
A request lasts 60–1800 seconds after address allocation. Expiry closes the payment
window; it does not erase the blockchain address or funds. Never reuse an address
for another payment. Keep the same Idempotency-Key and payload when retrying.

Current scope: registration, credentials and receiving-address allocation.
Run sync_wallets to update deposit history and balances from complete wallet scans.
Check balance.stale before using observations. Webhooks and settlement remain unavailable.
Payment status describes the request window; use received totals and deposit history for funds.
Examples use fictional credentials and an illustrative address; do not send funds to examples.
""",
    "SERVE_INCLUDE_SCHEMA": False,
    "SWAGGER_UI_DIST": "SIDECAR",
    "SWAGGER_UI_FAVICON_HREF": "SIDECAR",
    "SWAGGER_UI_SETTINGS": {"deepLinking": True, "persistAuthorization": False, "displayRequestDuration": True},
}
