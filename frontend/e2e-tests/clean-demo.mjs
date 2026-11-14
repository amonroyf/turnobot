import { assertTargetReady } from './target.js';
import { limpiarReservasE2E } from './setup.js';

// Limpia reservas de la tienda demo para que la colección de API pueda
// reservar el mismo horario en corridas repetidas. No borra el negocio ni
// sus servicios/empleados.
assertTargetReady();
await limpiarReservasE2E('mi-negocio');
console.log('[clean-demo] reservas de mi-negocio eliminadas');
