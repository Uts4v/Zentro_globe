"""
Django settings for Zentro Loyalty backend.

- SQLite for development (zero-config)
- PostgreSQL-ready for VPS production (set DATABASE_URL in .env)
- Native JWT auth via djangorestframework-simplejwt (no Supabase dependency)
- All Supabase functionality replicated in Django
"""

from pathlib import Path
from datetime import timedelta
import os
from dotenv import load_dotenv

load_dotenv()

# ── Paths ─────────────────────────────────────────────────────────────────────
BASE_DIR = Path(__file__).resolve().parent.parent

# ── Security ──────────────────────────────────────────────────────────────────
DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "yes")

SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-dev-key-CHANGE-THIS-in-production"
    else:
        raise RuntimeError(
            "SECRET_KEY must be set via environment variable in production."
        )

_railway_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
_allowed_hosts = os.getenv(
    "ALLOWED_HOSTS", "localhost,127.0.0.1"
).split(",")
if _railway_domain:
    _allowed_hosts.append(_railway_domain)
ALLOWED_HOSTS = [h.strip() for h in _allowed_hosts if h.strip()]

# ── Custom user model ─────────────────────────────────────────────────────────
AUTH_USER_MODEL = "accounts.User"
AUTHENTICATION_BACKENDS = [
    "accounts.authentication.EmailOrUsernameBackend",
]

# ── Installed apps ────────────────────────────────────────────────────────────
INSTALLED_APPS = [
    "unfold",                        # ← modern admin theme (before django.contrib.admin)
    "unfold.contrib.filters",        # ← Unfold sidebar filters
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "channels",                      # ← moved up
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "accounts",
    "merchants",
    "loyalty",
    "orders",
    "notifications",
    "pos",
    "ai_core",
]

# Switch from WSGI to ASGI
ASGI_APPLICATION = "config.asgi.application"

# Channel layer — RedisChannelLayer in production (REDIS_URL set),
# InMemoryChannelLayer for dev (no Redis needed).
_redis_url = os.getenv("REDIS_URL", "")

# ── Cache ─────────────────────────────────────────────────────────────────────
CACHES = {
    "default": {
        "BACKEND": (
            "django.core.cache.backends.redis.RedisCache"
            if _redis_url
            else "django.core.cache.backends.locmem.LocMemCache"
        ),
        "LOCATION": _redis_url or "unique-locmem-zone",
        "KEY_PREFIX": "zentro",
        "TIMEOUT": 300,
    }
}

if _redis_url:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [_redis_url],
                "capacity": 5000,
                "expiry": 10,
            },
        },
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        },
    }

# Used by throttle + health checks; defaults to the configured default cache.
THROTTLE_CACHE = "default"

# ── Celery (production background tasks) ──────────────────────────────────────
CELERY_BROKER_URL = _redis_url or "redis://127.0.0.1:6379/1"
CELERY_RESULT_BACKEND = CELERY_BROKER_URL if _redis_url else None
# Without a broker (no REDIS_URL) tasks run eagerly/inline — never attempt the
# unreachable localhost broker, which would stall requests with connection retries.
CELERY_TASK_ALWAYS_EAGER = (
    not _redis_url
    or os.getenv("CELERY_TASK_ALWAYS_EAGER", "False").lower() in ("true", "1", "yes")
)
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "UTC"
CELERY_TASK_TRACK_STARTED = True

# ── Slow request logging ──────────────────────────────────────────────────────
SLOW_REQUEST_THRESHOLD_SECONDS = float(os.getenv("SLOW_REQUEST_THRESHOLD_SECONDS", "1.0"))

# ── Middleware ────────────────────────────────────────────────────────────────
MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "config.middleware.RequestContextMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL = os.getenv("DATABASE_URL", "")

if DATABASE_URL:
    import urllib.parse
    url = urllib.parse.urlparse(DATABASE_URL)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": url.path[1:],
            "USER": url.username or "",
            "PASSWORD": url.password or "",
            "HOST": url.hostname or "localhost",
            "PORT": url.port or 5432,
            "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "600")),
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {
                "sslmode": os.getenv("DB_SSLMODE", "require"),
                "connect_timeout": 10,
            },
        }
    }
elif os.getenv("DB_ENGINE") == "django.db.backends.postgresql":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DB_NAME", "zentro"),
            "USER": os.getenv("DB_USER", "postgres"),
            "PASSWORD": os.getenv("DB_PASSWORD", ""),
            "HOST": os.getenv("DB_HOST", "localhost"),
            "PORT": os.getenv("DB_PORT", "5432"),
            "CONN_MAX_AGE": int(os.getenv("DB_CONN_MAX_AGE", "600")),
            "CONN_HEALTH_CHECKS": True,
            "OPTIONS": {
                "sslmode": os.getenv("DB_SSLMODE", "prefer"),
            },
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# ── Password validation ───────────────────────────────────────────────────────
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ── Internationalisation ──────────────────────────────────────────────────────
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ── Static & media files ──────────────────────────────────────────────────────
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# Whitenoise: serve collected static with compression + far-future cache headers
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ── CORS ──────────────────────────────────────────────────────────────────────
CORS_ALLOW_ALL_ORIGINS = os.getenv("CORS_ALLOW_ALL_ORIGINS", "False").lower() in ("true", "1", "yes")
_raw_cors = os.getenv(
    "CORS_ALLOWED_ORIGINS",
    "http://localhost:3000,http://localhost:5173,http://localhost:8080,http://localhost:8082",
)
CORS_ALLOWED_ORIGINS = [o.strip() for o in _raw_cors.split(",") if o.strip()]
CORS_ALLOW_CREDENTIALS = True

