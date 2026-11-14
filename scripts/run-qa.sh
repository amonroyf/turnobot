#!/usr/bin/env bash
# Ejecuta toda la suite QA local (backend + frontend + E2E).
# Requiere: emulador Firestore/Auth levantado y backend corriendo.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Backend (Go) ==="
cd "$ROOT/backend"
set -a; source /tmp/turnobot.env 2>/dev/null || true; set +a
# El emulador usa --project demo-test; Auth y Firestore deben coincidir.
export GCP_PROJECT_ID="${QA_GCP_PROJECT_ID:-demo-test}"
go test ./... -count=1 -coverprofile=coverage.out
go tool cover -func=coverage.out | tail -3

echo "=== Frontend (Vitest) ==="
cd "$ROOT/frontend"
npm run test

echo "=== E2E (Playwright) ==="
cd "$ROOT/frontend"
npx playwright test

echo "=== DONE ==="