# =====================================================================
# Lydomania — Backend (FastAPI + APScheduler + watchers)
# =====================================================================
FROM python:3.11-slim AS base
WORKDIR /app/backend

# OS deps for cryptography / Pillow / curl_cffi
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libffi-dev libssl-dev libjpeg-dev zlib1g-dev \
        wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python deps (cached if requirements unchanged)
COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# Application code
COPY backend /app/backend
# Static images shipped with the build (cases / items / shares baseline)
RUN mkdir -p /app/backend/static && \
    chmod -R a+r /app/backend/static
# Also keep a pristine copy at /app/backend/_static_bundle/ that is OUTSIDE
# the `backend-static` named-volume mount point. On startup, server.py syncs
# any missing files from this bundle into the live STATIC_DIR — this
# guarantees baked-in case/item images survive named-volume initialisation
# (which overlays an EMPTY volume on top of /app/backend/static if the
# volume was reset / wiped via `docker compose down -v`).
RUN cp -a /app/backend/static /app/backend/_static_bundle && \
    chmod -R a+r /app/backend/_static_bundle

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/backend

EXPOSE 8000

# Single-process uvicorn; APScheduler + background asyncio tasks run in-process.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
