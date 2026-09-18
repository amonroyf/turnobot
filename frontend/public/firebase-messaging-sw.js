// Firebase Cloud Messaging Service Worker
// Handles push notifications in the background when the app is not in focus.

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU",
  authDomain: "stalwart-coast-439901-d0.firebaseapp.com",
  projectId: "stalwart-coast-439901-d0",
  storageBucket: "stalwart-coast-439901-d0.firebasestorage.app",
  messagingSenderId: "850305350371",
  appId: "1:850305350371:web:39bb88e72d95ebdce2e3d6"
});

const messaging = firebase.messaging();

// Tomar control inmediato al actualizarse: sin esto, una pestaña siempre
// abierta seguiría controlada por el SW anterior indefinidamente.
self.skipWaiting();
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Handle background messages
// El backend envía mensajes solo-data (sin payload "notification"): el SDK
// NO muestra nada automáticamente, así que este showNotification manual es
// la ÚNICA vía de visualización (una sola notificación por mensaje).
// Si el backend volviera a enviar Webpush.Notification, NO llamar
// showNotification aquí o las notificaciones saldrían duplicadas.
// NOTA iOS: Apple solo despierta el SW en background si hay payload
// "notification"; con solo-data la PWA instalada puede no mostrar nada.
// Se mantiene solo-data (correcto en Android/desktop sin duplicar) y el
// cliente iPhone usa el .ics/Calendar/WhatsApp como respaldo.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const notificationTitle = data.title || 'Turnobot';
  const tag = data.tag || 'turnobot-notification';
  const url = data.url || '/admin';
  // Las tags fijas (nueva reserva, cancelación) reemplazan a la anterior en
  // bandeja: con renotify suenan/vibran igual, si no la 2da llegaría muda.
  // Las tags únicas por cita (recordatorios, pruebas) no reemplazan nada.
  const esFija = tag === 'new-booking' || tag === 'cancellation';
  // La acción dice a dónde lleva: no es lo mismo ver la agenda que tu cita.
  const accion = url.startsWith('/shop/') ? 'Ver mi cita'
    : url.startsWith('/employee/') ? 'Ver mis citas'
    : 'Ver agenda';
  const notificationOptions = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag,
    renotify: esFija,
    // Persistente en la bandeja hasta que el usuario la descarte.
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url },
    actions: [{ action: 'open', title: accion }]
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click - open the relevant page
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if already open
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      // Otherwise open new window
      clients.openWindow(url);
    })
  );
});
