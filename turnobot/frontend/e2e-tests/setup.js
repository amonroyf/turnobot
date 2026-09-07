import admin from 'firebase-admin';

// Usa Application Default Credentials: prioriza GOOGLE_APPLICATION_CREDENTIALS
// (necesario en CI/CD); si no existe, google-auth-library cae a la ruta
// well-known (~/.config/gcloud/application_default_credentials.json).
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'stalwart-coast-439901-d0',
  });
}

export const db = admin.firestore();
export const adminAuth = admin.auth();

const SLUG_E2E = 'tienda-e2e';

// Elimina todas las reservas de la tienda de prueba en bloques de máximo 400
// documentos (límite de batch de Firestore) para empezar con agenda vacía.
export const limpiarReservasE2E = async (slug = SLUG_E2E) => {
  const snapshot = await db.collection('reservas').where('negocio_id', '==', slug).get();
  if (snapshot.empty) return;

  for (let i = 0; i < snapshot.docs.length; i += 400) {
    const batch = db.batch();
    snapshot.docs.slice(i, i + 400).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
};

// Crea la tienda estática de pruebas (idempotente) con un servicio y un empleado
// que NO tiene Google Calendar vinculado. Así el backend usa slots mock
// deterministas y la doble reserva se detecta vía Firestore.
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

  await db
    .collection('negocios')
    .doc(slug)
    .collection('servicios')
    .doc('svc_corte_barba')
    .set({ name: 'Corte y Barba', duration_minutes: 30, price: '45000' });

  await db
    .collection('negocios')
    .doc(slug)
    .collection('empleados')
    .doc('emp_alejandro')
    .set({ name: 'Alejandro', calendar_id: '' });
};

// Inserta una reserva directamente (para el test de "Mis citas").
export const crearReservaE2E = async ({ slug = SLUG_E2E, phone, name, service, empId, dateTime }) => {
  await db.collection('reservas').add({
    negocio_id: slug,
    emp_id: empId,
    user_phone: phone,
    client_name: name,
    service_name: service,
    duration_minutes: 30,
    date_time: dateTime,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
};

// ---- Limpieza completa de entorno real (slug + usuario Auth de prueba) ----
// Borra reservas, subcolecciones, el negocio y la cuenta de Firebase Auth del
// usuario de prueba. Solo debe usarse con datos E2E (ambiente de staging).
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
  await db.collection('negocios').doc(slug).delete().catch(() => {});

  try {
    const userRecord = await adminAuth.getUserByEmail(testEmail);
    await adminAuth.deleteUser(userRecord.uid);
  } catch (err) {
    // Usuario no existente: OK. Errores por ADC sin quota project (identitytoolkit):
    // no bloquean la limpieza del entorno, solo dejan el usuario de prueba en Auth.
    if (err.code !== 'auth/user-not-found') {
      console.warn('Limpieza de usuario Auth omitida:', err.code || err.message);
    }
  }
};