import admin from 'firebase-admin';
import { garantizarTiendaE2E, limpiarReservasE2E } from './setup.js';

export default async function globalSetup() {
  await garantizarTiendaE2E();
  await limpiarReservasE2E();

  const negocioRef = admin.firestore().collection('negocios').doc('barberia-vip');
  await negocioRef.set({
    name: 'Barberia VIP Duplicada',
    owner_uid: 'e2e-owner',
    whatsapp: '',
    direccion: '',
    horario: '',
    telefono: '',
    calendar_id: 'primary',
    timezone: 'America/Bogota',
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}
