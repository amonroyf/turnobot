#!/usr/bin/env bash
# Corre la suite E2E/API contra el proyecto GCP de práctica.
#
# Requisitos:
#   1. gcloud auth application-default login
#   2. E2E_ALLOW_GCP=1 (lo exporta este script)
#
# Uso:
#   ./scripts/run-qa-gcp.sh                 # suite E2E completa (sin smoke-prod)
#   ./scripts/run-qa-gcp.sh --safe          # subconjunto de bajo riesgo
#   ./scripts/run-qa-gcp.sh --smoke         # smoke-prod explícito
#   ./scripts/run-qa-gcp.sh booking-pom.spec.js
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"

PROJECT_ID="${E2E_PROJECT_ID:-stalwart-coast-439901-d0}"
WEB_URL="${E2E_WEB_URL:-https://turnobot-web.web.app}"
API_URL="${E2E_API_URL:-https://turnobot-850305350371.us-central1.run.app}"

export E2E_TARGET=gcp
export E2E_ALLOW_GCP=1
export E2E_PROJECT_ID="$PROJECT_ID"
export E2E_WEB_URL="$WEB_URL"
export E2E_API_URL="$API_URL"

ADC="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"
if [ ! -f "$ADC" ] && [ -z "${GCE_METADATA_HOST:-}" ] && [ -z "${K_SERVICE:-}" ]; then
  echo "Falta autenticación para el Admin SDK."
  echo "Ejecutá: gcloud auth application-default login"
  exit 1
fi

case "${1:-}" in
  --safe)
    shift
    npm run test:e2e:gcp:safe -- "$@"
    ;;
  --smoke)
    shift
    npm run test:e2e:gcp:smoke -- "$@"
    ;;
  *)
    npm run test:e2e:gcp -- "$@"
    ;;
esac
