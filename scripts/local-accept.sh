#!/usr/bin/env bash
# Local (non-Docker) acceptance run against real services.
# Requires: Python 3.12 venv at .venv, npm deps installed, Playwright chromium.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

# shellcheck disable=SC1091
source .venv/bin/activate

echo "===== pytest ====="
(cd api && python -m pytest)

echo "===== vitest ====="
(cd web && npx vitest run)

echo "===== starting real API on :8000 ====="
(cd api && uvicorn app.main:app --host 127.0.0.1 --port 8000) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8000/health >/dev/null 2>&1 && break
  sleep 1
done

echo "===== playwright (Vite dev proxy -> real uvicorn) ====="
(cd web && npx playwright test)

echo "LOCAL ACCEPTANCE PASSED"
