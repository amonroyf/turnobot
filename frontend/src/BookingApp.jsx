import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import MisCitas from './MisCitas.jsx';
import { initPushNotifications, requestClientPushToken, listenForMessages } from './pushNotifications';

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || '';

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

const formatDinero = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

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
    const maxFecha = new Date(hoy);
    maxFecha.setDate(maxFecha.getDate() + 30);
    if (delta > 0 && fecha > new Date(maxFecha.getFullYear(), maxFecha.getMonth(), 1)) return;
    setAnioMes({ y: fecha.getFullYear(), m: fecha.getMonth() });
  };

  const maxFecha30 = new Date(hoy);
  maxFecha30.setDate(maxFecha30.getDate() + 30);
  const enLimite = y > maxFecha30.getFullYear() || (y === maxFecha30.getFullYear() && m >= maxFecha30.getMonth());

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
          aria-label="Mes anterior"
          className="w-10 h-10 rounded-full hover:bg-gray-100 active:scale-95 disabled:opacity-30 font-bold flex items-center justify-center text-lg transition-transform"
        >
          ‹
        </button>
        <span className="font-bold capitalize text-gray-800">{MESES_ES[m]} {y}</span>
        <button
          type="button"
          onClick={() => navegar(1)}
          disabled={enLimite}
          aria-label="Mes siguiente"
          className="w-10 h-10 rounded-full hover:bg-gray-100 active:scale-95 disabled:opacity-30 font-bold flex items-center justify-center text-lg transition-transform"
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
              aria-label={`Elegir ${fechaStr}`}
              className={`h-11 rounded-xl text-sm font-semibold transition-all flex items-center justify-center active:scale-95 ${
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
  const [clientPushToken, setClientPushToken] = useState(null);
  const [booking, setBooking] = useState({
    servicioId: '',
    empleadoId: '',
    fecha: '',
    hora: '',
    clienteNombre: '',
    clienteTelefono: ''
  });

  // Inicializar Service Worker de Firebase al cargar la página del cliente
  useEffect(() => {
    initPushNotifications().then((m) => {
      if (m) {
        // Escuchar mensajes en primer plano (pestaña abierta)
        listenForMessages((payload) => {
          const title = payload.notification?.title || 'Turnobot';
          const body = payload.notification?.body || '';
          // Mostrar notificación nativa del navegador即使 en primer plano
          if (Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/icon-192x192.png' });
          }
        });
      }
    });
  }, []);

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

  // MEJORA 4: Efecto de Auto-Scroll para experiencia móvil fluida
  useEffect(() => {
    if (step > 1 && view === 'agendar') {
      setTimeout(() => {
        const el = document.getElementById(`step-${step}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 150);
    }
  }, [step, view]);

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

    // Solicitar permiso push del cliente (silencioso, sin alerta)
    let pushToken = clientPushToken;
    if (!pushToken) {
      pushToken = await requestClientPushToken();
      if (pushToken) setClientPushToken(pushToken);
    }

    const payload = {
      ...booking,
      clienteTelefono: booking.clienteTelefono.replace(/\D/g, ''),
      client_push_token: pushToken || '',
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
        // Registrar el token push vinculado al teléfono para futuras citas
        if (pushToken) {
          const phone = booking.clienteTelefono.replace(/\D/g, '');
          registerClientPushToken(slug, pushToken, phone).catch(() => {});
        }
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const slotsManana = slots.filter(h => parseInt(h.split(':')[0], 10) < 12);
  const slotsTarde = slots.filter(h => {
    const hNum = parseInt(h.split(':')[0], 10);
    return hNum >= 12 && hNum < 17;
  });
  const slotsNoche = slots.filter(h => parseInt(h.split(':')[0], 10) >= 17);

  if (!negocio && !error) return <div className="p-8 text-center font-medium text-gray-500">Cargando negocio...</div>;

  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased">
      <header className="p-4 bg-white border-b border-gray-100 text-center sticky top-0 z-40 shadow-2xs">
        <h1 className="text-lg font-bold text-gray-900">{negocio?.name || 'Turnobot'}</h1>
        <p className="text-xs text-gray-400">Reserva tu cita en segundos</p>
      </header>

      <main className="p-4">
        {error && (
           <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-600 text-xs rounded-2xl text-center font-medium">
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
                  <h2 className="text-base font-bold text-gray-800">{negocio.name}</h2>
                  <div className="space-y-3 text-xs text-gray-600">
                    {negocio.direccion ? <p className="flex items-center gap-2">📍 <span>{negocio.direccion}</span></p> : null}
                    {negocio.horario ? <p className="flex items-center gap-2">🕒 <span>{negocio.horario}</span></p> : null}
                    {negocio.telefono ? <p className="flex items-center gap-2">📞 <span>{negocio.telefono}</span></p> : null}
                    
                    {(!negocio.direccion && !negocio.horario && !negocio.telefono) && (
                      <p className="text-gray-400 italic">Información del local no configurada.</p>
                    )}
                  </div>
                  {negocio.whatsapp && (
                    <a
                      href={`https://wa.me/${negocio.whatsapp}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block w-full py-3.5 bg-green-500 text-white font-bold rounded-xl text-center text-xs shadow-sm active:scale-95 transition-transform"
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
                  <button onClick={() => setStep(step - 1)} className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1 active:opacity-70">
                    ← Volver
                  </button>
                )}

                {/* PASO 1 */}
                {step >= 1 && (
                  <div id="step-1" className={step !== 1 ? 'opacity-50 pointer-events-none' : ''}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">1. Selecciona un servicio</h2>
                    <div className="grid gap-3">
                      {negocio.servicios?.map(s => {
                        const isActive = booking.servicioId === s.id;
                        return (
                          <button
                            key={s.id}
                            onClick={() => {
                              setBooking({ ...booking, servicioId: s.id, empleadoId: '', fecha: '', hora: '' });
                              setStep(1); 
                            }}
                            className={`p-4 rounded-2xl border text-left flex items-center gap-3 transition-all active:scale-95 ${
                              isActive ? 'border-black bg-black text-white shadow-md' : 'border-gray-200 bg-white active:bg-gray-100'
                            }`}
                          >
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              isActive ? 'border-white' : 'border-gray-300'
                            }`}
                            >
                              {isActive && <div className="w-2.5 h-2.5 bg-white rounded-full"></div>}
                            </div>
                            <div className="flex-1">
                              <p className="font-bold text-sm">{s.name}</p>
                              <p className="text-xs opacity-75">{s.duration_minutes} min</p>
                            </div>
                            <span className="font-black text-base">{formatDinero(s.price)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* PASO 2 */}
                {(step >= 1 && booking.servicioId) && (
                  <div id="step-2" className={step > 2 ? 'opacity-50 pointer-events-none mt-6' : 'mt-6'}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">2. Selecciona el profesional</h2>
                    <div className="grid grid-cols-2 gap-3">
                      {negocio.empleados?.map(e => {
                        const isActive = booking.empleadoId === e.id;
                        return (
                          <button
                            key={e.id}
                            onClick={() => {
                              setBooking({ ...booking, empleadoId: e.id, fecha: '', hora: '' });
                              setStep(2);
                            }}
                            className={`p-3.5 border rounded-2xl font-bold text-sm flex items-center gap-3 active:scale-95 transition-all shadow-2xs ${
                              isActive ? 'border-black bg-black text-white' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                            }`}
                          >
                            <span className={`w-9 h-9 rounded-full flex items-center justify-center font-black shrink-0 border ${
                              isActive ? 'bg-gray-800 text-white border-gray-700' : 'bg-gray-100 text-gray-700 border-gray-200'
                            }`}>
                              {e.name.charAt(0)}
                            </span>
                            <span className="leading-tight truncate">{e.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* PASO 3 (Calendario) */}
                {step >= 2 && (
                  <div id="step-3" className={step > 3 ? 'opacity-50 pointer-events-none mt-6' : 'mt-6'}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">3. ¿Qué día quieres ir?</h2>
                    <CalendarioGrid fechaSeleccionada={booking.fecha} onSeleccionar={fetchHorarios} />
                    {loading && <p className="text-center text-xs font-semibold text-gray-500 py-4">Buscando espacios libres...</p>}
                  </div>
                )}

                {/* PASO 4 (Horarios) */}
                {step >= 3 && slots.length >= 0 && (
                  <div id="step-4" className={step > 4 ? 'opacity-50 pointer-events-none mt-6' : 'mt-6'}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">4. Horarios para el {booking.fecha}</h2>
                    {slots.length === 0 ? (
                      <div className="p-6 text-center bg-white border border-gray-200 rounded-2xl">
                        <p className="text-red-500 font-semibold text-sm">No hay espacios disponibles este día.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {slotsManana.length > 0 && (
                          <div>
                            <p className="text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider">Mañana</p>
                            <div className="grid grid-cols-3 gap-2">
                              {slotsManana.map(hora => (
                                <button
                                  key={hora}
                                  onClick={() => { setBooking({ ...booking, hora }); setStep(4); }}
                                  className={`py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                                  }`}
                                >
                                  {hora}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {slotsTarde.length > 0 && (
                          <div>
                            <p className="text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider">Tarde</p>
                            <div className="grid grid-cols-3 gap-2">
                              {slotsTarde.map(hora => (
                                <button
                                  key={hora}
                                  onClick={() => { setBooking({ ...booking, hora }); setStep(4); }}
                                  className={`py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                                  }`}
                                >
                                  {hora}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {slotsNoche.length > 0 && (
                          <div>
                            <p className="text-[11px] font-bold text-gray-400 mb-2 uppercase tracking-wider">Noche</p>
                            <div className="grid grid-cols-3 gap-2">
                              {slotsNoche.map(hora => (
                                <button
                                  key={hora}
                                  onClick={() => { setBooking({ ...booking, hora }); setStep(4); }}
                                  className={`py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                                  }`}
                                >
                                  {hora}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* PASO 5 (Confirmar) */}
                {step >= 4 && (
                  <div id="step-5" className="mt-6 border-t border-gray-200 pt-6 pb-6">
                    <form onSubmit={confirmarCita} className="space-y-4">
                      <h2 className="font-bold text-gray-800 text-sm">5. Tus datos para confirmar</h2>
                      
                      <div className="bg-white border border-gray-200 rounded-2xl p-4 text-xs text-gray-700 space-y-1.5 shadow-2xs">
                        <p>✨ Servicio: <strong>{servicioElegido?.name}</strong> ({formatDinero(servicioElegido?.price)})</p>
                        <p>👤 Profesional: <strong>{empleadoElegido?.name}</strong></p>
                        <p>📅 Fecha: <strong>{booking.fecha}</strong> a las <strong>{booking.hora}</strong></p>
                      </div>

                      <input
                        type="text" required placeholder="Tu Nombre completo"
                        autoComplete="name"
                        value={booking.clienteNombre}
                        onChange={e => setBooking({ ...booking, clienteNombre: e.target.value })}
                        className="w-full p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black"
                      />
                      <input
                        type="tel" required placeholder="Tu WhatsApp (Ej. 300 123 4567)"
                        inputMode="tel"
                        autoComplete="tel"
                        value={booking.clienteTelefono}
                        onChange={e => setBooking({ ...booking, clienteTelefono: formatPhoneNumber(e.target.value) })}
                        className="w-full p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black"
                      />
                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-4 bg-black text-white font-bold rounded-2xl mt-2 disabled:opacity-50 active:scale-95 transition-transform text-sm shadow-md"
                      >
                        {loading ? 'Agendando...' : 'Confirmar Reserva'}
                      </button>
                    </form>
                  </div>
                )}

                {/* PANTALLA ÉXITO */}
                {step === 5 && (
                  <div id="step-success" className="text-center p-6 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-4 mt-4">
                    {!waConfirmado ? (
                      <>
                        <div className="text-4xl">🎉</div>
                        <h2 className="text-lg font-bold text-gray-900">¡Cita reservada con éxito!</h2>
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
                            className="block w-full py-3.5 bg-green-500 text-white font-bold rounded-xl text-center text-xs shadow-sm active:scale-95 transition-transform"
                          >
                            💬 Enviar mensaje por WhatsApp
                          </a>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="text-4xl">✅</div>
                        <h2 className="text-lg font-bold text-gray-900">¡Mensaje Enviado!</h2>
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

      {/* BOTTOM NAVIGATION BAR */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2 flex justify-around items-center z-50 shadow-lg">
        <button
          onClick={() => { setView('agendar'); setStep(1); }}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors ${view === 'agendar' ? 'text-black' : 'text-gray-400'}`}
        >
          <span className="text-lg">📅</span>
          <span>Agendar</span>
        </button>
        <button
          onClick={() => setView('citas')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors ${view === 'citas' ? 'text-black' : 'text-gray-400'}`}
        >
          <span className="text-lg">📋</span>
          <span>Mis Citas</span>
        </button>
        <button
          onClick={() => setView('info')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors ${view === 'info' ? 'text-black' : 'text-gray-400'}`}
        >
          <span className="text-lg">📍</span>
          <span>Info Local</span>
        </button>
      </nav>
    </div>
  );
}
