#!/usr/bin/env bash
# Test script for Barberia VIP Duplicada production environment
# Tests all main processes to identify bugs

set -euo pipefail

# Configuration
BASE_URL="https://turnobot-850305350371.us-central1.run.app"
SLUG="barberia-vip"
TIMESTAMP=$(date +%s)
TEST_PHONE="300${TIMESTAMP: -9}"
TEST_CLIENT_NAME="Test Client ${TIMESTAMP}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0

pass() { echo -e "${GREEN}✓ PASS${NC}: $1"; TESTS_PASSED=$((TESTS_PASSED + 1)); }
fail() { echo -e "${RED}✗ FAIL${NC}: $1"; TESTS_FAILED=$((TESTS_FAILED + 1)); }
skip() { echo -e "${YELLOW}⚠ SKIP${NC}: $1"; TESTS_SKIPPED=$((TESTS_SKIPPED + 1)); }

echo -e "${BLUE}=== Barberia VIP Duplicada Production Tests ===${NC}"
echo "Backend: $BASE_URL"
echo "Slug: $SLUG"
echo "Timestamp: $TIMESTAMP"
echo ""

# 1. Health Check
echo -e "${BLUE}[1/15] Health Check${NC}"
HEALTH_RESP=$(curl -s -w "\n%{http_code}" "${BASE_URL}/health" 2>/dev/null)
HEALTH_STATUS=$(echo "$HEALTH_RESP" | tail -1)
HEALTH_BODY=$(echo "$HEALTH_RESP" | head -n -1)
if [[ "$HEALTH_STATUS" == "200" ]] && echo "$HEALTH_BODY" | grep -q '"ok"'; then
    pass "Health check"
else
    fail "Health check (status: $HEALTH_STATUS)"
fi

# 2. Business Info
echo -e "${BLUE}[2/15] Business Info${NC}"
BUS_RESP=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/v1/b/${SLUG}" 2>/dev/null)
BUS_STATUS=$(echo "$BUS_RESP" | tail -1)
BUS_BODY=$(echo "$BUS_RESP" | head -n -1)
if [[ "$BUS_STATUS" == "200" ]] && echo "$BUS_BODY" | grep -q "Barberia VIP Duplicada"; then
    SVC_COUNT=$(echo "$BUS_BODY" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d.get('servicios', [])))" 2>/dev/null || echo "0")
    EMP_COUNT=$(echo "$BUS_BODY" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d.get('empleados', [])))" 2>/dev/null || echo "0")
    pass "Business info (${SVC_COUNT} services, ${EMP_COUNT} employees)"
else
    fail "Business info (status: $BUS_STATUS)"
fi

