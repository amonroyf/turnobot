#!/usr/bin/env bash
# Corre la colección Postman/Newman contra el backend desplegado en GCP.
# Requisitos: gcloud auth application-default login y npx (Newman se descarga).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_ID="${E2E_PROJECT_ID:-stalwart-coast-439901-d0}"
API_URL="${E2E_API_URL:-https://turnobot-850305350371.us-central1.run.app}"

export E2E_TARGET=gcp
export E2E_ALLOW_GCP=1
export E2E_PROJECT_ID="$PROJECT_ID"
export E2E_API_URL="$API_URL"

ADC="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"
if [ ! -f "$ADC" ] && [ -z "${GCE_METADATA_HOST:-}" ] && [ -z "${K_SERVICE:-}" ]; then
  echo "Falta autenticación para el Admin SDK."
  echo "Ejecutá: gcloud auth application-default login"
  exit 1
fi

echo "=== Seed GCP ==="
cd "$ROOT/frontend"
# Evita 409 preso por la reserva anterior de la colección.
node e2e-tests/clean-demo.mjs
node e2e-tests/seed-gcp.mjs

echo "=== Token de Firebase Auth ==="
cd "$ROOT/tests/api"
TOKEN="$(node get-token.mjs)"
if [ -z "$TOKEN" ]; then
  echo "No se pudo obtener idToken"
  exit 1
fi

echo "=== Newman ==="
cd "$ROOT"
npx --yes newman run tests/api/turnobot.postman_collection.json \
  -e tests/api/turnobot.gcp.postman_environment.json \
  --env-var "idToken=$TOKEN" \
  --env-var "baseUrl=$API_URL" \
  --reporters cli,json \
  --reporter-json-export newman-report.json
