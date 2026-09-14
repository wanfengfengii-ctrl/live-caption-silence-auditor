#!/usr/bin/env bash
# One-off acceptance run:
#   1. wait for the real API and Web containers
#   2. prove the browser-visible path Web -> /api proxy -> API is live
#   3. run the backend adjudication suite (pytest)
#   4. run the real browser integration suite (Playwright)
# Exits non-zero on the first failing layer.
set -euo pipefail

API_URL="${API_URL:-http://api:8000}"
WEB_URL="${WEB_URL:-http://web}"

wait_for() {
  local name="$1" url="$2" matcher="$3"
  echo "[verify] waiting for ${name} at ${url} ..."
  for _ in $(seq 1 60); do
    if curl -fsS "$url" 2>/dev/null | grep -q "$matcher"; then
      echo "[verify]   ${name} is ready"
      return 0
    fi
    sleep 2
  done
  echo "[verify] ERROR: ${name} did not become ready at ${url}" >&2
  return 1
}

wait_for "API" "${API_URL}/health" '"status":"ok"'
wait_for "Web" "${WEB_URL}/" "<div id=\"root\"></div>"

# Real integration path used by the browser: nginx proxies /api to the API.
echo "[verify] checking Web -> API proxy (/health) ..."
curl -fsS "${WEB_URL}/health" | grep -q '"status":"ok"'
echo "[verify]   proxy OK"

echo
echo "========== pytest (backend adjudication boundaries) =========="
cd /work/api
python3 -m pytest -q

echo
echo "========== Playwright (real browser end-to-end) =========="
cd /work/web
WEB_URL="${WEB_URL}" npx playwright test --reporter=list

echo
echo "[verify] ALL ACCEPTANCE CHECKS PASSED"
