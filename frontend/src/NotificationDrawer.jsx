import { useState, useEffect, useCallback } from 'react';

/**
 * NotificationDrawer: Campanita + panel lateral con historial de notificaciones.
 * Almacena las notificaciones que llegan en primer plano (via onMessage) y las
 * muestra en un drawer deslizante desde la derecha. Persiste en localStorage
 * para que no se pierdan al recargar.
 *
 * @param {Object} props
 * @param {string} props.storageKey - Clave de localStorage para persistir (ej. 'admin' o 'emp_{id}')
 * @param {Function} props.onNotificationClick - Callback al tocar una notificación (ej. navegar a Agenda)
 */
export default function NotificationDrawer({ storageKey = 'turnobot', onNotificationClick }) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState(() => {
    try {
      const saved = localStorage.getItem(`notifications_${storageKey}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Contador de no leídas
  const unreadCount = notifications.filter(n => !n.read).length;

  // Persistir cuando cambien las notificaciones
  useEffect(() => {
    try {
      localStorage.setItem(`notifications_${storageKey}`, JSON.stringify(notifications.slice(0, 50)));
    } catch {}
  }, [notifications, storageKey]);

  // Escuchar pushes en primer plano y agregarlos al historial
  useEffect(() => {
    const onPush = (e) => {
      const d = e.detail || {};
      if (!d.title) return;
      const newNotif = {
        id: Date.now().toString(),
        title: d.title,
        body: d.body || '',
        url: d.url || '',
        tag: d.tag || '',
        read: false,
        timestamp: new Date().toISOString(),
      };
      setNotifications(prev => [newNotif, ...prev].slice(0, 50));
    };
    window.addEventListener('turnobot-push', onPush);
    return () => window.removeEventListener('turnobot-push', onPush);
  }, []);

  const markAsRead = useCallback((id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setIsOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  // Formatear tiempo relativo
  const tiempoRelativo = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'Ahora';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return `${Math.floor(diff / 86400000)}d`;
  };

  // Icono según tag
  const iconoTag = (tag) => {
    if (tag === 'new-booking') return '📅';
    if (tag === 'cancellation') return '❌';
    if (tag === 'no-show') return '⚠️';
    if (tag === 'undo') return '↩️';
    if (tag === 'push-test') return '🧪';
    if (tag === 'emp-reminder' || tag?.startsWith('emp-reminder')) return '⏰';
    if (tag === 'reminder') return '⏰';
    return '🔔';
  };

  const handleNotifClick = (notif) => {
    markAsRead(notif.id);
    setIsOpen(false);
    // Navegar a la vista relevante (Agenda para admin/empleado)
    onNotificationClick?.();
  };

  return (
    <>
      {/* Botón Campanita */}
      <button
        onClick={() => { setIsOpen(true); markAllRead(); }}
        className="relative min-h-[44px] min-w-[44px] flex items-center justify-center"
        aria-label={`Notificaciones${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ''}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-gray-600">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[9px] font-black rounded-full px-1 shadow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-50 transition-opacity"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Drawer Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-sm bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? 'translate-x-0 animate-slide-in' : 'translate-x-full'
        }`}
      >
        {/* Header del Drawer */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-gray-900">Notificaciones</h2>
            {unreadCount > 0 && (
              <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">
                {unreadCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {notifications.length > 0 && (
              <button
                onClick={clearAll}
                className="text-[11px] text-gray-400 font-medium hover:text-red-500 transition-colors"
              >
                Limpiar
              </button>
            )}
            <button
              onClick={() => setIsOpen(false)}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-gray-400 hover:text-gray-600"
              aria-label="Cerrar notificaciones"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Lista de Notificaciones */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-8 text-center">
              <div className="text-4xl mb-3 opacity-50">🔔</div>
              <p className="text-sm font-medium text-gray-400">Sin notificaciones</p>
              <p className="text-xs text-gray-300 mt-1">Las alertas de nuevas reservas aparecerán aquí</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  className={`w-full text-left px-5 py-4 transition-colors active:bg-gray-50 ${
                    notif.read ? 'bg-white' : 'bg-blue-50/40'
                  }`}
                >
                  <div className="flex gap-3 items-start">
                    <span className="text-lg shrink-0 mt-0.5">
                      {iconoTag(notif.tag)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-sm leading-tight ${notif.read ? 'font-medium text-gray-700' : 'font-bold text-gray-900'}`}>
                          {notif.title}
                        </p>
                        <span className="text-[10px] text-gray-400 font-medium shrink-0 mt-0.5">
                          {tiempoRelativo(notif.timestamp)}
                        </span>
                      </div>
                      {notif.body && (
                        <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">
                          {notif.body}
                        </p>
                      )}
                    </div>
                    {!notif.read && (
                      <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0 mt-2" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 shrink-0">
          <p className="text-[10px] text-gray-300 text-center font-medium">
            {notifications.length > 0 ? `Mostrando ${Math.min(notifications.length, 50)} notificaciones` : 'TurnoBot'}
          </p>
        </div>
      </div>
    </>
  );
}
