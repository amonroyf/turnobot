import { useState } from 'react';

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

export default function MisCitas({ slug, API_URL, onVolver, whatsapp }) {
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
      setCitaCancelada(cita);
      setCitas(prev => prev.filter(c => c.id !== cita.id));
    } catch (err) {
      setError("No pudimos cancelar la cita. Intenta de nuevo.");
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
          {whatsapp && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-xs text-amber-800 mb-3 font-semibold">
                Por favor, avísale al local para que puedan asignar el turno a otra persona.
              </p>
              <a
                href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, acabo de cancelar mi cita de ${citaCancelada.servicio} con ${citaCancelada.emp_name} para el ${citaCancelada.fecha} a las ${citaCancelada.hora}. ¡Gracias!`)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setCitaCancelada(null)}
                className="block w-full py-3.5 bg-amber-500 text-white font-bold rounded-xl text-center text-xs shadow-sm active:scale-95 transition-transform"
              >
                🔔 Avisar al local por WhatsApp
              </a>
            </div>
          )}
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
            const menosDe2Horas = fechaTurno ? (fechaTurno - ahora) <= 2 * 60 * 60 * 1000 : false;
            const cancelable = c.cancelable !== false && !menosDe2Horas;
            return (
              <div key={c.id} className="bg-white border border-gray-200 rounded-2xl p-4 shadow-2xs space-y-1.5">
                <p className="font-bold text-gray-900 text-sm">✨ {c.servicio}</p>
                <p className="text-xs text-gray-600 font-medium">👤 {c.emp_name || c.emp_id}</p>
                <p className="text-xs text-gray-600 font-medium">📅 {c.fecha} a las {c.hora}</p>
                
                {!cancelable ? (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-[11px] rounded-xl font-medium">
                    <p className="mb-2">⚠️ Faltan menos de 2 horas. Ya no se puede cancelar por Internet.</p>
                    {whatsapp && (
                      <a
                        href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, necesito cancelar mi cita')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-center py-2 bg-green-500 text-white font-bold rounded-lg active:scale-95 transition-transform"
                      >
                        💬 Escribir por WhatsApp
                      </a>
                    )}
                  </div>
                ) : (
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