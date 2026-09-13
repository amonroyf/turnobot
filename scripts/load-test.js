// Arnés de carga (k6) — valida caché en memoria + batching bajo estrés.
//
// Objetivo: disparar N usuarios concurrentes contra el endpoint más caliente
// (GET negocio = doc + subcolecciones, hoy servido por NegocioCache TTL 5min)
// y comprobar latencia <200ms sin errores.
//
// Uso:
//   k6 run scripts/load-test.js
//   BASE_URL=http://localhost:8080 SLUG=barberia-vip k6 run scripts/load-test.js
//   k6 run -e BASE_URL=https://turnobot-ehomyvoh6q-uc.a.run.app -e SLUG=mi-tienda scripts/load-test.js
//
// Requiere: https://k6.io/docs/get-started/installation/

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SLUG = __ENV.SLUG || 'barberia-vip';

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // rampa a 50 VUs
    { duration: '1m', target: 500 }, // pico: 500 abriendo el catálogo a la vez
    { duration: '10s', target: 0 }, // bajada
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errores
    http_req_duration: ['p(95)<500'], // p95 <500ms (caché frío + JIT incluidos)
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/b/${SLUG}`);

  check(res, {
    'status es 200': (r) => r.status === 200,
    'tiempo respuesta < 200ms': (r) => r.timings.duration < 200,
    'respuesta trae servicios': (r) => {
      try {
        const body = r.json();
        return Array.isArray(body.servicios) && Array.isArray(body.empleados);
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
