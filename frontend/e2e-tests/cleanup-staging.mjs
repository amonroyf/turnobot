import admin from 'firebase-admin';

// Limpieza de datos de pruebas (staging) en Firestore.
// Borra negocios, subcolecciones, reservas y clientes cuyos slugs usan el
// prefijo e2e (ver E2E_SLUG_PREFIX en setup.js). Los usuarios de Auth se
// borran por test vía limpiarEntornoReal (no se pueden listar por slug).
//
// Uso:
//   node e2e-tests/cleanup-staging.mjs                 # dry-run (solo muestra)
//   node e2e-tests/cleanup-staging.mjs --yes           # ejecuta
//   node e2e-tests/cleanup-staging.mjs --yes --include-legacy  # + prefijos viejos
//   E2E_SLUG_PREFIX=qa node e2e-tests/cleanup-staging.mjs --yes
//
// NUNCA toca slugs fuera del prefijo (negocios reales como peluqueriarisos).

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'stalwart-coast-439901-d0',
  });
}
const db = admin.firestore();

const PREFIX = process.env.E2E_SLUG_PREFIX || 'e2e';
const YES = process.argv.includes('--yes');
const LEGACY = process.argv.includes('--include-legacy');

// Prefijos históricos de pruebas (anteriores al aislamiento con prefijo).
const LEGACY_PREFIXES = [
  'tienda-e2e',
  'tienda-horarios-',
  'tienda-alfa',
  'tienda-beta',
  'tienda-debug-',
  'reglas-',
  'horarios',
  'eptest',
  'smokeprod',
  'barberia-qa-',
  'cliente-qa-',
  'barberia-prod-',
];

const matchSlug = (id) =>
  id === PREFIX ||
  id.startsWith(`${PREFIX}-`) ||
  (LEGACY && LEGACY_PREFIXES.some((p) => id === p || id.startsWith(p)));

async function borrarColeccion(ref) {
  const snap = await ref.get();
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += 400) {
    if (YES) {
      const batch = db.batch();
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    n += Math.min(400, snap.docs.length - i);
  }
  return n;
}

const negociosRefs = await db.collection('negocios').listDocuments();
const objetivos = negociosRefs.map((r) => r.id).filter(matchSlug);
console.log(`Prefijo: "${PREFIX}"${LEGACY ? ' + legacy' : ''} | negocios e2e: ${objetivos.length}`);
if (!YES) console.log('(dry-run: agrega --yes para borrar)');

let reservas = 0;
let clientes = 0;
for (const slug of objetivos) {
  console.log(`- ${slug}`);
  reservas += await borrarColeccion(db.collection('reservas').where('negocio_id', '==', slug));
  clientes += await borrarColeccion(db.collection('clientes').where('negocio_id', '==', slug));
  if (YES) {
    for (const sub of ['empleados', 'servicios']) {
      await borrarColeccion(db.collection(`negocios/${slug}/${sub}`));
    }
    await db.collection('negocios').doc(slug).delete().catch(() => {});
  }
}
console.log(`reservas: ${reservas} | clientes: ${clientes} ${YES ? '(borrados)' : '(por borrar)'}`);
