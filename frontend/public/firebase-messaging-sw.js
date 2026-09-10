// Firebase Cloud Messaging Service Worker
// Este archivo permite recibir notificaciones push aunque la pestaña esté cerrada.
// Firebase lo registra automáticamente cuando se llama a getToken().

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAr_XqzCCNvkVivrsOMd_vtm6lgZ5OSWqU',
  authDomain: 'stalwart-coast-439901-d0.firebaseapp.com',
  projectId: 'stalwart-coast-439901-d0',
  storageBucket: 'stalwart-coast-439901-d0.firebasestorage.app',
  messagingSenderId: '850305350371',
  appId: '1:850305350371:web:39bb88e72d95ebdce2e3d6',
});

const messaging = firebase.messaging();

// Manejar notificaciones en background (cuando la pestaña no está activa)
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'Turnobot';
  const body = payload.notification?.body || '';
  const icon = '/icon-192x192.png';
  const data = payload.data || {};

  self.registration.showNotification(title, {
    body,
    icon,
    data,
    badge: '/icon-192x192.png',
  });
});

// Manejar click en la notificación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  let url = '/';

  if (data.slug) {
    url = `/shop/${data.slug}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Si ya hay una ventana abierta, enfocarla
      for (const client of windowClients) {
        if (client.url.includes(data.slug || '') && 'focus' in client) {
          return client.focus();
        }
      }
      // Si no, abrir nueva ventana
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    }),
  );
});
