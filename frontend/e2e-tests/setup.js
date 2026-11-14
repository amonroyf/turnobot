import admin from 'firebase-admin';
import {
  API_BASE,
  FIREBASE_API_KEY,
  FIREBASE_AUTH_DOMAIN,
  IS_GCP,
  PROJECT_ID,
  WEB_BASE,
} from './target.js';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
}

export const db = admin.firestore();
export const adminAuth = admin.auth();
export { API_BASE, IS_GCP, PROJECT_ID, WEB_BASE };

export const CLIENTE_E2E = {
  email: process.env.E2E_CLIENT_EMAIL || 'cliente-e2e@turnobot.test',
  password: process.env.E2E_CLIENT_PASSWORD || 'Clave.123',
};

// Cliente que usa el embudo público (booking.spec.js, demo-reserva.spec.js,
// multi-tenant.spec.js). El backend exige login para confirmar una cita.
export async function garantizarClienteE2E() {
  try {
    const user = await adminAuth.getUserByEmail(CLIENTE_E2E.email);
    await adminAuth.updateUser(user.uid, { password: CLIENTE_E2E.password });
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    await adminAuth.createUser({
      email: CLIENTE_E2E.email,
      password: CLIENTE_E2E.password,
      emailVerified: true,
    });
  }
}

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
    cancel_window_hours: 0,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { email, password };
}

export async function signInWithCustomToken(page, email, password) {
  const key = FIREBASE_API_KEY;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) },
  );
  const data = await res.json();
  if (!res.ok || !data.idToken) throw new Error(`Firebase demo login failed: ${data.error?.message || 'AUTH_FAILED'}`);
  await page.addInitScript(({ apiKey, authData }) => {
    const storageKey = `firebase:authUser:${apiKey}:[DEFAULT]`;
    localStorage.setItem(storageKey, JSON.stringify({
      stsTokenManager: { apiKey, refreshToken: authData.refreshToken, accessToken: authData.idToken, expirationTime: Date.now() + Number(authData.expiresIn || 3600) * 1000 },
      user: { uid: authData.localId, displayName: null, email: authData.email, phoneNumber: null, photoURL: null, providerData: [{ uid: authData.localId, displayName: null, email: authData.email, phoneNumber: null, photoURL: null, providerId: 'password' }], providerId: 'password' },
    }));
  }, { apiKey: key, authData: data });
  await page.reload();
}

// Login real dentro de la página con el SDK modular (misma config del
// bundle): escribe la persistencia IndexedDB que la app sí reconoce. Reemplaza
// a signInWithCustomToken, cuya inyección por localStorage ya no funciona.
export async function signInEnPagina(page, email, password) {
  await page.evaluate(
    async ({ email: userEmail, password: userPassword, cfg }) => {
      const { initializeApp, getApps, getApp } = await import(
        'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'
      );
      const { getAuth, signInWithEmailAndPassword } = await import(
        'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'
      );
      const app = getApps().length ? getApp() : initializeApp(cfg);
      await signInWithEmailAndPassword(getAuth(app), userEmail, userPassword);
    },
    {
      email,
      password,
      cfg: {
        apiKey: FIREBASE_API_KEY,
        authDomain: FIREBASE_AUTH_DOMAIN,
        projectId: PROJECT_ID,
      },
    },
  );
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
      open_time: '09:00',
      close_time: '18:00',
      cancel_window_hours: 0,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // La tienda E2E tiene un solo servicio para que el snapshot visual sea
  // estable. El servicio anterior se elimina si quedó de una corrida vieja.
  const servicios = negocioRef.collection('servicios');
  await servicios.doc('svc_consulta').delete().catch(() => {});
  await servicios.doc('svc_corte').set(
    { name: 'Corte y Barba', duration_minutes: 30, price: '45000' },
    { merge: true },
  );
  await negocioRef
    .collection('empleados')
    .doc('emp_alejandro')
    .set({ name: 'Alejandro', calendar_id: '' }, { merge: true });
};

// Datos mínimos de la tienda pública que usan booking-pom.spec.js,
// demo-reserva.spec.js y demo-admin.spec.js. Se puede correr varias veces:
// usa merge y conserva el owner_uid existente.
export const garantizarNegocioDemo = async (slug = 'mi-negocio') => {
  const negocioRef = db.collection('negocios').doc(slug);
  const actual = await negocioRef.get();
  const ownerUid = actual.data()?.owner_uid || 'e2e-owner';

  await negocioRef.set(
    {
      name: 'Mi Negocio Demo',
      owner_uid: ownerUid,
      whatsapp: '573001234567',
      direccion: 'Calle 123 # 45-67, Bogotá',
      horario: 'Lun - Sáb: 9:00 AM a 7:00 PM',
      telefono: '3001234567',
      calendar_id: 'primary',
      timezone: 'America/Bogota',
      open_time: '09:00',
      close_time: '18:00',
      booking_window_days: 60,
      max_bookings_per_phone_per_day: 3,
      cancel_window_hours: 0,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const servicios = negocioRef.collection('servicios');
  await servicios
    .doc('svc_consulta')
    .set({ name: 'Consulta General', duration_minutes: 30, price: '30000' }, { merge: true });
  await servicios
    .doc('svc_corte')
    .set({ name: 'Corte y Barba', duration_minutes: 30, price: '45000' }, { merge: true });

  const empleados = negocioRef.collection('empleados');
  await empleados
    .doc('emp_alejandro')
    .set({ name: 'Alejandro', calendar_id: 'primary' }, { merge: true });
  await empleados
    .doc('emp_carlos')
    .set({ name: 'Carlos', calendar_id: 'primary' }, { merge: true });
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

// Limpia un negocio de prueba sin tocar usuarios de Auth. Útil para specs
// que crean varias tiendas (multi-tenant, horarios).
export const limpiarNegocioE2E = async (slug) => {
  await borrarColeccion(db.collection('reservas').where('negocio_id', '==', slug));
  await borrarColeccion(db.collection('clientes').where('negocio_id', '==', slug));
  await borrarColeccion(db.collection(`negocios/${slug}/empleados`));
  await borrarColeccion(db.collection(`negocios/${slug}/servicios`));
  await db.collection('negocios').doc(slug).delete().catch(() => {});
};
