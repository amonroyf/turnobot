import { useState } from 'react';
import { formatearFechaLarga } from './fecha.js';

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

export default function MisCitas({ slug, API_URL, whatsapp }) {
  const [telefono, setTelefono] = useState('');
  const [citas, setCitas] = useState(null); // null = aún no buscado
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancelando, setCancelando] = useState('');
  const [citaCancelada, setCitaCancelada] = useState(null);

  const buscarCitas = async (e) => {
    e.preventDefault();
    // Eliminar todo lo que no sea un número
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
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas/${cita.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error del servidor');
      setCitas((prev) => prev.map((c) => c.id === cita.id ? { ...c, cancelled: true } : c));
      setCitaCancelada(cita);
    } catch (err) {
      setError('No pudimos cancelar la cita. Intenta de nuevo.');
    }
    setCancelando('');
  };



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
        <div className="space-y-3 mt-4">
          {citas.map(c => {
            const ahora = Date.now();
            const fechaTurno = c.iso ? new Date(c.iso).getTime() : 0;
            const isCancelled = c.cancelled === true;

            return (
              <div key={c.id} className={`bg-white border rounded-2xl p-4 shadow-2xs space-y-1.5 ${isCancelled ? 'bg-red-50 border-red-200' : 'border-gray-200'}`}>
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
                      onClick={() => cancelarCita(c)}
                      disabled={cancelando === c.id}
                      className="px-4 py-2 bg-red-50 text-red-600 font-bold text-xs rounded-xl disabled:opacity-50 active:scale-95 transition-transform"
                    >
                      {cancelando === c.id ? 'Cancelando...' : 'Cancelar cita'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}