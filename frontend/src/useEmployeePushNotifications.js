import { useState, useEffect, useCallback } from 'react';
import { getToken, onMessage, deleteToken } from 'firebase/messaging';
import { messaging } from './firebase';

/**
 * Hook para gestionar suscripción a push notifications para empleados.
 * Usa el token de empleado (no Firebase Auth) para registrar el token FCM.
 *
 * @param {string} slug - ID del negocio
 * @param {string} empToken - Token de autenticación del empleado
 * @param {string} empId - ID del empleado
 * @returns {{ permission: string, isSubscribed: boolean, subscribe: () => Promise<void>, unsubscribe: () => void }}
 */
export default function useEmployeePushNotifications(slug, empToken, empId) {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    if (!slug || !empToken || !empId || !messaging) return;
    const savedToken = localStorage.getItem(`emp_fcm_${slug}_${empId}`);
    if (savedToken) {
      setIsSubscribed(true);
    }
  }, [slug, empToken, empId]);

  // Primer plano: el SW solo muestra en background; se emite evento para
  // que la UI muestre un toast (no crear Notification aquí: duplicaría).
  useEffect(() => {
    if (!messaging) return;
    const unsubscribe = onMessage(messaging, (payload) => {
      window.dispatchEvent(new CustomEvent('turnobot-push', { detail: payload?.data || {} }));
    });
    return () => unsubscribe();
  }, []);

  const subscribe = useCallback(async () => {
    if (!messaging) {
      console.warn('Firebase Messaging no soportado');
      return;
    }
    try {
      const currentPermission = await Notification.requestPermission();
      setPermission(currentPermission);
      if (currentPermission !== 'granted') return;

      const fcmToken = await getToken(messaging, {
        vapidKey: undefined
      });

      if (fcmToken) {
        setIsSubscribed(true);
        localStorage.setItem(`emp_fcm_${slug}_${empId}`, fcmToken);

        const apiBase = import.meta.env.VITE_API_URL || '';
        await fetch(`${apiBase}/api/v1/b/${slug}/employee/${empId}/register-push-token`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${empToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token: fcmToken })
        });
      }
    } catch (err) {
      console.error('Error al suscribirse a push:', err);
    }
  }, [slug, empToken, empId]);

  // Baja real: borra el token en el backend y lo invalida en FCM para que
  // deje de llegar push a este dispositivo (antes solo borraba localStorage).
  const unsubscribe = useCallback(async () => {
    try {
      if (slug && empToken && empId) {
        const apiBase = import.meta.env.VITE_API_URL || '';
        await fetch(`${apiBase}/api/v1/b/${slug}/employee/${empId}/push-token`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${empToken}` }
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
      setIsSubscribed(false);
      if (slug && empId) {
        localStorage.removeItem(`emp_fcm_${slug}_${empId}`);
      }
    }
  }, [slug, empToken, empId]);

  return { permission, isSubscribed, subscribe, unsubscribe };
}