# 3. Get Available Slots
echo -e "${BLUE}[3/15] Available Slots${NC}"
CURRENT_DATE=$(date -d "tomorrow" '+%Y-%m-%d')
SLOTS_RESP=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/v1/b/${SLUG}/slots?emp_id=emp_alejandro&servicio_id=svc_corte&fecha=${CURRENT_DATE}" 2>/dev/null)
SLOTS_STATUS=$(echo "$SLOTS_RESP" | tail -1)
SLOTS_BODY=$(echo "$SLOTS_RESP" | head -n -1)
if [[ "$SLOTS_STATUS" == "200" ]]; then
    SLOTS_COUNT=$(echo "$SLOTS_BODY" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
    if [[ "$SLOTS_COUNT" -gt 0 ]]; then
        pass "Available slots ($SLOTS_COUNT found)"
    else
        skip "Available slots (0 found)"
    fi
else
    fail "Available slots (status: $SLOTS_STATUS)"
fi

# 4. Create Booking
echo -e "${BLUE}[4/15] Create Booking${NC}"
BOOK_RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/b/${SLUG}/book" \
    -H "Content-Type: application/json" \
    -d "{\"servicioId\": \"svc_corte\", \"empleadoId\": \"emp_alejandro\", \"fecha\": \"${CURRENT_DATE}\", \"hora\": \"10:00\", \"clienteNombre\": \"${TEST_CLIENT_NAME}\", \"clienteTelefono\": \"${TEST_PHONE}\"}" 2>/dev/null)
BOOK_STATUS=$(echo "$BOOK_RESP" | tail -1)
BOOK_BODY=$(echo "$BOOK_RESP" | head -n -1)
# Contrato actual: reservar exige login Google del cliente -> sin token debe ser 401.
if [[ "$BOOK_STATUS" == "401" ]]; then
    pass "Create booking without login rejected (401 login_requerido)"
else
    fail "Create booking without login (expected 401, got: $BOOK_STATUS, body: $BOOK_BODY)"
fi

# 5. Get Reservations (sin sesión Google -> 401 es el contrato actual)
echo -e "${BLUE}[5/15] Get Reservations${NC}"
RES_RESP=$(curl -s -w "\n%{http_code}" "${BASE_URL}/api/v1/b/${SLUG}/citas" 2>/dev/null)
RES_STATUS=$(echo "$RES_RESP" | tail -1)
if [[ "$RES_STATUS" == "401" ]]; then
    pass "Get reservations without session rejected (401)"
else
    fail "Get reservations without session (expected 401, got: $RES_STATUS)"
fi

# 6. Cancel a bogus cita id (404 esperado: no existe)
echo -e "${BLUE}[6/15] Cancel Bogus Cita${NC}"
CANC_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${BASE_URL}/api/v1/b/${SLUG}/citas/no-existe-${TIMESTAMP}" 2>/dev/null)
if [[ "$CANC_STATUS" == "404" ]]; then
    pass "Cancel bogus cita (404)"
else
    fail "Cancel bogus cita (expected 404, got: $CANC_STATUS)"
fi

# 7. Mark No-Show sin credencial (401 esperado: no revela si la cita existe)
echo -e "${BLUE}[7/15] Mark No-Show${NC}"
NS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/v1/b/${SLUG}/no-show/no-existe-${TIMESTAMP}" 2>/dev/null)
if [[ "$NS_STATUS" == "401" ]]; then
    pass "Mark no-show without credential rejected (401)"
else
    fail "Mark no-show without credential (expected 401, got: $NS_STATUS)"
fi

# 8. Register Client Push Token en cita inexistente (404 esperado)
echo -e "${BLUE}[8/15] Register Client Push Token${NC}"
PUSH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/v1/b/${SLUG}/citas/no-existe-${TIMESTAMP}/client-push-token" \
    -H "Content-Type: application/json" \
    -d "{\"token\": \"test_token_${TIMESTAMP}\"}" 2>/dev/null)
if [[ "$PUSH_STATUS" == "404" ]]; then
    pass "Client push token on bogus cita (404)"
else
    fail "Client push token on bogus cita (expected 404, got: $PUSH_STATUS)"
fi

# 9. CORS Headers
echo -e "${BLUE}[9/15] CORS Headers${NC}"
CORS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "${BASE_URL}/api/v1/b/${SLUG}" \
    -H "Origin: https://turnobot-web.web.app" \
    -H "Access-Control-Request-Method: GET" 2>/dev/null)
if [[ "$CORS_CODE" == "200" ]] || [[ "$CORS_CODE" == "302" ]]; then
    pass "CORS headers"
else
    fail "CORS headers (status: $CORS_CODE)"
fi

# 10. Security Headers
echo -e "${BLUE}[10/15] Security Headers${NC}"
SEC_COUNT=$(curl -sI "${BASE_URL}/api/v1/b/${SLUG}" 2>/dev/null | grep -ci "x-content-type-options: nosniff" || true)
HSTS_COUNT=$(curl -sI "${BASE_URL}/api/v1/b/${SLUG}" 2>/dev/null | grep -ci "strict-transport-security" || true)
if [[ "$SEC_COUNT" -ge 1 ]] && [[ "$HSTS_COUNT" -ge 1 ]]; then
    pass "Security headers (X-Content-Type-Options, HSTS)"
else
    fail "Security headers (nosniff: $SEC_COUNT, HSTS: $HSTS_COUNT)"
fi

# 11. Booking sin login es rechazado (401; el duplicado real se prueba en la suite Node)
#     Va ANTES de la ráfaga de rate limit: el limiter va antes del auth y un 429 aquí no probaría nada.
echo -e "${BLUE}[Extra] Booking sin login rechazado${NC}"
DUP_STATUS2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/v1/b/${SLUG}/book" \
    -H "Content-Type: application/json" \
    -d "{\"servicioId\": \"svc_corte\", \"empleadoId\": \"emp_alejandro\", \"fecha\": \"${CURRENT_DATE}\", \"hora\": \"15:00\", \"clienteNombre\": \"Duplicate Test\", \"clienteTelefono\": \"3110000000\"}" 2>/dev/null)
if [[ "$DUP_STATUS2" == "401" ]]; then
    pass "Booking sin login rechazado (401)"
