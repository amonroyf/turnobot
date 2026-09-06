import { garantizarTiendaE2E, limpiarReservasE2E } from './setup.js';

export default async function globalSetup() {
  await garantizarTiendaE2E();
  await limpiarReservasE2E();
}