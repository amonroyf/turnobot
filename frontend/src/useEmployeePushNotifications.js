import { useState, useEffect, useCallback } from 'react';
import { getToken, onMessage } from 'firebase/messaging';
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

  useEffect(() => {
    if (!messaging) return;
    const unsubscribe = onMessage(messaging, () => {});
    return () => unsubscribe();
  }, [slug]);

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

  const unsubscribe = useCallback(() => {
    setIsSubscribed(false);
    if (slug && empId) {
      localStorage.removeItem(`emp_fcm_${slug}_${empId}`);
    }
  }, [slug, empId]);

  return { permission, isSubscribed, subscribe, unsubscribe };
}
