import { assertTargetReady, IS_GCP, PROJECT_ID } from './target.js';
import {
  garantizarClienteE2E,
  garantizarNegocioDemo,
  garantizarTiendaE2E,
  limpiarReservasE2E,
} from './setup.js';

export default async function globalSetup() {
  assertTargetReady();
  console.log(`[E2E] target=${IS_GCP ? 'gcp' : 'local'} proyecto=${PROJECT_ID}`);

  // Datos base de las specs. Son idempotentes y usan merge.
  await garantizarNegocioDemo();
  await garantizarTiendaE2E();
  await garantizarClienteE2E();
  await limpiarReservasE2E();
}
