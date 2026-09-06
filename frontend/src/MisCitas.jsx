import { useState } from 'react';

export default function MisCitas({ slug, API_URL, onVolver }) {
  const [telefono, setTelefono] = useState('');
  const [citas, setCitas] = useState(null); // null = aún no buscado
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cancelando, setCancelando] = useState('');

  const buscarCitas = async (e) => {
    e.preventDefault();
    if (!telefono.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas?telefono=${encodeURIComponent(telefono.trim())}`);
      if (!res.ok) throw new Error('Error del servidor');
      const data = await res.json();
      setCitas(data);
    } catch (err) {
      setError("Error buscando tus citas. Intenta de nuevo.");
    }
    setLoading(false);
  };

  const cancelarCita = async (citaId) => {
    if (!window.confirm('¿Seguro que deseas cancelar esta cita?')) return;
    setCancelando(citaId);
    setError('');
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/citas/${citaId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Error del servidor');
      setCitas(prev => prev.filter(c => c.id !== citaId));
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
          type="tel" required placeholder="Tu WhatsApp (Ej. 3001234567)"
          value={telefono}
          onChange={e => setTelefono(e.target.value)}
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

      {citas && citas.length === 0 && (
        <div className="text-center p-8 bg-white border border-gray-200 rounded-2xl">
          <div className="text-3xl mb-3">📭</div>
          <p className="text-gray-600">No tienes citas pendientes registradas con este número.</p>
        </div>
      )}

      {citas && citas.length > 0 && (
        <div className="space-y-3">
          {citas.map(c => (
            <div key={c.id} className="bg-white border border-gray-200 rounded-xl p-4 space-y-1">
              <p className="font-semibold text-gray-800">{c.servicio}</p>
              <p className="text-sm text-gray-600">✂️ {c.emp_name || c.emp_id}</p>
              <p className="text-sm text-gray-600">📅 {c.fecha} a las {c.hora}</p>
              <button
                onClick={() => cancelarCita(c.id)}
                disabled={cancelando === c.id}
                className="w-full mt-2 py-2.5 bg-red-50 text-red-600 font-semibold rounded-xl disabled:opacity-50"
              >
                {cancelando === c.id ? 'Cancelando...' : 'Cancelar cita'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}