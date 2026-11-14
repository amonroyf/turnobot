import { assertTargetReady, IS_GCP, PROJECT_ID } from './target.js';
import { garantizarNegocioDemo, garantizarTiendaE2E } from './setup.js';

// Siembra los datos mínimos de E2E en el proyecto configurado.
// En GCP requiere E2E_TARGET=gcp E2E_ALLOW_GCP=1 y ADC.
assertTargetReady();
await garantizarNegocioDemo();
await garantizarTiendaE2E();
console.log(`[seed] target=${IS_GCP ? 'gcp' : 'local'} proyecto=${PROJECT_ID} listo`);