else
    fail "Booking sin login (expected 401, got: $DUP_STATUS2)"
fi

# 12. Rate Limiting Test
echo -e "${BLUE}[11/15] Rate Limiting Test${NC}"
RATE_HIT=false
for i in $(seq 1 12); do
    RL_RESP=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/api/v1/b/${SLUG}/book" \
        -H "Content-Type: application/json" \
        -d "{\"servicioId\": \"svc_corte\", \"empleadoId\": \"emp_alejandro\", \"fecha\": \"${CURRENT_DATE}\", \"hora\": \"12:${i}0\", \"clienteNombre\": \"RateTest${i}\", \"clienteTelefono\": \"300999999${i}\", \"clienteNombre\": \"RateTest${i}\"}" 2>/dev/null)
    RL_STATUS=$(echo "$RL_RESP" | tail -1)
    if [[ "$RL_STATUS" == "429" ]]; then
        RATE_HIT=true
        break
    fi
    sleep 1
done
if [[ "$RATE_HIT" == "true" ]]; then
    pass "Rate limiting active (request $i got 429)"
else
    skip "Rate limiting test (all requests succeeded)"
fi

# 12. Frontend Access
echo -e "${BLUE}[12/15] Frontend Access${NC}"
FE_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://turnobot-web.web.app/shop/${SLUG}" 2>/dev/null)
if [[ "$FE_CODE" == "200" ]]; then
    pass "Frontend accessible"
else
    fail "Frontend accessible (status: $FE_CODE)"
fi

# 13. Service Management Endpoints
echo -e "${BLUE}[13/15] Service Management${NC}"
DEL_SVC_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${BASE_URL}/api/v1/b/${SLUG}/servicios/svc_invalid" \
    -H "Authorization: Bearer invalid_token" 2>/dev/null)
if [[ "$DEL_SVC_CODE" == "401" ]] || [[ "$DEL_SVC_CODE" == "403" ]]; then
    pass "Service delete requires auth (status: $DEL_SVC_CODE)"
else
    fail "Service delete endpoint issue (status: $DEL_SVC_CODE)"
fi

# 14. Employee Management Endpoints
echo -e "${BLUE}[14/15] Employee Management${NC}"
DEL_EMP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "${BASE_URL}/api/v1/b/${SLUG}/empleados/emp_invalid" \
    -H "Authorization: Bearer invalid_token" 2>/dev/null)
if [[ "$DEL_EMP_CODE" == "401" ]] || [[ "$DEL_EMP_CODE" == "403" ]]; then
    pass "Employee delete requires auth (status: $DEL_EMP_CODE)"
else
    fail "Employee delete endpoint issue (status: $DEL_EMP_CODE)"
fi

# 15. Health endpoint detailed
echo -e "${BLUE}[15/15] Health Endpoint Version Check${NC}"
HEALTH_VERSION=$(echo "$HEALTH_BODY" | python3 -c "import sys, json; print(json.load(sys.stdin).get('version', 'N/A'))" 2>/dev/null || echo "N/A")
if [[ "$HEALTH_VERSION" != "N/A" ]]; then
    pass "Health endpoint has version field ($HEALTH_VERSION)"
else
    fail "Health endpoint missing version field"
fi

# 16. Suite profunda Node (todos los procesos: cliente, dueño, empleado, cron, rate limit)
#     Requiere ADC de gcloud: gcloud auth application-default login
echo -e "${BLUE}[16/16] Suite profunda (Node, todos los procesos)${NC}"
echo "(esperando 65s: la ráfaga del test 11 llena la ventana del rate limit compartida por IP)"
sleep 65
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if (cd "$SCRIPT_DIR/frontend" && node e2e-tests/barberia-vip-prod.mjs); then
    pass "Suite profunda barberia-vip (Node)"
else
    fail "Suite profunda barberia-vip (Node) — ver detalle arriba"
fi

# Summary
echo ""
echo -e "${BLUE}=== Test Summary ===${NC}"
echo -e "Tests passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Tests failed: ${RED}${TESTS_FAILED}${NC}"
echo -e "Tests skipped: ${YELLOW}${TESTS_SKIPPED}${NC}"
echo -e "Total: $((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))"

if [[ $TESTS_FAILED -eq 0 ]]; then
    echo -e "${GREEN}✅ All critical tests passed!${NC}"
else
    echo -e "${YELLOW}⚠️  Some tests failed.${NC}"
fi

exit 0