import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { formatearFechaLarga, horaEnZona, sumarDias } from './fecha.js';
import useEmployeePushNotifications from './useEmployeePushNotifications.js';
import { messaging } from './firebase.js';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function EmployeeDashboard() {
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
      setError('Selecciona tu nombre e ingresa tu PIN.');
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
        throw new Error(data?.error || 'PIN incorrecto');
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

  useEffect(() => {
    const savedToken = localStorage.getItem(`emp_token_${slug}`);
    const savedEmpId = localStorage.getItem(`emp_id_${slug}`);
    const savedName = localStorage.getItem(`emp_name_${slug}`);
    if (savedToken && savedEmpId) {
      setToken(savedToken);
      setEmpId(savedEmpId);
      setEmpSeleccionado(savedEmpId);
      setLoading(true);
      cargarCitas(savedToken, savedEmpId).finally(() => setLoading(false));
    }
  }, [slug]);

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
    if (!confirm(`¿Cancelar la cita de ${c.cliente}?`)) return;
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
        alert(data?.message || 'No se pudo cancelar la cita.');
      }
    } catch {
      alert('No se pudo cancelar la cita.');
    }
    setCancelando('');
  };

  const handleMarcarNoShow = async (citaId) => {
    if (!confirm('¿Marcar esta cita como no-show?')) return;
    setNoShowMarking(citaId);
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/no-show/${citaId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setCitas(prev => prev.map(item => item.id === citaId ? { ...item, no_show: true } : item));
      } else {
        alert('No se pudo marcar como no-show.');
      }
    } catch {
      alert('No se pudo marcar como no-show.');
    }
    setNoShowMarking('');
  };

  const handleUndo = async (citaId) => {
    if (!confirm('¿Deshacer esta acción? La cita volverá a estar activa.')) return;
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
        alert(data?.message || 'No se pudo deshacer.');
      }
    } catch {
      alert('No se pudo deshacer.');
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
          <p className="mt-2 text-sm text-gray-500">Portal del Profesional</p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-6 shadow rounded-2xl border border-gray-100">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tu nombre</label>
                <select
                  value={empSeleccionado || ''}
                  onChange={(e) => setEmpSeleccionado(e.target.value)}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                >
                  <option value="">Seleccionar...</option>
                  {empleados.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Tu PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm text-center tracking-[0.5em] focus:border-black focus:outline-none"
                />
              </div>
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl text-center font-medium">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full p-4 bg-black text-white font-bold rounded-xl shadow-md active:scale-95 transition-transform text-sm disabled:opacity-50"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </button>
            </form>
            <p className="mt-4 text-center text-[10px] text-gray-400">Pide tu PIN al dueño del local.</p>
          </div>
        </div>
      </div>
    );
  }

  const empName = localStorage.getItem(`emp_name_${slug}`) || '';

  return (
    <div className="max-w-lg mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased">
      <header className="px-5 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-lg font-black text-gray-900">{negocio?.name || slug}</h1>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{empName}</p>
          </div>
          <div className="flex items-center gap-2">
            {messaging && typeof Notification !== 'undefined' && (
              pushNotifications.isSubscribed ? (
                <button
                  onClick={() => pushNotifications.unsubscribe()}
                  className="text-[10px] text-gray-500 font-bold underline"
                >
                  🔔 Desactivar
                </button>
              ) : pushNotifications.permission === 'denied' ? (
                <span className="text-[10px] text-red-500 font-bold">🔕 Bloqueadas</span>
              ) : (
                <button
                  onClick={pushNotifications.subscribe}
                  className="text-[10px] text-blue-600 font-bold underline"
                >
                  🔔 Activar notificaciones
                </button>
              )
            )}
            <button onClick={handleLogout} className="text-[11px] text-gray-500 font-semibold underline">
              Salir
            </button>
          </div>
        </div>
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
          <div className="text-center py-12 bg-white border border-gray-200 rounded-2xl">
            <div className="text-4xl mb-3">📅</div>
            <p className="text-sm font-medium text-gray-600">No tienes citas próximas.</p>
          </div>
        )}

        {!loading && citas.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              { key: 'todas', label: 'Todas', count: citas.length },
              { key: 'activas', label: 'Activas', count: citas.filter(c => !c.cancelled && !c.no_show).length },
              { key: 'canceladas', label: 'Canceladas', count: citas.filter(c => c.cancelled).length },
              { key: 'noshow', label: 'No-Show', count: citas.filter(c => c.no_show).length },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFiltroEstado(f.key)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
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
    <div className={`bg-white border rounded-2xl p-4 shadow-sm ${isPast ? 'opacity-60' : 'border-gray-200'} ${isCancelled ? 'bg-red-50 border-red-200' : ''} ${isNoShow ? 'bg-amber-50 border-amber-200' : ''}`}>
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-gray-900 text-sm">👤 {c.cliente}</p>
            {isCancelled && <span className="text-[9px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded uppercase">Cancelada</span>}
            {isNoShow && <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded uppercase">No Show</span>}
          </div>
          <p className="text-xs text-gray-600 font-medium mt-1">📋 {c.servicio}</p>
          <p className="text-xs text-gray-500 mt-1">📅 {formatearFechaLarga(c.fecha)} a las {c.hora}</p>
          {c.notes && <p className="text-xs text-gray-400 italic mt-1">📝 {c.notes}</p>}
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
              className="text-[11px] text-gray-600 font-semibold hover:text-amber-700 active:scale-95 transition-all px-3 py-1.5 rounded-lg border border-transparent hover:border-amber-200 hover:bg-amber-50 disabled:opacity-50"
            >
              {noShowMarking === c.id ? 'Marcando...' : 'No Llegó'}
            </button>
          )}
          <button
            onClick={() => onCancel(c.id)}
            disabled={cancelando === c.id}
            className="text-[11px] text-red-600 font-semibold active:scale-95 transition-all px-3 py-1.5 rounded-lg border border-red-100 bg-red-50 hover:bg-red-100 disabled:opacity-50"
          >
            {cancelando === c.id ? '...' : 'Cancelar'}
          </button>
        </div>
      )}
      {/* Deshacer */}
      {(isCancelled || isNoShow) && isToday && (
        <div className="flex justify-end pt-3 mt-3 border-t border-gray-100">
          <button
            onClick={() => onUndo(c.id)}
            disabled={undoingId === c.id}
            className="text-[11px] text-blue-600 font-semibold hover:text-blue-800 active:scale-95 transition-all px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
          >
            {undoingId === c.id ? 'Deshaciendo...' : '↩️ Deshacer'}
          </button>
        </div>
      )}
    </div>
  );
}
