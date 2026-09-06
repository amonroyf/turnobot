import admin from 'firebase-admin';

// Usa Application Default Credentials (gcloud auth application-default login).
// Sin firebase.json de entorno: google-auth-library lee la ruta well-known
// (~/.config/gcloud/application_default_credentials.json) o GOOGLE_APPLICATION_CREDENTIALS.
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'stalwart-coast-439901-d0' });
}

export const db = admin.firestore();

const SLUG_E2E = 'tienda-e2e';

// Elimina todas las reservas de la tienda de prueba para empezar con agenda vacía.
export const limpiarReservasE2E = async (slug = SLUG_E2E) => {
  const snapshot = await db.collection('reservas').where('negocio_id', '==', slug).get();
  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
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