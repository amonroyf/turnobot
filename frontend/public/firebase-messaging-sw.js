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

// Handle background messages
// El backend envía mensajes solo-data (sin payload "notification"): el SDK
// NO muestra nada automáticamente, así que este showNotification manual es
// la ÚNICA vía de visualización (una sola notificación por mensaje).
// Si el backend volviera a enviar Webpush.Notification, NO llamar
// showNotification aquí o las notificaciones saldrían duplicadas.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const notificationTitle = data.title || 'Turnobot';
  const notificationOptions = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    // Tag fijo por tipo de evento: una nueva reserva reemplaza la anterior
    // en vez de apilarse en la bandeja de notificaciones.
    tag: data.tag || 'turnobot-notification',
    renotify: false,
    vibrate: [200, 100, 200],
    data: { url: data.url || '/admin' },
    actions: [{ action: 'open', title: 'Ver agenda' }]
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
