#!/usr/bin/env bash
# Ejecuta la suite QA completa.
#
# Modo por defecto: GCP de práctica (E2E contra servicios desplegados, ADC requerida).
# Modo local: emulador Firestore/Auth + backend/frontend locales (PRs, TDD).
#
# Uso:
#   ./scripts/run-qa.sh                 # GCP
#   ./scripts/run-qa.sh --gcp           # GCP explícito
#   ./scripts/run-qa.sh --local         # emulador
#
# La integración Go solo corre contra GCP si definís GCP_TEST_PROJECT_ID
# (proyecto dedicado de pruebas). Requiere además ADC y borra únicamente
# documentos con prefijo `test-` y usuarios @test.com al terminar.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="gcp"

case "${1:-}" in
  --local)
    MODE="local"
    shift
    ;;
  --gcp)
    shift
    ;;
esac

if [[ "$MODE" == "local" ]]; then
  # Compatibilidad con el archivo de entorno que usaba el script anterior.
  if [[ -f /tmp/turnobot.env ]]; then
    set -a
    # shellcheck disable=SC1091
    source /tmp/turnobot.env 2>/dev/null || true
    set +a
  fi
  : "${FIRESTORE_EMULATOR_HOST:?Modo local: falta FIRESTORE_EMULATOR_HOST (ej. 127.0.0.1:8090)}"
  : "${FIREBASE_AUTH_EMULATOR_HOST:?Modo local: falta FIREBASE_AUTH_EMULATOR_HOST (ej. 127.0.0.1:9098)}"
  export GCP_PROJECT_ID="${QA_GCP_PROJECT_ID:-demo-test}"
  echo "=== Modo LOCAL (emulador, proyecto $GCP_PROJECT_ID) ==="
else
  ADC="${GOOGLE_APPLICATION_CREDENTIALS:-$HOME/.config/gcloud/application_default_credentials.json}"
  if [[ ! -f "$ADC" && -z "${GCE_METADATA_HOST:-}" && -z "${K_SERVICE:-}" ]]; then
    echo "Falta autenticación para GCP. Ejecutá: gcloud auth application-default login" >&2
    exit 1
  fi

  # Evita mezclar credenciales reales con hosts de emulador.
  unset FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST

  export E2E_TARGET=gcp
  export E2E_ALLOW_GCP=1
  export E2E_PROJECT_ID="${E2E_PROJECT_ID:-stalwart-coast-439901-d0}"
  echo "=== Modo GCP (proyecto ${E2E_PROJECT_ID}) ==="
  echo "    E2E/API escriben datos de práctica en ese proyecto."
fi

echo "=== Backend (Go) ==="
cd "$ROOT/backend"
if [[ "$MODE" == "local" ]]; then
  go test ./... -count=1 -coverprofile=coverage.out
else
  if [[ -n "${GCP_TEST_PROJECT_ID:-}" ]]; then
    echo "Integración Go contra GCP (proyecto ${GCP_TEST_PROJECT_ID}); limpieza al final."
    GCP_TEST_ALLOW_WRITES=1 go test ./... -count=1 -coverprofile=coverage.out
  else
    echo "GCP_TEST_PROJECT_ID no definido: la integración Go se omite y solo corren las unitarias."
    go test ./... -count=1 -coverprofile=coverage.out
  fi
fi
go tool cover -func=coverage.out | tail -3

echo "=== Frontend (Vitest) ==="
cd "$ROOT/frontend"
npm run test

echo "=== E2E (Playwright) ==="
if [[ "$MODE" == "local" ]]; then
  npm run test:e2e:local
else
  npm run test:e2e:gcp
fi

echo "=== DONE ==="
