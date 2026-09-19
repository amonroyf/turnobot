import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { formatearFechaLarga, horaEnZona, sumarDias } from './fecha.js';
import useEmployeePushNotifications from './useEmployeePushNotifications.js';
import { messaging } from './firebase.js';
import { DialogoProvider, useDialogo } from './ConfirmDialog.jsx';
import { textoSobreMarca, inicialMarca, fondoMarca } from './marca.js';
import NotificationDrawer from './NotificationDrawer';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function EmployeeDashboard() {
  return (
    <DialogoProvider>
      <PortalEmpleado />
    </DialogoProvider>
  );
}

function PortalEmpleado() {
  const { confirmar, avisar } = useDialogo();
  const { slug } = useParams();
  const [empleados, setEmpleados] = useState([]);
  const [empSeleccionado, setEmpSeleccionado] = useState(null);
  const [pin, setPin] = useState('');
  const [token, setToken] = useState(null);
  const [empId, setEmpId] = useState(null);
  const [citas, setCitas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [negocio, setNegocio] = useState(null);
  const [cancelando, setCancelando] = useState('');
  const [noShowMarking, setNoShowMarking] = useState('');
  const [undoingId, setUndoingId] = useState('');

  const pushNotifications = useEmployeePushNotifications(slug, token, empId);

  // Toast en app para pushes con el portal abierto (primer plano).
  const [pushToast, setPushToast] = useState(null);
  useEffect(() => {
    const onPush = (e) => {
      const d = e.detail || {};
      setPushToast({ title: d.title || 'Aviso', body: d.body || '' });
    };
    window.addEventListener('turnobot-push', onPush);
    return () => window.removeEventListener('turnobot-push', onPush);
  }, []);
  useEffect(() => {
    if (!pushToast) return;
    const t = setTimeout(() => setPushToast(null), 8000);
    return () => clearTimeout(t);
  }, [pushToast]);

  useEffect(() => {
    const fetchNegocio = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/b/${slug}`);
        if (!res.ok) throw new Error('Negocio no encontrado');
        const data = await res.json();
        setNegocio(data);
        setEmpleados(data.empleados || []);
      } catch {
        setError('No se pudo cargar el negocio.');
      }
    };
    fetchNegocio();
  }, [slug]);

  const handleLogin = async (e) => {
    e.preventDefault();
    if (!empSeleccionado || pin.length < 4) {
      setError('Elige tu nombre y escribe tu clave de 4 a 6 números.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/employee-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emp_id: empSeleccionado, pin }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error === 'PIN incorrecto' ? 'Esa clave no coincide. Intenta de nuevo o pídela al dueño.' : (data?.error || 'No pudimos entrar. Intenta de nuevo.'));
      }
      const data = await res.json();
      setToken(data.token);
      setEmpId(data.emp_id);
      localStorage.setItem(`emp_token_${slug}`, data.token);
      localStorage.setItem(`emp_id_${slug}`, data.emp_id);
      localStorage.setItem(`emp_name_${slug}`, data.name);
      await cargarCitas(data.token, data.emp_id);
    } catch (err) {
      setError(err.message || 'Error al iniciar sesión.');
    }
    setLoading(false);
  };

  const cargarCitas = async (tok, empId) => {
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/employee/${empId}/citas`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) throw new Error('Error cargando citas');
      const data = await res.json();
      setCitas(data);
    } catch {
      setError('Error cargando tus citas.');
    }
  };

  // Sin auto-login: cada vez que se abre el link, el empleado elige su nombre y clave.

  const handleLogout = () => {
    localStorage.removeItem(`emp_token_${slug}`);
    localStorage.removeItem(`emp_id_${slug}`);
    localStorage.removeItem(`emp_name_${slug}`);
    setToken(null);
    setEmpSeleccionado(null);
    setPin('');
    setCitas([]);
  };

  const handleCancelar = async (citaId) => {
    const c = citas.find(item => item.id === citaId);
    if (!c) return;
    const ok = await confirmar({
      titulo: `¿Cancelar la cita de ${c.cliente}?`,
      consecuencia: 'El horario quedará libre.',
      confirmarTexto: 'Sí, cancelar',
      variante: 'peligro',
    });
    if (!ok) return;
    setCancelando(citaId);
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas/${citaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setCitas(prev => prev.map(item => item.id === citaId ? { ...item, cancelled: true } : item));
      } else {
        const data = await res.json().catch(() => null);
        await avisar(data?.message || 'No se pudo cancelar la cita.', 'error');
      }
    } catch {
      await avisar('No se pudo cancelar la cita.', 'error');
    }
    setCancelando('');
  };

  const handleMarcarNoShow = async (citaId) => {
    const c = citas.find(item => item.id === citaId);
    const ok = await confirmar({
      titulo: `¿${c?.cliente || 'El cliente'} no vino?`,
      detalle: 'Se marcará como "No llegó".',
      confirmarTexto: 'Marcar no llegó',
      variante: 'peligro',
    });
    if (!ok) return;
    setNoShowMarking(citaId);
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/no-show/${citaId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setCitas(prev => prev.map(item => item.id === citaId ? { ...item, no_show: true } : item));
      } else {
        const data = await res.json().catch(() => null);
        await avisar(data?.message || 'No se pudo marcar.', 'error');
      }
    } catch {
      await avisar('No se pudo marcar.', 'error');
    }
    setNoShowMarking('');
  };

  const handleUndo = async (citaId) => {
    const ok = await confirmar({
      titulo: '¿Devolver esta cita a activa?',
      detalle: 'Volverá a aparecer en tu agenda.',
      confirmarTexto: 'Devolver a activa',
      variante: 'info',
    });
    if (!ok) return;
    setUndoingId(citaId);
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas/${citaId}/undo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setCitas(prev => prev.map(item => item.id === citaId ? { ...item, cancelled: false, no_show: false } : item));
      } else {
        const data = await res.json().catch(() => null);
        await avisar(data?.message || 'No se pudo devolver.', 'error');
      }
    } catch {
      await avisar('No se pudo devolver.', 'error');
    }
    setUndoingId('');
  };

  const ahora = Date.now();
  const zonaNegocio = negocio?.timezone || 'America/Bogota';

  // Calcular fechas en la zona horaria del negocio (no en UTC)
  const fmtFecha = (d) => d.toLocaleDateString('sv-SE', { timeZone: zonaNegocio });
  const hoy = fmtFecha(new Date());
  // Aritmética sobre el string (no Date del dispositivo): inmune a TZ.
  const manana = sumarDias(hoy, 1);

  const citasHoy = citas.filter(c => c.fecha === hoy);
  const citasManana = citas.filter(c => c.fecha === manana);
  const citasProximas = citas.filter(c => c.fecha > manana);

  const [filtroEstado, setFiltroEstado] = useState('todas');

  const filtrarPorEstado = (lista) => {
    if (filtroEstado === 'activas') return lista.filter(c => !c.cancelled && !c.no_show);
    if (filtroEstado === 'canceladas') return lista.filter(c => c.cancelled);
    if (filtroEstado === 'noshow') return lista.filter(c => c.no_show);
    return lista;
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 font-sans">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase mb-2">TurnoBot</p>
          <h1 className="text-2xl font-extrabold text-gray-900">{negocio?.name || slug}</h1>
          <p className="mt-2 text-sm text-gray-500 font-semibold">Tus citas de trabajo</p>
          <p className="mt-1 text-[11px] text-gray-400 font-medium">Elige tu nombre y escribe la clave que te dio el dueño del local.</p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-6 shadow rounded-2xl border border-gray-100">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tu nombre</label>
                <select
                  value={empSeleccionado || ''}
                  onChange={(e) => setEmpSeleccionado(e.target.value)}
                  aria-label="Tu nombre en el equipo"
                  className="w-full min-h-[48px] p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  <option value="">Toca para elegir…</option>
                  {empleados.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tu clave (4 a 6 números)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  aria-label="Tu clave de acceso de 4 a 6 números"
                  className="w-full min-h-[48px] p-3.5 border border-gray-200 rounded-xl text-sm text-center tracking-[0.5em] focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
              </div>
              {error && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl text-center font-medium">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[52px] p-4 bg-black text-white font-bold rounded-xl shadow-md active:scale-95 transition-transform text-sm disabled:opacity-50"
              >
                {loading ? 'Entrando...' : 'Ver mis citas'}
              </button>
            </form>
            <p className="mt-4 text-center text-[11px] text-gray-500 font-medium">¿No tienes clave? Pídela al dueño del local: él la crea en Ajustes → Tu equipo → Clave.</p>
          </div>
        </div>
      </div>
    );
  }

  const empName = localStorage.getItem(`emp_name_${slug}`) || '';

  return (
    <div className={`${negocio?.marca?.color ? 'tema-marca ' : ''}max-w-lg mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased`} style={negocio?.marca?.color ? { '--marca': negocio.marca.color, '--sobre-marca': textoSobreMarca(negocio.marca.color) } : undefined}>      <header className="px-4 py-2.5 bg-white border-b border-gray-200 sticky top-0 z-40 flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
          style={negocio?.marca?.color
            ? { backgroundColor: negocio.marca.color, color: textoSobreMarca(negocio.marca.color) }
            : { backgroundColor: '#111', color: '#fff' }}
        >
          {inicialMarca(negocio?.name || slug)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-gray-900 leading-tight truncate">{negocio?.name || slug}</h1>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest truncate">{empName}</p>
        </div>
        {/* Toggle push notifications (suscripción) */}
        {messaging && typeof Notification !== 'undefined' && (
          pushNotifications.isSubscribed ? (
            <button
              onClick={() => pushNotifications.unsubscribe()}
              className="text-[10px] text-green-600 font-bold px-1.5"
              title="Notificaciones activas"
            >
              🟢
            </button>
          ) : pushNotifications.permission !== 'denied' ? (
            <button
              onClick={pushNotifications.subscribe}
              className="text-[10px] text-gray-400 font-bold px-1.5"
              title="Activar notificaciones"
            >
              🔔
            </button>
          ) : null
        )}
        <NotificationDrawer storageKey={`emp_${slug}`} onNotificationClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
        <button onClick={handleLogout} className="text-[11px] text-gray-400 font-semibold hover:text-gray-600 transition-colors">
          Salir
        </button>
      </header>

      {pushToast && (
        <button
          onClick={() => setPushToast(null)}
          className="mx-4 mt-3 p-4 bg-black text-white rounded-2xl shadow-lg text-left active:scale-[0.99] transition-transform"
        >
          <p className="text-sm font-bold">🔔 {pushToast.title}</p>
          {pushToast.body && <p className="text-xs opacity-80 mt-1">{pushToast.body}</p>}
        </button>
      )}

      <main className="p-4 space-y-6">
        {loading && (
          <div className="text-center py-8 text-gray-400 text-sm">Cargando tus citas...</div>
        )}

        {!loading && citas.length === 0 && (
          <div className="text-center py-12 px-6 bg-white border border-gray-200 rounded-2xl">
            <div className="text-4xl mb-3">📅</div>
            <p className="text-sm font-bold text-gray-700">Sin citas por aquí</p>
            <p className="text-xs text-gray-500 font-medium mt-1">Cuando un cliente reserve contigo, aparecerá en Hoy o Mañana.</p>
          </div>
        )}

        {!loading && citas.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar citas por estado">
            {[
              { key: 'todas', label: 'Todas', count: citas.length },
              { key: 'activas', label: 'Activas', count: citas.filter(c => !c.cancelled && !c.no_show).length },
              { key: 'canceladas', label: 'Canceladas', count: citas.filter(c => c.cancelled).length },
              { key: 'noshow', label: 'No llegó', count: citas.filter(c => c.no_show).length },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFiltroEstado(f.key)}
                aria-pressed={filtroEstado === f.key}
                className={`min-h-[44px] px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                  filtroEstado === f.key
                    ? 'bg-black text-white shadow-md'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {f.label} ({f.count})
              </button>
            ))}
          </div>
        )}

        {filtrarPorEstado(citasHoy).length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Hoy</h2>
            <div className="space-y-2">
              {filtrarPorEstado(citasHoy).map(c => (
                <CitaCard key={c.id} c={c} zona={zonaNegocio} ahora={ahora} onCancel={handleCancelar} onNoShow={handleMarcarNoShow} onUndo={handleUndo} cancelando={cancelando} noShowMarking={noShowMarking} undoingId={undoingId} />
              ))}
            </div>
          </section>
        )}

        {filtrarPorEstado(citasManana).length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Mañana</h2>
            <div className="space-y-2">
              {filtrarPorEstado(citasManana).map(c => (
                <CitaCard key={c.id} c={c} zona={zonaNegocio} ahora={ahora} onCancel={handleCancelar} onNoShow={handleMarcarNoShow} onUndo={handleUndo} cancelando={cancelando} noShowMarking={noShowMarking} undoingId={undoingId} />
              ))}
            </div>
          </section>
        )}

        {filtrarPorEstado(citasProximas).length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Próximas</h2>
            <div className="space-y-2">
              {filtrarPorEstado(citasProximas).map(c => (
                <CitaCard key={c.id} c={c} zona={zonaNegocio} ahora={ahora} onCancel={handleCancelar} onNoShow={handleMarcarNoShow} onUndo={handleUndo} cancelando={cancelando} noShowMarking={noShowMarking} undoingId={undoingId} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CitaCard({ c, zona, ahora, onCancel, onNoShow, onUndo, cancelando, noShowMarking, undoingId }) {
  const isoMs = c.iso ? new Date(c.iso).getTime() : 0;
  const isPast = isoMs < ahora;
  const isCancelled = c.cancelled === true;
  const isNoShow = c.no_show === true;
  const fechaMs = isoMs;
  // Comparar en la zona del negocio (no UTC): toISOString() adelanta el día
  // desde las 7pm en Colombia y ocultaba el botón indebidamente.
  const isToday = c.fecha === new Date(ahora).toLocaleDateString('sv-SE', { timeZone: zona });

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm ${isPast ? 'opacity-70' : 'border-gray-200'} ${isCancelled ? 'bg-red-50 border-red-200' : ''} ${isNoShow ? 'bg-amber-50 border-amber-200' : ''}`}>
      <p className="text-base font-black text-gray-900">📅 {formatearFechaLarga(c.fecha)} <span className="text-gray-500 font-bold">a las {c.hora}</span></p>
      <div className="flex justify-between items-start gap-2 mt-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-gray-800 text-sm">👤 {c.cliente}</p>
            {isCancelled && <span className="text-[10px] font-black bg-red-700 text-white px-2 py-0.5 rounded uppercase">Cancelada</span>}
            {isNoShow && <span className="text-[10px] font-black bg-amber-600 text-white px-2 py-0.5 rounded uppercase">No llegó</span>}
          </div>
          <p className="text-xs text-gray-600 font-medium mt-1">📋 {c.servicio}</p>
          {c.recurso && <p className="text-xs text-gray-600 font-medium mt-1">📍 {c.recurso}</p>}
          {(c.van || []).length > 0 && <p className="text-xs text-gray-500 mt-1">🧑‍🤝‍🧑 Van: {c.van.join(', ')}</p>}
          {c.notes && <p className="text-xs text-gray-500 italic mt-1">📝 {c.notes}</p>}
        </div>
        {c.precio > 0 && (
          <span className="text-xs font-black text-gray-900 bg-gray-100 px-2 py-1 rounded-lg shrink-0">
            ${c.precio.toLocaleString('es-CO')}
          </span>
        )}
      </div>
      {/* Acciones */}
      {!isCancelled && !isNoShow && (
        <div className="flex justify-end pt-3 mt-3 border-t border-gray-100 gap-2">
          {isPast && (
            <button
              onClick={() => onNoShow(c.id)}
              disabled={noShowMarking === c.id}
              title="Marcar que el cliente no vino"
              className="min-h-[44px] text-xs text-gray-600 font-semibold hover:text-amber-700 active:scale-95 transition-all px-4 py-2 rounded-xl border border-transparent hover:border-amber-200 hover:bg-amber-50 disabled:opacity-50"
            >
              {noShowMarking === c.id ? 'Marcando...' : 'No vino'}
            </button>
          )}
          <button
            onClick={() => onCancel(c.id)}
            disabled={cancelando === c.id}
            title="Cancelar esta cita y liberar el horario"
            className="min-h-[44px] text-xs text-red-700 font-bold active:scale-95 transition-all px-4 py-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 disabled:opacity-50"
          >
            {cancelando === c.id ? 'Cancelando…' : 'Cancelar cita'}
          </button>
        </div>
      )}
      {/* Deshacer (solo citas de hoy: el sistema no permite revivir días pasados) */}
      {(isCancelled || isNoShow) && isToday && (
        <div className="flex justify-end pt-3 mt-3 border-t border-gray-100">
          <button
            onClick={() => onUndo(c.id)}
            disabled={undoingId === c.id}
            title="Devolver la cita a activa"
            className="min-h-[44px] text-xs text-blue-700 font-bold hover:text-blue-900 active:scale-95 transition-all px-4 py-2 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
          >
            {undoingId === c.id ? 'Devolviendo…' : '↩️ Devolver a activa'}
          </button>
        </div>
      )}
    </div>
  );
}
