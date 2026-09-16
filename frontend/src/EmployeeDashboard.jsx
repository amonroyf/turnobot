import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { formatearFechaLarga, horaEnZona } from './fecha.js';
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

  const pushNotifications = useEmployeePushNotifications(slug, token, empId);

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

  const ahora = Date.now();
  const hoy = new Date().toISOString().slice(0, 10);
  const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

  const citasHoy = citas.filter(c => c.fecha === hoy && !c.cancelled);
  const citasManana = citas.filter(c => c.fecha === manana && !c.cancelled);
  const citasProximas = citas.filter(c => c.fecha > manana && !c.cancelled);

  const zonaNegocio = negocio?.timezone || 'America/Bogota';

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
                <span className="text-[10px] text-green-600 font-bold">🔔 Activo</span>
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

        {citasHoy.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Hoy</h2>
            <div className="space-y-2">
              {citasHoy.map(c => (
                <CitaCard key={c.id} c={c} zona={zonaNegocio} ahora={ahora} />
              ))}
            </div>
          </section>
        )}

        {citasManana.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Mañana</h2>
            <div className="space-y-2">
              {citasManana.map(c => (
                <CitaCard key={c.id} c={c} zona={zonaNegocio} ahora={ahora} />
              ))}
            </div>
          </section>
        )}

        {citasProximas.length > 0 && (
          <section>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Próximas</h2>
            <div className="space-y-2">
              {citasProximas.map(c => (
                <CitaCard key={c.id} c={c} zona={zonaNegocio} ahora={ahora} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function CitaCard({ c, zona, ahora }) {
  const isoMs = c.iso ? new Date(c.iso).getTime() : 0;
  const isPast = isoMs < ahora;

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-sm ${isPast ? 'opacity-60' : 'border-gray-200'}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className="font-bold text-gray-900 text-sm">👤 {c.cliente}</p>
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
      {c.no_show && (
        <span className="inline-block mt-2 text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded uppercase">
          No Show
        </span>
      )}
    </div>
  );
}
