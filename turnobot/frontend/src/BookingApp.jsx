import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import MisCitas from './MisCitas.jsx';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || '';

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

const DIAS_SEMANA_ABREV = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sa'];
const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function CalendarioGrid({ fechaSeleccionada, onSeleccionar }) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const [anioMes, setAnioMes] = useState(() => ({
    y: hoy.getFullYear(),
    m: hoy.getMonth(),
  }));
  const { y, m } = anioMes;
  const primerDia = new Date(y, m, 1);
  const diasEnMes = new Date(y, m + 1, 0).getDate();
  const offset = primerDia.getDay();
  const fmt = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  
  const navegar = (delta) => {
    const fecha = new Date(y, m + delta, 1);
    if (fecha < new Date(hoy.getFullYear(), hoy.getMonth(), 1)) return;
    setAnioMes({ y: fecha.getFullYear(), m: fecha.getMonth() });
  };

  const celdas = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) {
    celdas.push(new Date(y, m, d) < hoy ? null : d);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          disabled={y === hoy.getFullYear() && m === hoy.getMonth()}
          className="w-10 h-10 rounded-full hover:bg-gray-100 disabled:opacity-30 font-bold flex items-center justify-center text-lg"
        >
          ‹
        </button>
        <span className="font-bold capitalize text-gray-800">{MESES_ES[m]} {y}</span>
        <button
          type="button"
          onClick={() => navegar(1)}
          className="w-10 h-10 rounded-full hover:bg-gray-100 font-bold flex items-center justify-center text-lg"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-gray-400 mb-2">
        {DIAS_SEMANA_ABREV.map((dn) => (
          <span key={dn} className="py-1">{dn}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {celdas.map((d, i) => {
          if (d === null) return <span key={i} />;
          const fechaStr = fmt(d);
          const activo = fechaSeleccionada === fechaStr;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSeleccionar(fechaStr)}
              className={`h-11 rounded-xl text-sm font-semibold transition-all flex items-center justify-center ${
                activo ? 'bg-black text-white shadow-md scale-105' : 'text-gray-700 bg-gray-50 active:bg-gray-200'
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function BookingApp() {
  const { slug } = useParams();
  const [view, setView] = useState('agendar');
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [negocio, setNegocio] = useState(null);
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState('');
  const [waConfirmado, setWaConfirmado] = useState(false);
  const [booking, setBooking] = useState({
    servicioId: '',
    empleadoId: '',
    fecha: '',
    hora: '',
    clienteNombre: '',
    clienteTelefono: ''
  });

  useEffect(() => {
    fetch(`${API_URL}/api/v1/b/${slug}`)
      .then(res => {
        if (!res.ok) throw new Error('Negocio no encontrado');
        return res.json();
      })
      .then(data => setNegocio(data))
      .catch(err => {
        console.error("Error cargando negocio", err);
        setError("No pudimos cargar el negocio. Verifica el enlace.");
      });
  }, [slug]);

  const servicioElegido = negocio?.servicios?.find(s => s.id === booking.servicioId);
  const empleadoElegido = negocio?.empleados?.find(e => e.id === booking.empleadoId);

  const fetchHorarios = async (fecha, opts = {}) => {
    setLoading(true);
    if (!opts.preserveError) setError('');
    setBooking({ ...booking, fecha });
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/slots?emp_id=${booking.empleadoId}&servicio_id=${booking.servicioId}&fecha=${fecha}`);
      if (!res.ok) throw new Error('Error del servidor');
      const data = await res.json();
      setSlots(data || []);
      setStep(3);
    } catch (err) {
      setError("Error buscando horarios");
    }
    setLoading(false);
  };

  const confirmarCita = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const payload = {
      ...booking,
      clienteTelefono: booking.clienteTelefono.replace(/\D/g, '')
    };
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        setWaConfirmado(false);
        setStep(5);
        return;
      }
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.message) {
        setError(data.message);
        if (data.error === 'max_per_day') {
          setStep(4);
          setLoading(false);
          return;
        }
        setStep(3);
        await fetchHorarios(booking.fecha, { preserveError: true });
        return;
      }
      setError("Hubo un problema al agendar. Intenta de nuevo.");
    } catch (err) {
      setError("Hubo un problema al agendar");
    }
    setLoading(false);
  };

  const reiniciarAgendamiento = () => {
    setBooking({ servicioId: '', empleadoId: '', fecha: '', hora: '', clienteNombre: '', clienteTelefono: '' });
    setSlots([]);
    setError('');
    setStep(1);
    setView('agendar');
  };

  if (!negocio && !error) return <div className="p-8 text-center font-medium text-gray-500">Cargando negocio...</div>;

  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased">
      <header className="p-4 bg-white border-b border-gray-100 text-center sticky top-0 z-40 shadow-2xs">
        <h1 className="text-xl font-bold text-gray-900">{negocio?.name || 'Turnobot'}</h1>
        <p className="text-xs text-gray-500">Reserva tu cita en segundos</p>
      </header>

      <main className="p-4">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-600 text-sm rounded-2xl text-center font-medium">
            {error}
          </div>
        )}

        {negocio && (
          <>
            {view === 'citas' && (
              <MisCitas slug={slug} API_URL={API_URL} onVolver={() => setView('agendar')} whatsapp={negocio?.whatsapp} />
            )}

            {view === 'info' && (
              <div className="space-y-4">
                <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h2 className="text-lg font-bold text-gray-800">{negocio.name}</h2>
                  <div className="space-y-3 text-sm text-gray-700">
                    <p className="flex gap-3">📍 <span>{negocio.direccion || 'Dirección no disponible'}</span></p>
                    <p className="flex gap-3">🕒 <span>{negocio.horario || 'Horario no disponible'}</span></p>
                    <p className="flex gap-3">📞 <span>{negocio.telefono || 'Teléfono no disponible'}</span></p>
                  </div>
                  {negocio.whatsapp && (
                    <a
                      href={`https://wa.me/${negocio.whatsapp}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-full py-3.5 bg-green-500 text-white font-bold rounded-xl text-center shadow-md active:scale-98 transition-transform"
                    >
                      💬 Escríbenos por WhatsApp
                    </a>
                  )}
                </div>
              </div>
            )}

            {view === 'agendar' && (
              <div className="space-y-4">
                {step > 1 && step < 5 && (
                  <button onClick={() => setStep(step - 1)} className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-1 active:opacity-70">
                    ← Volver
                  </button>
                )}

                {step === 1 && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="font-bold text-gray-800 mb-3 text-base">1. Selecciona un servicio</h2>
                      <div className="grid gap-3">
                        {negocio.servicios?.map(s => (
                          <button
                            key={s.id}
                            onClick={() => setBooking({ ...booking, servicioId: s.id })}
                            className={`p-4 rounded-2xl border text-left flex justify-between items-center transition-all ${
                              booking.servicioId === s.id ? 'border-black bg-black text-white shadow-md' : 'border-gray-200 bg-white active:bg-gray-100'
                            }`}
                          >
                            <div>
                              <p className="font-bold text-sm">{s.name}</p>
                              <p className="text-xs opacity-75">{s.duration_minutes} min</p>
                            </div>
                            <span className="font-black text-base">${s.price}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {booking.servicioId && (
                      <div>
                        <h2 className="font-bold text-gray-800 mb-3 text-base">2. Selecciona el profesional</h2>
                        <div className="grid grid-cols-2 gap-3">
                          {negocio.empleados?.map(e => (
                            <button
                              key={e.id}
                              onClick={() => {
                                setBooking({ ...booking, empleadoId: e.id });
                                setStep(2);
                              }}
                              className="p-3.5 bg-white border border-gray-200 rounded-2xl font-bold text-sm flex items-center gap-3 active:bg-gray-100 shadow-2xs"
                            >
                              <span className="w-9 h-9 rounded-full bg-gray-100 text-gray-700 flex items-center justify-center font-black shrink-0 border border-gray-200">
                                {e.name.charAt(0)}
                              </span>
                              <span className="leading-tight text-gray-800 truncate">{e.name}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-3">
                    <h2 className="font-bold text-gray-800 mb-1 text-base">3. ¿Qué día quieres ir?</h2>
                    <CalendarioGrid fechaSeleccionada={booking.fecha} onSeleccionar={fetchHorarios} />
                    {loading && <p className="text-center text-sm font-semibold text-gray-500 py-2">Buscando espacios libres...</p>}
                  </div>
                )}

                {step === 3 && (
                  <div>
                    <h2 className="font-bold text-gray-800 mb-3 text-base">4. Horarios para el {booking.fecha}</h2>
                    {slots.length === 0 ? (
                      <div className="p-6 text-center bg-white border border-gray-200 rounded-2xl">
                        <p className="text-red-500 font-semibold">No hay espacios disponibles este día.</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2.5">
                        {slots.map(hora => (
                          <button
                            key={hora}
                            onClick={() => {
                              setBooking({ ...booking, hora });
                              setStep(4);
                            }}
                            className="py-3.5 bg-white border border-gray-200 rounded-xl font-bold text-sm text-gray-800 active:bg-black active:text-white transition-colors shadow-2xs"
                          >
                            {hora}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {step === 4 && (
                  <form onSubmit={confirmarCita} className="space-y-4">
                    <h2 className="font-bold text-gray-800 text-base">5. Tus datos para confirmar</h2>
                    <div className="bg-white border border-gray-200 rounded-2xl p-4 text-sm text-gray-700 space-y-1.5 shadow-2xs">
                      <p>✨ Servicio: <strong>{servicioElegido?.name}</strong> (${servicioElegido?.price})</p>
                      <p>👤 Profesional: <strong>{empleadoElegido?.name}</strong></p>
                      <p>📅 Fecha: <strong>{booking.fecha}</strong> a las <strong>{booking.hora}</strong></p>
                    </div>
                    <input
                      type="text" required placeholder="Tu Nombre completo"
                      value={booking.clienteNombre}
                      onChange={e => setBooking({ ...booking, clienteNombre: e.target.value })}
                      className="w-full p-4 border border-gray-200 rounded-xl bg-white text-base focus:outline-none focus:border-black"
                    />
                    <input
                      type="tel" required placeholder="Tu WhatsApp (Ej. 300 123 4567)"
                      value={booking.clienteTelefono}
                      onChange={e => setBooking({ ...booking, clienteTelefono: formatPhoneNumber(e.target.value) })}
                      className="w-full p-4 border border-gray-200 rounded-xl bg-white text-base focus:outline-none focus:border-black"
                    />
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-4 bg-black text-white font-bold rounded-2xl mt-4 disabled:opacity-50 active:scale-98 transition-transform text-base shadow-md"
                    >
                      {loading ? 'Agendando...' : 'Confirmar Reserva'}
                    </button>
                  </form>
                )}

                {step === 5 && (
                  <div className="text-center p-6 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-4">
                    {!waConfirmado ? (
                      <>
                        <div className="text-5xl">🎉</div>
                        <h2 className="text-xl font-bold text-gray-900">¡Cita reservada con éxito!</h2>
                        <p className="text-xs text-gray-500">
                          Tu turno ya está en nuestra agenda. Para agilizar tu atención al llegar, envíanos este mensaje rápido por WhatsApp.
                        </p>
                        <div className="text-left bg-gray-50 rounded-xl p-3.5 space-y-1 text-xs text-gray-700 border border-gray-100">
                          <p><strong>Servicio:</strong> {servicioElegido?.name}</p>
                          <p><strong>Profesional:</strong> {empleadoElegido?.name}</p>
                          <p><strong>Fecha:</strong> {booking.fecha} - {booking.hora}</p>
                        </div>
                        {negocio.whatsapp && (
                          <a
                            href={`https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(`Hola, soy ${booking.clienteNombre}. Acabo de agendar ${servicioElegido?.name} con ${empleadoElegido?.name} el ${booking.fecha} a las ${booking.hora}.`)}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setWaConfirmado(true)}
                            className="block w-full py-4 bg-green-500 text-white font-bold rounded-2xl text-center shadow-md active:scale-98 transition-transform"
                          >
                            💬 Enviar mensaje por WhatsApp
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-5xl">✅</div>
                        <h2 className="text-xl font-bold text-gray-900">¡Mensaje Enviado!</h2>
                        <p className="text-xs text-gray-500">Te esperamos el {booking.fecha} a las {booking.hora}.</p>
                      </>
                    )}
                    <button onClick={reiniciarAgendamiento} className="text-xs text-gray-500 font-semibold underline pt-2">
                      Volver al inicio
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* BOTTOM NAVIGATION BAR (UX TÁCTIL) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2.5 flex justify-around items-center z-50 shadow-lg">
        <button
          onClick={() => { setView('agendar'); setStep(1); }}
          className={`flex flex-col items-center gap-1 text-xs font-bold ${view === 'agendar' ? 'text-black' : 'text-gray-400'}`}
        >
          <span className="text-xl">📅</span>
          <span>Agendar</span>
        </button>
        <button
          onClick={() => setView('citas')}
          className={`flex flex-col items-center gap-1 text-xs font-bold ${view === 'citas' ? 'text-black' : 'text-gray-400'}`}
        >
          <span className="text-xl">📋</span>
          <span>Mis Citas</span>
        </button>
        <button
          onClick={() => setView('info')}
          className={`flex flex-col items-center gap-1 text-xs font-bold ${view === 'info' ? 'text-black' : 'text-gray-400'}`}
        >
          <span className="text-xl">📍</span>
          <span>Info Local</span>
        </button>
      </nav>
    </div>
  );
}
