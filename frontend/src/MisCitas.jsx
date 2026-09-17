import { useState } from 'react';
import { formatearFechaLarga, sumarDias } from './fecha.js';

// Auto-formatea el teléfono mientras el usuario teclea (ej. 300 123 4567)
const formatPhoneNumber = (value) => {
  let cleaned = ('' + value).replace(/\D/g, '');
  if (cleaned.length > 10) {
    cleaned = cleaned.slice(-10);
  }
  const match = cleaned.match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
  if (match) {
    return !match[2]
      ? match[1]
      : `${match[1]} ${match[2]}${match[3] ? ` ${match[3]}` : ''}`;
  }
  return value;
};

// Obtener fecha "YYYY-MM-DD" en la zona horaria del negocio
const fmtFecha = (d, tz) => d.toLocaleDateString('sv-SE', { timeZone: tz || 'America/Bogota' });

export default function MisCitas({ slug, API_URL, whatsapp, timezone }) {
  const tz = timezone || 'America/Bogota';
  const [telefono, setTelefono] = useState('');
  const [citas, setCitas] = useState(null); // null = aún no buscado
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancelando, setCancelando] = useState('');
  const [citaCancelada, setCitaCancelada] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('todas');

  const buscarCitas = async (e) => {
    e.preventDefault();
    const telefonoLimpio = telefono.replace(/\D/g, '');
    if (!telefonoLimpio) {
      setError("Por favor ingresa un número válido.");
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas?telefono=${telefonoLimpio}`);
      if (!res.ok) throw new Error('Error del servidor');
      const data = await res.json();
      setCitas(data);
    } catch (err) {
      setError("Error buscando tus citas. Intenta de nuevo.");
    }
    setLoading(false);
  };

  const cancelarCita = async (cita) => {
    if (!window.confirm('¿Seguro que deseas cancelar esta cita?')) return;
    setCancelando(cita.id);
    setError('');
    try {
      const telefonoLimpio = telefono.replace(/\D/g, '');
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas/${cita.id}`, {
        method: 'DELETE',
        headers: { 'X-Client-Phone': telefonoLimpio },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || 'Error del servidor');
      }
      setCitas((prev) => prev.map((c) => c.id === cita.id ? { ...c, cancelled: true } : c));
      setCitaCancelada(cita);
    } catch (err) {
      setError(err.message || 'No pudimos cancelar la cita. Intenta de nuevo.');
    }
    setCancelando('');
  };

  // Agrupar por fecha usando la zona del negocio (aritmética sobre el
  // string 'YYYY-MM-DD': no depende de la zona del dispositivo).
  const hoy = fmtFecha(new Date(), tz);
  const manana = sumarDias(hoy, 1);

  const filtrarPorEstado = (lista) => {
    if (filtroEstado === 'activas') return lista.filter(c => !c.cancelled);
    if (filtroEstado === 'canceladas') return lista.filter(c => c.cancelled);
    return lista;
  };

  const citasHoy = citas ? filtrarPorEstado(citas.filter(c => c.fecha === hoy)) : [];
  const citasManana = citas ? filtrarPorEstado(citas.filter(c => c.fecha === manana)) : [];
  const citasProximas = citas ? filtrarPorEstado(citas.filter(c => c.fecha > manana)) : [];

  return (
    <div className="space-y-4 pb-10">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="font-bold text-gray-800 text-base">Consultar o cancelar citas</h2>
      </div>

      <form onSubmit={buscarCitas} className="space-y-3">
        <input
          type="tel" required placeholder="Tu WhatsApp (Ej. 300 123 4567)"
          aria-label="Tu número de WhatsApp"
          inputMode="tel"
          autoComplete="tel"
          value={telefono}
          onChange={e => setTelefono(formatPhoneNumber(e.target.value))}
          className="w-full p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black shadow-2xs"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3.5 bg-black text-white font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-50 shadow-md text-sm"
        >
          {loading ? 'Buscando...' : 'Ver mis citas'}
        </button>
      </form>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl text-center font-medium">
          {error}
        </div>
      )}

      {citaCancelada && (
        <div className="text-center p-6 bg-white border border-gray-200 rounded-2xl mt-4 shadow-sm">
          <div className="text-4xl mb-3">🗑️</div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Cita cancelada</h2>
          <p className="text-xs text-gray-500 mb-4">
            El espacio en la agenda ha sido liberado.
          </p>
          <button
            onClick={() => setCitaCancelada(null)}
            className="mt-4 text-xs text-gray-500 font-semibold underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {citas && citas.length === 0 && !citaCancelada && (
        <div className="text-center p-8 bg-white border border-gray-200 rounded-2xl shadow-sm">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm font-medium text-gray-600">No tienes citas pendientes registradas con este número.</p>
        </div>
      )}

      {citas && citas.length > 0 && (
        <>
          {/* Filtros de estado */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[
              { key: 'todas', label: 'Todas', count: citas.length },
              { key: 'activas', label: 'Activas', count: citas.filter(c => !c.cancelled).length },
              { key: 'canceladas', label: 'Canceladas', count: citas.filter(c => c.cancelled).length },
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

          {/* SECCIÓN HOY */}
          {citasHoy.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Hoy</h2>
              <div className="space-y-3">
                {citasHoy.map(c => (
                  <CitaCard key={c.id} c={c} onCancel={cancelarCita} cancelando={cancelando} />
                ))}
              </div>
            </section>
          )}

          {/* SECCIÓN MAÑANA */}
          {citasManana.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Mañana</h2>
              <div className="space-y-3">
                {citasManana.map(c => (
                  <CitaCard key={c.id} c={c} onCancel={cancelarCita} cancelando={cancelando} />
                ))}
              </div>
            </section>
          )}

          {/* SECCIÓN PRÓXIMAS */}
          {citasProximas.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Próximas</h2>
              <div className="space-y-3">
                {citasProximas.map(c => (
                  <CitaCard key={c.id} c={c} onCancel={cancelarCita} cancelando={cancelando} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CitaCard({ c, onCancel, cancelando }) {
  const isCancelled = c.cancelled === true;

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-2xs space-y-1.5 ${isCancelled ? 'bg-red-50 border-red-200' : 'border-gray-200'}`}>
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-bold text-gray-900 text-sm">📋 {c.servicio}</p>
            {isCancelled && <span className="text-[9px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded uppercase">Cancelada</span>}
          </div>
          <p className="text-xs text-gray-600 font-medium">👤 {c.emp_name || c.emp_id}</p>
          <p className="text-xs text-gray-600 font-medium">📅 {formatearFechaLarga(c.fecha)} a las {c.hora}</p>
        </div>
        {c.price > 0 && (
          <span className="text-xs font-black text-gray-900 bg-gray-100 px-2.5 py-1 rounded-lg shrink-0">
            ${Number(c.price).toLocaleString('es-CO')}
          </span>
        )}
      </div>
      {c.notes && <p className="text-xs text-gray-500 italic">📝 {c.notes}</p>}

      {!isCancelled && (
        <div className="pt-2 mt-2 border-t border-gray-100 flex justify-end">
          <button
            onClick={() => onCancel(c)}
            disabled={cancelando === c.id}
            className="px-4 py-2 bg-red-50 text-red-600 font-bold text-xs rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
          >
            {cancelando === c.id ? 'Cancelando...' : 'Cancelar cita'}
          </button>
        </div>
      )}
    </div>
  );
}
