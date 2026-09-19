import { useState } from 'react';
import { formatearFechaLarga, sumarDias } from './fecha.js';
import { DialogoProvider, useDialogo } from './ConfirmDialog.jsx';

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

export default function MisCitas(props) {
  return (
    <DialogoProvider>
      <MisCitasContenido {...props} />
    </DialogoProvider>
  );
}

function MisCitasContenido({ slug, API_URL, whatsapp, timezone }) {
  const { confirmar } = useDialogo();
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
    const ok = await confirmar({
      titulo: '¿Cancelar esta cita?',
      detalle: `${cita.servicio} · ${formatearFechaLarga(cita.fecha)} a las ${cita.hora}. Si quieres otra hora, cancela aquí y vuelve a reservar en Agendar.`,
      consecuencia: 'El horario quedará libre.',
      confirmarTexto: 'Sí, cancelar',
      variante: 'peligro',
    });
    if (!ok) return;
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

  // Mover una cita a otro día/hora (reprogramar): actualiza fecha/hora en
  // su lugar sin tocar visitas ni gasto (sigue siendo la misma cita).
  const moverCita = (citaId, fecha, hora) => {
    setCitas((prev) => prev ? prev.map((c) => c.id === citaId ? { ...c, fecha, hora } : c) : prev);
  };
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
      <div className="flex items-center gap-2 mb-1">
        <h2 className="font-bold text-gray-800 text-base">Tus citas</h2>
      </div>
      <p className="text-[11px] text-gray-500 font-medium mb-4">Escríbe tu WhatsApp para verlas. ¿Otra hora? Cancela y reserva de nuevo en Agendar.</p>

      <form onSubmit={buscarCitas} className="space-y-3">
        <label className="block">
          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Tu WhatsApp</span>
        <input
          type="tel" required placeholder="Ej. 300 123 4567"
          aria-label="Tu número de WhatsApp"
          inputMode="tel"
          autoComplete="tel"
          value={telefono}
          onChange={e => setTelefono(formatPhoneNumber(e.target.value))}
          className="w-full min-h-[48px] p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black focus-visible:ring-2 focus-visible:ring-black shadow-2xs"
        />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="w-full min-h-[48px] py-3.5 bg-black text-white font-bold rounded-xl active:scale-95 transition-transform disabled:opacity-50 shadow-md text-sm"
        >
          {loading ? 'Buscando...' : 'Ver mis citas'}
        </button>
      </form>

      {error && (
        <div role="alert" className="p-4 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl text-center font-medium">
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
          <p className="text-sm font-bold text-gray-700">Sin citas con este número</p>
          <p className="text-[11px] text-gray-500 font-medium mt-1">Revisa que sea el mismo WhatsApp con el que reservaste.</p>
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
                  <CitaCard key={c.id} c={c} onCancel={cancelarCita} cancelando={cancelando} slug={slug} API_URL={API_URL} phone={telefono.replace(/\D/g, '')} hoyMin={hoy} onMoved={moverCita} />
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
                  <CitaCard key={c.id} c={c} onCancel={cancelarCita} cancelando={cancelando} slug={slug} API_URL={API_URL} phone={telefono.replace(/\D/g, '')} hoyMin={hoy} onMoved={moverCita} />
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
                  <CitaCard key={c.id} c={c} onCancel={cancelarCita} cancelando={cancelando} slug={slug} API_URL={API_URL} phone={telefono.replace(/\D/g, '')} hoyMin={hoy} onMoved={moverCita} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CitaCard({ c, onCancel, cancelando, slug, API_URL, phone, hoyMin, onMoved }) {
  const isCancelled = c.cancelled === true;
  const [moviendo, setMoviendo] = useState(false);
  const [nuevaFecha, setNuevaFecha] = useState(c.fecha);
  const [horasLibres, setHorasLibres] = useState([]);
  const [horaElegida, setHoraElegida] = useState('');
  const [cargandoHoras, setCargandoHoras] = useState(false);
  const [guardandoMover, setGuardandoMover] = useState(false);
  const [errorMover, setErrorMover] = useState('');

  const cargarHoras = async (fecha) => {
    setCargandoHoras(true);
    setErrorMover('');
    setHoraElegida('');
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/slots?emp_id=${c.emp_id}&fecha=${fecha}`);
      if (!res.ok) throw new Error('Error del servidor');
      const data = await res.json();
      setHorasLibres(Array.isArray(data) ? data : (data?.slots || []));
    } catch {
      setErrorMover('No pudimos cargar los horarios de ese día.');
      setHorasLibres([]);
    }
    setCargandoHoras(false);
  };

  const confirmarMover = async () => {
    if (!horaElegida || guardandoMover) return;
    setGuardandoMover(true);
    setErrorMover('');
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas/${c.id}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Phone': phone || '' },
        body: JSON.stringify({ fecha: nuevaFecha, hora: horaElegida }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || 'No pudimos mover la cita.');
      onMoved?.(c.id, data.fecha || nuevaFecha, data.hora || horaElegida);
      setMoviendo(false);
    } catch (err) {
      setErrorMover(err.message || 'No pudimos mover la cita. Intenta de nuevo.');
    }
    setGuardandoMover(false);
  };

  return (
    <div className={`bg-white border rounded-2xl p-4 shadow-2xs space-y-1.5 ${isCancelled ? 'bg-red-50 border-red-200' : 'border-gray-200'}`}>
      <div className="flex justify-between items-start">
        <div className="min-w-0">
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
        <div className="pt-2 mt-2 border-t border-gray-100 space-y-2">
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setMoviendo((v) => !v);
                setErrorMover('');
                if (!moviendo) {
                  setNuevaFecha(c.fecha);
                  cargarHoras(c.fecha);
                }
              }}
              className="min-h-[44px] px-4 py-2 bg-gray-100 text-gray-700 font-bold text-xs rounded-xl active:scale-95 transition-transform"
            >
              {moviendo ? 'Cerrar' : 'Cambiar hora'}
            </button>
            <button
              onClick={() => onCancel(c)}
              disabled={cancelando === c.id}
              title="Cancelar esta cita y liberar el horario"
              className="min-h-[44px] px-4 py-2 bg-red-50 text-red-700 font-bold text-xs rounded-xl border border-red-200 disabled:opacity-50 active:scale-95 transition-transform"
            >
              {cancelando === c.id ? 'Cancelando…' : 'Cancelar cita'}
            </button>
          </div>
          {moviendo && (
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
              <label className="block">
                <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nuevo día</span>
                <input
                  type="date"
                  value={nuevaFecha}
                  min={hoyMin}
                  onChange={(e) => {
                    setNuevaFecha(e.target.value);
                    if (e.target.value) cargarHoras(e.target.value);
                  }}
                  className="w-full min-h-[44px] p-2.5 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black"
                />
              </label>
              {cargandoHoras ? (
                <p className="text-xs text-gray-500 font-medium text-center py-2">Buscando horarios…</p>
              ) : horasLibres.length === 0 ? (
                <p className="text-xs text-gray-500 font-medium text-center py-2">Sin espacios ese día. Prueba otro.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {horasLibres.map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => setHoraElegida(h)}
                      className={`min-h-[44px] py-2 border rounded-xl font-bold text-xs active:scale-95 transition-all ${
                        horaElegida === h ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-800'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              )}
              {errorMover && (
                <p role="alert" className="text-xs text-red-600 font-semibold text-center">{errorMover}</p>
              )}
              <button
                type="button"
                onClick={confirmarMover}
                disabled={!horaElegida || guardandoMover}
                className="w-full min-h-[48px] py-3 bg-black text-white font-bold rounded-xl text-xs active:scale-95 transition-transform disabled:opacity-50"
              >
                {guardandoMover ? 'Moviendo…' : horaElegida ? `Mover al ${nuevaFecha} a las ${horaElegida}` : 'Elige la nueva hora'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
