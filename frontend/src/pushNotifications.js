import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore';
import { db, app } from './firebase';

let messaging = null;

export async function initPushNotifications() {
  if (typeof window === 'undefined') return null;
  if (!('serviceWorker' in navigator)) return null;
  
  try {
    messaging = getMessaging(app);
    return messaging;
  } catch (err) {
    console.warn('Push notifications not available:', err);
    return null;
  }
}

// Obtiene el token FCM sin guardarlo en Firestore (para el dueño)
async function getFCMToken() {
  if (!messaging) messaging = getMessaging(app);

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.log('Push permission denied');
    return null;
  }

  return getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY || '',
  });
}

// Registra el push token del DUEÑO del negocio en Firestore
export async function requestPushPermission(negocioId) {
  try {
    const token = await getFCMToken();
    if (token && negocioId) {
      await updateDoc(doc(db, 'negocios', negocioId), {
        push_token: token,
      });
      console.log('Owner push token registered:', token);
    }
    return token;
  } catch (err) {
    console.warn('Error getting push token:', err);
    return null;
  }
}

// Solicita permiso push y devuelve el token del CLIENTE (sin guardarlo en Firestore).
// El token se envía al backend al reservar para guardarlo en la cita.
export async function requestClientPushToken() {
  try {
    const token = await getFCMToken();
    if (token) {
      console.log('Client push token obtained:', token);
    }
    return token;
  } catch (err) {
    console.warn('Error getting client push token:', err);
    return null;
  }
}

// Registra el push token del cliente en el backend para una cita específica.
// Esto permite que el backend envíe recordatorios y notificaciones al cliente.
export async function registerClientPushToken(slug, token) {
  if (!slug || !token) return null;
  try {
    const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || '';
    const res = await fetch(`${API_URL}/api/v1/b/${slug}/register-client-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.success || false;
  } catch (err) {
    console.warn('Error registering client push token:', err);
    return null;
  }
}

export function listenForMessages(callback) {
  if (!messaging) return;
  
  onMessage(messaging, (payload) => {
    if (callback) callback(payload);
    else {
      alert(`${payload.notification?.title}\n${payload.notification?.body}`);
    }
  });
}