# ── CSRF ──────────────────────────────────────────────────────────────────────
_raw_csrf = os.getenv(
    "CSRF_TRUSTED_ORIGINS",
    "http://localhost:8000,http://localhost:5173,http://127.0.0.1:8000",
)
_csrf_origins = [o.strip() for o in _raw_csrf.split(",") if o.strip()]
if _railway_domain:
    _csrf_origins.append(f"https://{_railway_domain}")
CSRF_TRUSTED_ORIGINS = _csrf_origins

# ── HTTPS / security hardening (production only) ─────────────────────────────
if not DEBUG:
    # Railway terminates TLS and forwards via X-Forwarded-Proto
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = os.getenv("SECURE_SSL_REDIRECT", "True").lower() in ("true", "1", "yes")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "3600"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    REFERRER_POLICY = "same-origin"
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"
    SESSION_COOKIE_HTTPONLY = True
    CSRF_COOKIE_HTTPONLY = True
    SECURE_BROWSER_XSS_FILTER = True
CORS_ALLOW_HEADERS = [
    "accept",
    "accept-encoding",
    "authorization",
    "content-type",
    "dnt",
    "origin",
    "user-agent",
    "x-csrftoken",
    "x-requested-with",
    "x-pos-device-id",
    "x-pos-device-token",
]

# ── Django REST Framework ─────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
    ],
}

# ── Unfold (admin theme) ──────────────────────────────────────────────────────
UNFOLD = {
    "SITE_TITLE": "Zentro Admin",
    "SITE_HEADER": "Zentro Loyalty",
    "SITE_SYMBOLS": True,
    "SIDEBAR": {
        "show_search": True,
        "show_all_apps": True,
    },
}

# ── Simple JWT ────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(days=1) if DEBUG else timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": SECRET_KEY,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_OBTAIN_SERIALIZER": "accounts.serializers.CustomTokenObtainPairSerializer",
}

# ── Email ─────────────────────────────────────────────────────────────────────
EMAIL_BACKEND = os.getenv(
    "EMAIL_BACKEND",
    "django.core.mail.backends.console.EmailBackend",
)
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_USE_TLS = True
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "Zentro <noreply@zentro.app>")

# ── Frontend URL ──────────────────────────────────────────────────────────────
# The QR codes (tables, PDF menu) point here. Dev frontend runs on :8080.
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:8080")

# ── File upload limits ────────────────────────────────────────────────────────
DATA_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

# ── AI Core ───────────────────────────────────────────────────────────────────
AI_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
AI_DEFAULT_MODEL_ALIAS = "merchant-insights"
AI_MODEL_ALIASES = {
    "merchant-insights": {
        "provider": "groq",
        "model": os.getenv("AI_INSIGHTS_MODEL", "llama-3.1-8b-instant"),
        "capabilities": ["structured_generation"],
    },
    "fast-chat": {
        "provider": "groq",
        "model": os.getenv("AI_CHAT_MODEL", "llama-3.1-8b-instant"),
        "capabilities": ["chat"],
    },
}

# ── Rate Limiting (DRF throttling) ───────────────────────────────────────────
REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"] = [
    "rest_framework.throttling.AnonRateThrottle",
    "rest_framework.throttling.UserRateThrottle",
]
REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
    "anon": "500/hour",
    "user": "1000/day",
    "pos": "1200/hour",
    "pin": "20/min",
    "login": "10/min",
    "otp": "5/min",
    "transfer": "10/hour",
    "redeem": "10/min",
    "guest": "60/hour",
    "upload": "100/hour",
    "leaderboard": "300/hour",
}

# ── Logging ───────────────────────────────────────────────────────────────────
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "structured": {
            "format": "{asctime} [{levelname}] {name}: {message}",
            "style": "{",
        },
        "verbose": {
            "()": "config.middleware.VerboseMiddlewareFormatter",
            "format": "{asctime} [{levelname}] {name} request_id={request_id} path={path} method={method} status={status_code} duration_ms={duration_ms} user={user} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "verbose",
        },
        "console_simple": {
            "class": "logging.StreamHandler",
            "formatter": "structured",
        },
    },
    "loggers": {
        "ai_core": {"handlers": ["console_simple"], "level": "INFO", "propagate": False},
        "django.request": {"handlers": ["console"], "level": "ERROR", "propagate": False},
        "config.middleware": {"handlers": ["console"], "level": "INFO", "propagate": False},
        "django.channels.server": {"handlers": ["console"], "level": "INFO", "propagate": False},
    },
}

# ── Web Push (PWA notifications) ─────────────────────────────────────────────
# Generate once via: python manage.py generate_vapid_keys
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.getenv("VAPID_SUBJECT", "mailto:dev@zentro.local")