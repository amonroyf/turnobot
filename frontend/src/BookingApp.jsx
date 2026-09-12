import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import MisCitas from './MisCitas.jsx';
import { fechaHoyEnZona, sumarDias, formatearFechaLarga, formatearTelefono, descargarICS } from './fecha.js';
import { IconoCalendario, IconoLista, IconoPin } from './Iconos.jsx';

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

function CalendarioGrid({ fechaSeleccionada, onSeleccionar, timezone, ventanaDias }) {
  // "Hoy" y el límite de días de la ventana de reserva se calculan en la zona
  // del negocio, no en la del dispositivo (evita desfases con TZ distinta).
  const hoyStr = fechaHoyEnZona(timezone);
  const maxStr = sumarDias(hoyStr, ventanaDias || 30);
  const [yHoy, mHoy] = hoyStr.split('-').map(Number);
  const [anioMes, setAnioMes] = useState(() => ({ y: yHoy, m: mHoy - 1 }));
  const { y, m } = anioMes;
  const primerDia = new Date(y, m, 1);
  const diasEnMes = new Date(y, m + 1, 0).getDate();
  const offset = primerDia.getDay();
  const fmt = (d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const keyMes = (yy, mm) => `${yy}-${String(mm + 1).padStart(2, '0')}`;
  const mesHoy = keyMes(yHoy, mHoy - 1);
  const [maxY, maxM] = maxStr.split('-').map(Number);
  const mesMax = keyMes(maxY, maxM - 1);

  const navegar = (delta) => {
    const fecha = new Date(y, m + delta, 1);
    if (delta < 0 && keyMes(fecha.getFullYear(), fecha.getMonth()) < mesHoy) return;
    if (delta > 0 && keyMes(fecha.getFullYear(), fecha.getMonth()) > mesMax) return;
    setAnioMes({ y: fecha.getFullYear(), m: fecha.getMonth() });
  };

  const mesActual = keyMes(y, m);
  const enLimite = mesActual >= mesMax;

  const celdas = [];
  for (let i = 0; i < offset; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) {
    celdas.push(fmt(d) < hoyStr ? null : d);
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="flex justify-between items-center mb-3">
        <button
          type="button"
          onClick={() => navegar(-1)}
          disabled={mesActual <= mesHoy}
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
  const [booking, setBooking] = useState({
    servicioId: '',
    empleadoId: '',
    fecha: '',
    hora: '',
    clienteNombre: '',
    clienteTelefono: '',
    clienteNotas: '',
    website: '',
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

  // Auto-scroll al avanzar de paso (con margen para el header fijo) y a la
  // pantalla de éxito al confirmar.
  useEffect(() => {
    if (step > 1 && view === 'agendar') {
      setTimeout(() => {
        const target = step === 5 ? 'step-success' : `step-${step}`;
        const el = document.getElementById(target);
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

    const payload = {
      ...booking,
      clienteTelefono: booking.clienteTelefono.replace(/\D/g, ''),
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
      // 400 con mensaje (servicio inexistente, muy pronto, notas largas...):
      // se muestra el motivo sin perder el formulario.
      if (data?.message) {
        setError(data.message);
        setLoading(false);
        return;
      }
      setError("Hubo un problema al agendar. Intenta de nuevo.");
    } catch (err) {
      setError("Hubo un problema al agendar");
    }
    setLoading(false);
  };

  const descargarMiICS = () => {
    descargarICS({
      slug,
      servicio: servicioElegido?.name || '',
      profesional: empleadoElegido?.name || '',
      fecha: booking.fecha,
      hora: booking.hora,
      duracionMin: servicioElegido?.duration_minutes || 60,
      direccion: negocio?.direccion || '',
      timezone: negocio?.timezone || 'America/Bogota',
      notas: booking.clienteNotas || '',
      reminderDias: negocio?.reminder_days_before || 1,
      reminderHoras: negocio?.reminder_hours_before || 2,
    });
  };

  const reiniciarAgendamiento = () => {    setBooking({ servicioId: '', empleadoId: '', fecha: '', hora: '', clienteNombre: '', clienteTelefono: '', clienteNotas: '', website: '' });
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
            {/* Negocio suspendido: aviso y contacto directo, sin flujo de reserva */}
            {negocio.suspended && (
              <div className="mb-4 p-6 bg-amber-50 border border-amber-200 rounded-2xl text-center">
                <div className="text-4xl mb-3">⏸️</div>
                <h2 className="text-base font-bold text-amber-800 mb-2">Negocio No Disponible</h2>
                <p className="text-xs text-amber-700 mb-4">
                  Este negocio no está aceptando reservas en este momento. Por favor, comunícate directamente con el local.
                </p>
                {negocio.whatsapp && (
                  <a
                    href={`https://wa.me/${negocio.whatsapp}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block py-3 px-6 bg-green-500 text-white font-bold rounded-xl text-xs active:scale-95 transition-transform"
                  >
                    💬 Escribir por WhatsApp
                  </a>
                )}
              </div>
            )}

            {view === 'citas' && (
              <MisCitas slug={slug} API_URL={API_URL} whatsapp={negocio?.whatsapp} />
            )}

            {view === 'info' && (
              <div className="space-y-4">
                <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h2 className="text-base font-bold text-gray-800">{negocio.name}</h2>
                  <div className="space-y-3 text-xs text-gray-600">
                    {negocio.direccion ? <p className="flex items-center gap-2">📍 <span>{negocio.direccion}</span></p> : null}
                    {negocio.horario ? <p className="flex items-center gap-2">🕒 <span>{negocio.horario}</span></p> : null}
                    {negocio.telefono ? <p className="flex items-center gap-2">📞 <span>{formatearTelefono(negocio.telefono)}</span></p> : null}
                    
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
                  <div id="step-1" className={`scroll-mt-24 ${step !== 1 ? 'opacity-50 pointer-events-none' : ''}`}>
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
                  <div id="step-2" className={`scroll-mt-24 ${step > 2 ? 'opacity-50 pointer-events-none mt-6' : 'mt-6'}`}>
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
                  <div id="step-3" className={`scroll-mt-24 ${step > 3 ? 'opacity-50 pointer-events-none mt-6' : 'mt-6'}`}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">3. ¿Qué día quieres ir?</h2>
                    <CalendarioGrid fechaSeleccionada={booking.fecha} onSeleccionar={fetchHorarios} timezone={negocio?.timezone} ventanaDias={negocio?.booking_window_days} />
                    {loading && <p className="text-center text-xs font-semibold text-gray-500 py-4">Buscando espacios libres...</p>}
                  </div>
                )}

                {/* PASO 4 (Horarios) */}
                {step >= 3 && slots.length >= 0 && (
                  <div id="step-4" className={`scroll-mt-24 ${step > 4 ? 'opacity-50 pointer-events-none mt-6' : 'mt-6'}`}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">4. Horarios para el {formatearFechaLarga(booking.fecha)}</h2>
                    {slots.length === 0 ? (
                      <div className="p-6 text-center bg-white border border-gray-200 rounded-2xl">
                        <p className="text-red-500 font-semibold text-sm">No hay espacios disponibles este día.</p>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {slotsManana.length > 0 && (
                          <div>
                            <p className="text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Mañana</p>
                            <div className="grid grid-cols-3 gap-2">
                              {slotsManana.map(hora => (
                                <button
                                  key={hora}
                                  onClick={() => { setBooking({ ...booking, hora }); setStep(4); }}
                                  className={`py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black active:bg-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
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
                            <p className="text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Tarde</p>
                            <div className="grid grid-cols-3 gap-2">
                              {slotsTarde.map(hora => (
                                <button
                                  key={hora}
                                  onClick={() => { setBooking({ ...booking, hora }); setStep(4); }}
                                  className={`py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black active:bg-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
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
                            <p className="text-[11px] font-bold text-gray-500 mb-2 uppercase tracking-wider">Noche</p>
                            <div className="grid grid-cols-3 gap-2">
                              {slotsNoche.map(hora => (
                                <button
                                  key={hora}
                                  onClick={() => { setBooking({ ...booking, hora }); setStep(4); }}
                                  className={`py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black active:bg-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
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
                {step >= 4 && step < 5 && (
                  <div id="step-5" className="mt-6 border-t border-gray-200 pt-6 pb-6 scroll-mt-24">
                    <form onSubmit={confirmarCita} className="space-y-4">
                      <h2 className="font-bold text-gray-800 text-sm">5. Tus datos para confirmar</h2>
                      
                      <div className="bg-white border border-gray-200 rounded-2xl p-4 text-xs text-gray-700 space-y-1.5 shadow-2xs">
                        <p>✨ Servicio: <strong>{servicioElegido?.name}</strong> ({formatDinero(servicioElegido?.price)})</p>
                        <p>👤 Profesional: <strong>{empleadoElegido?.name}</strong></p>
                        <p>📅 Fecha: <strong>{formatearFechaLarga(booking.fecha)}</strong> a las <strong>{booking.hora}</strong></p>
                      </div>

                      <input
                        type="text" required placeholder="Tu Nombre completo"
                        aria-label="Tu nombre completo"
                        autoComplete="name"
                        value={booking.clienteNombre}
                        onChange={e => setBooking({ ...booking, clienteNombre: e.target.value })}
                        className="w-full p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black"
                      />
                      <input
                        type="tel" required placeholder="Tu WhatsApp (Ej. 300 123 4567)"
                        aria-label="Tu número de WhatsApp"
                        inputMode="tel"
                        autoComplete="tel"
                        value={booking.clienteTelefono}
                        onChange={e => setBooking({ ...booking, clienteTelefono: formatPhoneNumber(e.target.value) })}
                        className="w-full p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black"
                      />
                      <textarea
                        placeholder="¿Algo que debamos saber? (opcional, máx 500 caracteres)"
                        aria-label="Descripción de lo que necesitas (opcional)"
                        rows={2}
                        maxLength={500}
                        value={booking.clienteNotas}
                        onChange={e => setBooking({ ...booking, clienteNotas: e.target.value })}
                        className="w-full p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black resize-none"
                      />
                      {/* Honeypot anti-bots: invisible para humanos */}
                      <input
                        type="text" tabIndex={-1} autoComplete="off" aria-hidden="true"
                        name="website" placeholder="No llenar"
                        value={booking.website}
                        onChange={e => setBooking({ ...booking, website: e.target.value })}
                        className="absolute -left-[9999px] top-auto w-px h-px opacity-0"
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
                  <div id="step-success" className="text-center p-6 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-4 mt-4 scroll-mt-24">
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
                          <p><strong>Fecha:</strong> {formatearFechaLarga(booking.fecha)} - {booking.hora}</p>
                          {booking.clienteNotas && <p><strong>Notas:</strong> {booking.clienteNotas}</p>}
                        </div>
                        {negocio.whatsapp && (
                          <a
                            href={`https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(`Hola, soy ${booking.clienteNombre}. Acabo de agendar ${servicioElegido?.name} con ${empleadoElegido?.name} el ${formatearFechaLarga(booking.fecha)} a las ${booking.hora}.`)}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setWaConfirmado(true)}
                            className="block w-full py-3.5 bg-green-500 text-white font-bold rounded-xl text-center text-xs shadow-sm active:scale-95 transition-transform"
                          >
                            💬 Enviar mensaje por WhatsApp
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={descargarMiICS}
                          className="block w-full py-3.5 bg-white border border-gray-200 text-gray-800 font-bold rounded-xl text-center text-xs shadow-sm active:scale-95 transition-transform"
                        >
                          📅 Añadir al calendario (.ics)
                        </button>
                      </>
                    ) : (
                      <>
                        <div className="text-4xl">✅</div>
                        <h2 className="text-lg font-bold text-gray-900">¡Mensaje Enviado!</h2>
                        <p className="text-xs text-gray-500">Te esperamos el {formatearFechaLarga(booking.fecha)} a las {booking.hora}.</p>
                        <button
                          type="button"
                          onClick={descargarMiICS}
                          className="block w-full py-3.5 bg-white border border-gray-200 text-gray-800 font-bold rounded-xl text-center text-xs shadow-sm active:scale-95 transition-transform"
                        >
                          📅 Añadir al calendario (.ics)
                        </button>
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
          <IconoCalendario />
          <span>Agendar</span>
        </button>
        <button
          onClick={() => setView('citas')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors ${view === 'citas' ? 'text-black' : 'text-gray-400'}`}
        >
          <IconoLista />
          <span>Mis Citas</span>
        </button>
        <button
          onClick={() => setView('info')}
          className={`flex flex-col items-center gap-0.5 text-[10px] font-bold transition-colors ${view === 'info' ? 'text-black' : 'text-gray-400'}`}
        >
          <IconoPin />
          <span>Info Local</span>
        </button>
      </nav>
    </div>
  );
}
