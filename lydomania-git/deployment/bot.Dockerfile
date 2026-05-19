# =====================================================================
# Lydomania — Telegram bot worker (aiogram long-polling)
# Reuses the same image layout as backend (shared code).
# =====================================================================
FROM python:3.11-slim
WORKDIR /app/backend

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc libffi-dev libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

COPY backend /app/backend

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/backend

CMD ["python", "-m", "bot.run"]
