// Prueba de carga básica con k6.
// Instalar k6: https://k6.io/docs/get-started/installation/
// Ejecutar: k6 run tests/perf/load.js -e BASE_URL=http://localhost:8080 -e SLUG=mi-negocio
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 10 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const SLUG = __ENV.SLUG || 'mi-negocio';

export default function () {
  const res = http.get(`${BASE}/api/v1/b/${SLUG}`);
  check(res, { 'status 200': (r) => r.status === 200 });
  sleep(1);
}