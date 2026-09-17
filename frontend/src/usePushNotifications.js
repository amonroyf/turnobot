import { useState, useEffect, useCallback } from 'react';
import { getToken, onMessage, deleteToken } from 'firebase/messaging';
import { messaging, auth } from './firebase';

/**
 * Hook para gestionar suscripción a push notifications con Firebase Cloud Messaging.
 *
 * @param {string} negocioId - ID del negocio (se usa como tag para las notificaciones)
 * @returns {{ permission: string, isSubscribed: boolean, subscribe: () => Promise<void>, unsubscribe: () => void }}
 */
export default function usePushNotifications(negocioId) {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [token, setToken] = useState(null);

  // Verificar si ya hay un token guardado en localStorage
  useEffect(() => {
    if (!negocioId || !messaging) return;
    const savedToken = localStorage.getItem(`fcm_token_${negocioId}`);
    if (savedToken) {
      setToken(savedToken);
      setIsSubscribed(true);
    }
  }, [negocioId]);

  // Mensajes con la app en primer plano: el service worker solo muestra en
  // background, así que aquí NO se crea Notification (sería duplicado).
  // Se emite un evento para que la UI muestre un toast en la app.
  useEffect(() => {
    if (!messaging) return;
    const unsubscribe = onMessage(messaging, (payload) => {
      window.dispatchEvent(new CustomEvent('turnobot-push', { detail: payload?.data || {} }));
    });
    return () => unsubscribe();
  }, []);

  const subscribe = useCallback(async () => {
    if (!messaging) {
      console.warn('Firebase Messaging no soportado en este navegador');
      return;
    }
    try {
      const currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== 'granted') return;

      const fcmToken = await getToken(messaging, {
        vapidKey: undefined // Using default FCM VAPID key from Firebase project
      });

      if (fcmToken) {
        setToken(fcmToken);
        setIsSubscribed(true);
        localStorage.setItem(`fcm_token_${negocioId}`, fcmToken);

        // Registrar token en el backend
        const user = auth.currentUser;
        if (user) {
          const apiBase = import.meta.env.VITE_API_URL || '';
          const idToken = await user.getIdToken();
          await fetch(`${apiBase}/api/v1/b/${negocioId}/register-push-token`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${idToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ token: fcmToken })
          });
        }
      }
    } catch (err) {
      console.error('Error al suscribirse a push:', err);
    }
  }, [negocioId]);

  // Baja real: invalida el token en FCM y lo elimina del backend para que
  // deje de llegar push a ESTE dispositivo (antes solo borraba localStorage
  // y el servidor seguía enviando).
  const unsubscribe = useCallback(async () => {
    try {
      const user = auth.currentUser;
      if (user && negocioId) {
        const apiBase = import.meta.env.VITE_API_URL || '';
        const idToken = await user.getIdToken();
        await fetch(`${apiBase}/api/v1/b/${negocioId}/push-token`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${idToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token })
        });
      }
      if (messaging) {
        try {
          await deleteToken(messaging);
        } catch {
          // Si FCM ya lo invalidó, igual se limpia el resto.
        }
      }
    } catch (err) {
      console.error('Error al desactivar notificaciones:', err);
    } finally {
      setToken(null);
      setIsSubscribed(false);
      if (negocioId) {
        localStorage.removeItem(`fcm_token_${negocioId}`);
      }
    }
  }, [negocioId, token]);

  return { permission, isSubscribed, token, subscribe, unsubscribe };
}
