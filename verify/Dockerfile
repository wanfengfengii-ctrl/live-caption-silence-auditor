# One-off acceptance image.
# Pinned to the Playwright release used by web/package.json so the
# preinstalled browser revision matches @playwright/test exactly.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-venv python3-pip curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH

WORKDIR /work

# Backend dependencies (FastAPI stack + pytest/httpx).
COPY api/requirements.txt /work/api/requirements.txt
RUN pip install --no-cache-dir -r /work/api/requirements.txt

# Application + test sources.
COPY api /work/api
COPY web /work/web

# Frontend dependencies (Playwright browsers are already in the base image).
WORKDIR /work/web
RUN npm ci

COPY verify/accept.sh /usr/local/bin/accept.sh
RUN chmod +x /usr/local/bin/accept.sh

CMD ["accept.sh"]
