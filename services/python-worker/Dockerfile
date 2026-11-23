FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHON_WORKER_PORT=8001

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r /app/requirements.txt

COPY app /app/app

RUN useradd -m -u 10001 jarvis && \
    mkdir -p /app/storage/chroma /app/storage/workspaces && \
    chown -R jarvis:jarvis /app

USER jarvis

EXPOSE 8001

HEALTHCHECK --interval=20s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8001/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
