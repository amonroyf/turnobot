import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Entorno de ejecución de Playwright.
//
// E2E_TARGET=gcp (default): proyecto real de práctica
// (stalwart-coast-439901-d0) y servicios desplegados en Firebase Hosting /
// Cloud Run. Es el modo principal de la suite.
// E2E_TARGET=local: emulador Firestore/Auth + backend/frontend locales.
// Se usa para PRs, TDD y como fallback cuando no hay ADC.
//
// El modo GCP exige E2E_ALLOW_GCP=1 para que no se active por accidente.
export const TARGET = process.env.E2E_TARGET || 'gcp';
export const IS_GCP = TARGET === 'gcp';

// El emulador se inicia con `--project demo-test`; el Admin SDK, el backend y
// el token de Auth deben usar el mismo project ID o el `aud` no coincide.
export const PROJECT_ID =
  process.env.E2E_PROJECT_ID || (IS_GCP ? 'stalwart-coast-439901-d0' : 'demo-test');
export const GCP_WEB_URL = process.env.E2E_WEB_URL || 'https://turnobot-web.web.app';
export const GCP_API_URL =
  process.env.E2E_API_URL || 'https://turnobot-850305350371.us-central1.run.app';
export const LOCAL_WEB_URL = process.env.E2E_LOCAL_WEB_URL || 'http://localhost:5173';
export const LOCAL_API_URL = process.env.E2E_LOCAL_API_URL || 'http://localhost:8080';

export const WEB_BASE = process.env.PLAYWRIGHT_BASE_URL || (IS_GCP ? GCP_WEB_URL : LOCAL_WEB_URL);
export const API_BASE = process.env.API_BASE || (IS_GCP ? GCP_API_URL : LOCAL_API_URL);

// Config pública de Firebase (la misma que usa el frontend).
export const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY || 'AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU';
export const FIREBASE_AUTH_DOMAIN =
  process.env.FIREBASE_AUTH_DOMAIN || `${PROJECT_ID}.firebaseapp.com`;

const ADC_PATH = join(
  process.env.HOME || '',
  '.config/gcloud/application_default_credentials.json',
);

export function assertTargetReady() {
  if (IS_GCP) {
    if (process.env.E2E_ALLOW_GCP !== '1') {
      throw new Error(
        'Modo GCP bloqueado. Ejecutá con E2E_ALLOW_GCP=1 (o usá npm run test:e2e:gcp).',
      );
    }

    const emuladores = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].filter(
      (key) => process.env[key],
    );
    if (emuladores.length) {
      throw new Error(
        `Modo GCP con variables de emulador activas: ${emuladores.join(', ')}. ` +
          'Después de probar en local, quitá esas variables de la terminal antes de correr contra GCP.',
      );
    }

    const adc = process.env.GOOGLE_APPLICATION_CREDENTIALS || ADC_PATH;
    const hayMetadata =
      Boolean(process.env.GCE_METADATA_HOST) || Boolean(process.env.K_SERVICE);
    if (!existsSync(adc) && !hayMetadata) {
      throw new Error(
        `Falta autenticación para el Admin SDK. Ejecutá:\n` +
          `  gcloud auth application-default login\n` +
          `y volvé a correr la suite. También podés definir GOOGLE_APPLICATION_CREDENTIALS.`,
      );
    }
    return;
  }

  const faltantes = ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].filter(
    (key) => !process.env[key],
  );
  if (faltantes.length) {
    throw new Error(
      `Modo local sin emulador: faltan ${faltantes.join(', ')}. ` +
        'Exportá las variables del emulador o quitá E2E_TARGET=local para usar GCP.',
    );
  }
}
