import { useState } from 'react';

// Auto-formatea el teléfono mientras el usuario teclea (ej. 300 123 4567)
const formatPhoneNumber = (value) => {
  const cleaned = ('' + value).replace(/\D/g, '');
  const match = cleaned.substring(0, 10).match(/^(\d{0,3})(\d{0,3})(\d{0,4})$/);
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

    // Eliminar todo lo que no sea un número (espacios, guiones, letras)
    const telefonoLimpio = telefono.replace(/\D/g, '');

    if (!telefonoLimpio) {
      setError("Por favor ingresa un número válido.");
      return;
    }

    setLoading(true);
    setError('');
    try {
      // Enviar el teléfono limpio al backend
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
    <div className="space-y-4">
      <button onClick={onVolver} className="text-sm text-gray-500 mb-4">← Volver</button>
      <h2 className="font-semibold text-gray-700 mb-3">Consultar o cancelar mis citas</h2>

      <form onSubmit={buscarCitas} className="space-y-3">
        <input
          type="tel" required placeholder="Tu WhatsApp (Ej. 300 123 4567)"
          value={telefono}
          onChange={e => setTelefono(formatPhoneNumber(e.target.value))}
          className="w-full p-4 border border-gray-200 rounded-xl bg-white"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 bg-black text-white font-bold rounded-xl disabled:opacity-50"
        >
          {loading ? 'Buscando...' : 'Ver mis citas'}
        </button>
      </form>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl text-center">
          {error}
        </div>
      )}

      {citaCancelada && (
        <div className="text-center p-6 bg-white border border-gray-200 rounded-2xl mt-4 shadow-sm">
          <div className="text-4xl mb-3">🗑️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-1">Cita cancelada</h2>
          <p className="text-sm text-gray-500 mb-4">
            El espacio en la agenda ha sido liberado.
          </p>

          {whatsapp && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-sm text-amber-800 mb-3 font-medium">
                Por favor, avísale al local para que puedan asignarle el turno a otra persona.
              </p>
              <a
                href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(`Hola, acabo de cancelar mi cita de ${citaCancelada.servicio} con ${citaCancelada.emp_name} para el ${citaCancelada.fecha} a las ${citaCancelada.hora}. ¡Gracias!`)}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setCitaCancelada(null)}
                className="block w-full py-3 bg-amber-500 text-white font-bold rounded-xl text-center shadow hover:bg-amber-600 transition-colors"
              >
                📲 Avisar al local por WhatsApp
              </a>
            </div>
          )}

          <button
            onClick={() => setCitaCancelada(null)}
            className="mt-4 text-sm text-gray-500 underline"
          >
            Cerrar
          </button>
        </div>
      )}

      {citas && citas.length === 0 && !citaCancelada && (
        <div className="text-center p-8 bg-white border border-gray-200 rounded-2xl">
          <div className="text-3xl mb-3">📭</div>
          <p className="text-gray-600">No tienes citas pendientes registradas con este número.</p>
        </div>
      )}

      {citas && citas.length > 0 && (
        <div className="space-y-3">
          {citas.map(c => {
            // Regla de negocio: no se puede cancelar por Internet a menos de 2h.
            // Se evalúa en el navegador (hora actual vs fecha del turno) con
            // respaldo al valor ya computado por el backend (c.cancelable).
            const ahora = Date.now();
            const fechaTurno = c.iso ? new Date(c.iso).getTime() : 0;
            const menosDe2Horas = fechaTurno ? (fechaTurno - ahora) <= 2 * 60 * 60 * 1000 : false;
            const cancelable = c.cancelable !== false && !menosDe2Horas;

            return (
              <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
                <p className="font-semibold text-gray-800">{c.servicio}</p>
                <p className="text-sm text-gray-600">✂️ {c.emp_name || c.emp_id}</p>
                <p className="text-sm text-gray-600">📅 {c.fecha} a las {c.hora}</p>
                {!cancelable ? (
                  <div className="mt-2 p-3 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-xl space-y-2">
                    <p>
                      ⏰ Esta cita está a menos de 2 horas: ya no se puede cancelar por
                      Internet. Comunícate directamente con el local.
                    </p>
                    {whatsapp && (
                      <a
                        href={`https://wa.me/${whatsapp}?text=${encodeURIComponent('Hola, necesito cancelar mi cita')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-center py-2 bg-green-500 text-white font-semibold rounded-lg"
                      >
                        💬 Escribir por WhatsApp
                      </a>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => cancelarCita(c)}
                    disabled={cancelando === c.id}
                    className="w-full mt-2 py-2.5 bg-red-50 text-red-600 font-semibold rounded-xl disabled:opacity-50"
                  >
                    {cancelando === c.id ? 'Cancelando...' : 'Cancelar cita'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}