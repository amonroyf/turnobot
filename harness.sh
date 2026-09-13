#!/usr/bin/env bash
# Turnobot Test Harness — orquestador local unificado.
#
# Levanta emulador Firestore + backend Go + frontend Vite, corre Playwright y
# apaga todo al salir (éxito o fallo). Único comando pre-deploy para evitar
# regresiones.
#
# Uso:
#   ./harness.sh                    # Go tests + Playwright (specs locales; excluye smoke-prod)
#   ./harness.sh visual.spec.js     # solo un spec (se pasa a `playwright test`)
#   ./harness.sh smoke-prod.spec.js # explícito: sí corre contra producción (con cuidado)
#   SKIP_INSTALL=1 ./harness.sh     # no corre `npm ci` (más rápido)
#
# Requiere: go >=1.22, node >=18, firebase-tools (npx firebase), browsers
# Playwright (`cd frontend && npx playwright install chrome` una vez) y
# credenciales ADC (`gcloud auth application-default login`) para los specs
# que crean usuarios de prueba vía firebase-admin (se limpian al final).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMU_PORT="${EMU_PORT:-8090}"
BACKEND_PORT="${BACKEND_PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
EMU_LOG="$ROOT_DIR/.harness-emulator.log"
BACKEND_LOG="$ROOT_DIR/.harness-backend.log"
FRONTEND_LOG="$ROOT_DIR/.harness-frontend.log"
EMU_PID=""
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo "🧹 Apagando servicios..."
  for pid in "${FRONTEND_PID:-}" "${BACKEND_PID:-}" "${EMU_PID:-}"; do
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  rm -f "$ROOT_DIR/firebase.emu.json"
}
trap cleanup EXIT

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti:"$port" | xargs kill -9 2>/dev/null || true
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
}

wait_http() {
  local url="$1" tries="${2:-24}"
  for _ in $(seq 1 "$tries"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

echo "🚀 Iniciando Turnobot Test Harness..."

# 0. Preflight: firebase-admin necesita ADC para los specs que crean
# usuarios de prueba (crm, reglas-negocio, real-flow, admin). Sin esto fallan
# con "Could not load the default credentials".
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "⚠️  Sin credenciales ADC (gcloud auth application-default login)."
  echo "   Los specs con firebase-admin fallarán; los tests Go puros sí correrán."
fi

# 1. Limpiar puertos huérfanos de corridas anteriores
kill_port "$EMU_PORT"
kill_port "$BACKEND_PORT"
kill_port "$FRONTEND_PORT"

# 2. Emulador Firestore en segundo plano con las rules reales del repo, para
# que reglas-negocio.spec valide `firestore.rules` y no reglas abiertas.
echo "📦 Iniciando Firestore Emulator (puerto $EMU_PORT)..."
printf '{"firestore":{"rules":"firestore.rules","indexes":"firestore.indexes.json"},"emulators":{"firestore":{"port":%s},"ui":{"enabled":false}}}' "$EMU_PORT" > "$ROOT_DIR/firebase.emu.json"
(npx firebase emulators:start --only firestore --project test-turnobot --config firebase.emu.json > "$EMU_LOG" 2>&1 &) 
EMU_PID=$!
for _ in $(seq 1 30); do
  if grep -q "All emulators ready" "$EMU_LOG" 2>/dev/null; then
    break
  fi
  sleep 5
done
grep -q "All emulators ready" "$EMU_LOG" || { echo "✗ Emulador no arrancó. Ver $EMU_LOG"; exit 1; }
echo "✅ Emulador listo."

export FIRESTORE_EMULATOR_HOST="127.0.0.1:${EMU_PORT}"
export GCP_PROJECT_ID="test-turnobot"

# 3. Backend Go: build + tests unitarios/concurrencia contra emulador
echo "🐹 Ejecutando Backend Tests (Go)..."
(cd "$ROOT_DIR/backend" && go build ./... && FIRESTORE_EMULATOR_HOST="127.0.0.1:${EMU_PORT}" go test ./... -count=1)
echo "✅ Backend tests pasaron."

# 4. Backend temporal para E2E
echo "🔌 Iniciando servidor Go local (puerto $BACKEND_PORT)..."
(cd "$ROOT_DIR/backend" && PORT="$BACKEND_PORT" GCP_PROJECT_ID="test-turnobot" FIRESTORE_EMULATOR_HOST="127.0.0.1:${EMU_PORT}" nohup go run . > "$BACKEND_LOG" 2>&1 &) 
BACKEND_PID=$!
wait_http "http://localhost:${BACKEND_PORT}/health" 24 || { echo "✗ Backend no respondió. Ver $BACKEND_LOG"; exit 1; }
echo "✅ Backend E2E listo."

# 5. Frontend + Playwright
echo "🎭 Levantando frontend Vite (puerto $FRONTEND_PORT)..."
if [[ "${SKIP_INSTALL:-0}" != "1" && ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  (cd "$ROOT_DIR/frontend" && npm ci)
fi
(cd "$ROOT_DIR/frontend" && VITE_API_URL="http://localhost:${BACKEND_PORT}" nohup npm run dev -- --port "$FRONTEND_PORT" --host 127.0.0.1 > "$FRONTEND_LOG" 2>&1 &) 
FRONTEND_PID=$!
wait_http "http://localhost:${FRONTEND_PORT}" 24 || { echo "✗ Frontend no respondió. Ver $FRONTEND_LOG"; exit 1; }

echo "🎭 Ejecutando Playwright E2E..."
# API_BASE: horarios.spec.js usa prod por defecto si no se define; se apunta
# al backend local. PLAYWRIGHT_BASE_URL respeta FRONTEND_PORT custom.
# smoke-prod.spec.js pega a producción por diseño: solo corre si se pide
# explícitamente; por defecto se excluye por título ("Smoke prod").
export API_BASE="http://localhost:${BACKEND_PORT}"
export PLAYWRIGHT_BASE_URL="http://localhost:${FRONTEND_PORT}"
if [[ "$#" -eq 0 ]]; then
  (cd "$ROOT_DIR/frontend" && FIRESTORE_EMULATOR_HOST="127.0.0.1:${EMU_PORT}" VITE_API_URL="http://localhost:${BACKEND_PORT}" API_BASE="http://localhost:${BACKEND_PORT}" PLAYWRIGHT_BASE_URL="http://localhost:${FRONTEND_PORT}" npx playwright test --grep-invert "Smoke prod")
else
  (cd "$ROOT_DIR/frontend" && FIRESTORE_EMULATOR_HOST="127.0.0.1:${EMU_PORT}" VITE_API_URL="http://localhost:${BACKEND_PORT}" API_BASE="http://localhost:${BACKEND_PORT}" PLAYWRIGHT_BASE_URL="http://localhost:${FRONTEND_PORT}" npx playwright test "$@")
fi
echo "✅ Frontend E2E tests pasaron."

echo "🎉 TEST HARNESS COMPLETADO EXITOSAMENTE. LISTO PARA PRODUCCIÓN."
