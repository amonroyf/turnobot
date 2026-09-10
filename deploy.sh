#!/usr/bin/env bash
# Despliegue completo de Turnobot a Google Cloud (backend + frontend).
#
# Requisitos:
#   - gcloud autenticado como owner/editor del proyecto stalwart-coast-439901-d0
#   - Archivo YAML con las variables de entorno del backend
#     (p.ej. /tmp/opencode/env_full.yaml). No se versiona por contener secretos.
#
# Uso:
#   ENV_FILE=/ruta/a/env_full.yaml ./deploy.sh
#   ENV_FILE=... ./deploy.sh only-frontend   # solo Hosting
#   ENV_FILE=... ./deploy.sh only-backend    # solo Cloud Run

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$DIR/backend"
FRONTEND_DIR="$DIR/frontend"
PROJECT="stalwart-coast-439901-d0"
REGION="us-central1"
SERVICE="turnobot"
SITE_O="turnobot-web"
SA="850305350371-compute@developer.gserviceaccount.com"
API_URL="https://turnobot-ehomyvoh6q-uc.a.run.app"

ENV_FILE="${ENV_FILE:-/tmp/opencode/env_full.yaml}"
MODE="${1:-both}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ No existe el archivo de entorno: $ENV_FILE"
  echo "  Copia el YAML de variables del backend a esa ruta o pasa ENV_FILE=..."
  exit 1
fi

if ! gcloud config get-value account >/dev/null 2>&1; then
  echo "✗ gcloud no autenticado. Ejecuta: gcloud auth login"
  exit 1
fi

deploy_backend() {
  echo "== Cloud Run: $SERVICE =="
  gcloud run deploy "$SERVICE" \
    --source "$BACKEND_DIR" \
    --region "$REGION" \
    --platform managed \
    --service-account "$SA" \
    --env-vars-file "$ENV_FILE" \
    --allow-unauthenticated \
    --memory 512Mi \
    --cpu 1 \
    --concurrency 80 \
    --timeout 300 \
    --port 8080 \
    --min-instances 0 \
    --max-instances 20 \
    --cpu-throttling \
    --no-cpu-boost \
    --quiet
}

deploy_frontend() {
  echo "== Build frontend =="
  (cd "$FRONTEND_DIR" && VITE_API_URL="$API_URL" VITE_FIREBASE_VAPID_KEY="${VITE_FIREBASE_VAPID_KEY:-}" npm run build)

  echo "== Firebase Hosting: $SITE_O =="
  export TOKEN="$(gcloud auth print-access-token)"
  SITE="$SITE_O" node "$DIR/scripts/deploy-hosting.mjs"
}

case "$MODE" in
  both)
    deploy_backend
    deploy_frontend
    ;;
  only-backend) deploy_backend ;;
  only-frontend) deploy_frontend ;;
  *)
    echo "Modo desconocido: $MODE (both | only-backend | only-frontend)"
    exit 1
    ;;
esac

echo "✓ Despliegue completado"