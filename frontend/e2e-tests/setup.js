import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'stalwart-coast-439901-d0',
  });
}

export const db = admin.firestore();
export const adminAuth = admin.auth();

export async function crearUsuarioYTema(email, nombre, slug) {
  const password = 'Clave.123';
  const userRecord = await adminAuth.createUser({ email, password, emailVerified: true });
  const uid = userRecord.uid;

  const negocioRef = db.collection('negocios').doc(slug);
  await negocioRef.set({
    name: nombre,
    owner_uid: uid,
    whatsapp: '',
    direccion: '',
    horario: '',
    telefono: '',
    calendar_id: 'primary',
    timezone: 'America/Bogota',
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { email, password };
}

export async function signInWithCustomToken(page, email, password) {
  const key = "AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU";
  await page.evaluate(async (payload) => {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${payload.key}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: payload.email, password: payload.password, returnSecureToken: true }) }
    );
    const data = await res.json();
    if (data.idToken) {
      const k = `firebase:authUser:${payload.key}:[DEFAULT]`;
      localStorage.setItem(k, JSON.stringify({
        stsTokenManager: { apiKey: payload.key, refreshToken: data.refreshToken, accessToken: data.idToken, expirationTime: Date.now() + 3600000 },
        user: { uid: data.localId, displayName: null, email: payload.email, phoneNumber: null, photoURL: null, providerData: [{ uid: data.localId, displayName: null, email: payload.email, phoneNumber: null, photoURL: null, providerId: 'password' }], providerId: 'password' }
      }));
    }
  }, { email, password, key });
}

export const E2E_PREFIX = process.env.E2E_SLUG_PREFIX || 'e2e';
export const e2eSlug = (base) => `${E2E_PREFIX}-${base}`;

const SLUG_E2E = e2eSlug('tienda');

export const limpiarReservasE2E = async (slug = SLUG_E2E) => {
  const snapshot = await db.collection('reservas').where('negocio_id', '==', slug).get();
  if (snapshot.empty) return;
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
};

export const garantizarTiendaE2E = async (slug = SLUG_E2E) => {
  const negocioRef = db.collection('negocios').doc(slug);
  await negocioRef.set(
    {
      name: 'Tienda E2E',
      owner_uid: 'e2e-owner',
      whatsapp: '',
      direccion: 'Calle de pruebas 123',
      horario: 'Lun - Sáb: 9:00 AM a 6:00 PM',
      telefono: '3000000000',
      calendar_id: 'primary',
      timezone: 'America/Bogota',
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await db.collection('negocios').doc(slug).collection('servicios').doc('svc_corte_barba').set({ name: 'Corte y Barba', duration_minutes: 30, price: '45000' });
  await db.collection('negocios').doc(slug).collection('empleados').doc('emp_alejandro').set({ name: 'Alejandro', calendar_id: '' });
};

export const crearReservaE2E = async ({ slug = SLUG_E2E, phone, name, service, empId, dateTime }) => {
  await db.collection('reservas').add({
    negocio_id: slug, emp_id: empId, user_phone: phone, client_name: name,
    service_name: service, duration_minutes: 30, date_time: dateTime,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
};

export const elegirDiaEnCalendario = async (page, yyyymmdd) => {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const hoy = new Date();
  const saltosMes = (y - hoy.getFullYear()) * 12 + (m - 1 - hoy.getMonth());
  for (let i = 0; i < saltosMes; i++) {
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
  }
  await page.getByRole('button', { name: `Elegir ${yyyymmdd}` }).click();
};

const borrarColeccion = async (ref) => {
  const snapshot = await ref.get();
  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
};

export const limpiarEntornoReal = async (slug, testEmail) => {
  await borrarColeccion(db.collection('reservas').where('negocio_id', '==', slug));
  await borrarColeccion(db.collection(`negocios/${slug}/empleados`));
  await borrarColeccion(db.collection(`negocios/${slug}/servicios`));
  await borrarColeccion(db.collection('clientes').where('negocio_id', '==', slug));
  await db.collection('negocios').doc(slug).delete().catch(() => {});
  try {
    const userRecord = await adminAuth.getUserByEmail(testEmail);
    await adminAuth.deleteUser(userRecord.uid);
  } catch (err) {
    if (err.code !== 'auth/user-not-found') {
      console.warn('Limpieza de usuario Auth omitida:', err.code || err.message);
    }
  }
};
