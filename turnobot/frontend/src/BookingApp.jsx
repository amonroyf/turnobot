import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import MisCitas from './MisCitas.jsx';

// URL base del backend Go. Se configura con VITE_API_URL (o REACT_APP_API_URL).
// Si está vacío, usa rutas relativas (el proxy de Vite en dev, o mismo dominio en prod).
const API_URL = import.meta.env.VITE_API_URL || import.meta.env.REACT_APP_API_URL || '';

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

export default function BookingApp() {
  const { slug } = useParams();
  const [view, setView] = useState('menu');

  // Flujo de agendamiento
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Datos cargados desde la API de Go
  const [negocio, setNegocio] = useState(null);
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState('');
  const [waConfirmado, setWaConfirmado] = useState(false);

  // Elecciones del cliente
  const [booking, setBooking] = useState({
    servicioId: '',
    empleadoId: '',
    fecha: '',
    hora: '',
    clienteNombre: '',
    clienteTelefono: ''
  });

  // Cargar catálogo al abrir el enlace
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

  // Datos elegidos para la confirmación detallada
  const servicioElegido = negocio?.servicios?.find(s => s.id === booking.servicioId);
  const empleadoElegido = negocio?.empleados?.find(e => e.id === booking.empleadoId);

  // Paso 3: Buscar horarios cuando elige empleado y fecha
  // opts.preserveError: mantiene el error actual (p. ej. el aviso de slot ocupado)
  // en vez de limpiarlo, útil al recargar los horarios tras un 409.
  const fetchHorarios = async (fecha, opts = {}) => {
    setLoading(true);
    if (!opts.preserveError) setError('');
    setBooking({ ...booking, fecha });
    try {
      // URL actualizada para enviar el servicioId y calcular saltos según su duración
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

  // Paso Final: Confirmar cita
  const confirmarCita = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Sanitizar el teléfono antes de enviarlo a la base de datos
    const payload = {
      ...booking,
      clienteTelefono: booking.clienteTelefono.replace(/\D/g, '')
    };

    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload) // Usar el payload limpio
      });

      if (res.ok) {
        setWaConfirmado(false);
        setStep(5); // Pantalla de éxito
        return;
      }

      // El backend devuelve 409 cuando un slot se acaba de reservar (carrera).
      // Mostramos su mensaje y recargamos los horarios para reflejar la baja.
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.message) {
        setError(data.message);
        // Límite de una cita por cliente al día: solo se muestra el mensaje
        // (cubre el caso de reservar para un familiar) sin recargar horarios.
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

  const iniciarAgendamiento = () => {
    setBooking({
      servicioId: '',
      empleadoId: '',
      fecha: '',
      hora: '',
      clienteNombre: '',
      clienteTelefono: ''
    });
    setSlots([]);
    setError('');
    setStep(1);
    setView('agendar');
  };

  const volverAlMenu = () => {
    setError('');
    setView('menu');
  };

  if (!negocio && !error) return <div className="p-8 text-center">Cargando barbería...</div>;

  return (
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen p-4 font-sans">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-gray-800">{negocio?.name || 'Turnobot'}</h1>
        <p className="text-sm text-gray-500">Reserva tu cita en segundos</p>
      </header>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl text-center">
          {error}
        </div>
      )}

      {negocio && (
        <>
          {/* MENÚ PRINCIPAL */}
          {view === 'menu' && (
            <div className="space-y-4 mt-4">
              <button
                onClick={iniciarAgendamiento}
                className="w-full p-4 bg-black text-white font-semibold rounded-xl text-left flex items-center gap-3"
              >
                <span className="text-2xl">💈</span>
                <span>
                  Agendar cita
                  <br />
                  <span className="text-xs font-normal opacity-75">Elige servicio, barbero, día y hora</span>
                </span>
              </button>

              <button
                onClick={() => { setError(''); setView('citas'); }}
                className="w-full p-4 bg-white border border-gray-200 font-semibold rounded-xl text-left flex items-center gap-3"
              >
                <span className="text-2xl">📋</span>
                <span>
                  Mis citas
                  <br />
                  <span className="text-xs font-normal text-gray-500">Consultar o cancelar mis reservas</span>
                </span>
              </button>

              <button
                onClick={() => { setError(''); setView('info'); }}
                className="w-full p-4 bg-white border border-gray-200 font-semibold rounded-xl text-left flex items-center gap-3"
              >
                <span className="text-2xl">📍</span>
                <span>
                  Información del local
                  <br />
                  <span className="text-xs font-normal text-gray-500">Dirección, horario y contacto</span>
                </span>
              </button>
            </div>
          )}

          {/* CONSULTAR / CANCELAR CITAS */}
          {view === 'citas' && (
            <MisCitas slug={slug} API_URL={API_URL} onVolver={volverAlMenu} whatsapp={negocio?.whatsapp} />
          )}

          {/* INFORMACIÓN DEL LOCAL */}
          {view === 'info' && (
            <div className="space-y-4">
              <button onClick={volverAlMenu} className="text-sm text-gray-500 mb-4">← Volver</button>
              <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4">
                <h2 className="text-lg font-bold text-gray-800">{negocio.name}</h2>
                <div className="space-y-3 text-sm text-gray-700">
                  <p className="flex gap-3"><span>📍</span><span>{negocio.direccion || 'Dirección no disponible'}</span></p>
                  <p className="flex gap-3"><span>🕐</span><span>{negocio.horario || 'Horario no disponible'}</span></p>
                  <p className="flex gap-3"><span>📞</span><span>{negocio.telefono || 'Teléfono no disponible'}</span></p>
                </div>
                {negocio.whatsapp && (
                  <a
                    href={`https://wa.me/${negocio.whatsapp}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-full py-3 bg-green-500 text-white font-semibold rounded-xl text-center"
                  >
                    💬 Escríbenos por WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}

          {/* FLUJO DE AGENDAMIENTO */}
          {view === 'agendar' && (
            <>
              {step !== 1 && step !== 5 && (
                <button onClick={() => setStep(step - 1)} className="text-sm text-gray-500 mb-4">← Volver</button>
              )}
              {step === 5 && (
                <button onClick={volverAlMenu} className="text-sm text-gray-500 mb-4">← Volver al inicio</button>
              )}

              {/* PASO 1: Elegir Servicio y Barbero */}
              {step === 1 && (
                <div className="space-y-6">
                  <div>
                    <h2 className="font-semibold text-gray-700 mb-3">1. Elige un servicio</h2>
                    <div className="grid gap-3">
                      {negocio.servicios.map(s => (
                        <button
                          key={s.id}
                          onClick={() => setBooking({ ...booking, servicioId: s.id })}
                          className={`p-4 rounded-xl border text-left flex justify-between ${booking.servicioId === s.id ? 'border-black bg-black text-white' : 'border-gray-200 bg-white'}`}
                        >
                          <span>{s.name} <br /><span className="text-xs opacity-75">{s.duration_minutes} min</span></span>
                          <span className="font-bold">${s.price}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {booking.servicioId && (
                    <div>
                      <h2 className="font-semibold text-gray-700 mb-3">2. Elige tu barbero</h2>
                      <div className="grid grid-cols-2 gap-3">
                        {negocio.empleados.map(e => (
                          <button
                            key={e.id}
                            onClick={() => {
                              setBooking({ ...booking, empleadoId: e.id });
                              setStep(2);
                            }}
                            className="p-3 bg-white border border-gray-200 rounded-xl font-medium active:bg-gray-100"
                          >
                            {e.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* PASO 2: Elegir Fecha */}
              {step === 2 && (
                <div>
                  <h2 className="font-semibold text-gray-700 mb-3">3. ¿Qué día vienes?</h2>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    onChange={(e) => fetchHorarios(e.target.value)}
                    className="w-full p-4 border border-gray-200 rounded-xl bg-white"
                  />
                  {loading && <p className="mt-4 text-center text-sm text-gray-500">Buscando espacios libres...</p>}
                </div>
              )}

              {/* PASO 3: Elegir Hora */}
              {step === 3 && (
                <div>
                  <h2 className="font-semibold text-gray-700 mb-3">4. Horarios para el {booking.fecha}</h2>
                  {slots.length === 0 ? (
                    <p className="text-red-500">No hay espacios disponibles este día.</p>
                  ) : (
                    <div className="grid grid-cols-3 gap-3">
                      {slots.map(hora => (
                        <button
                          key={hora}
                          onClick={() => {
                            setBooking({ ...booking, hora });
                            setStep(4);
                          }}
                          className="p-3 bg-white border border-gray-200 rounded-xl font-medium active:bg-black active:text-white"
                        >
                          {hora}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* PASO 4: Datos del Cliente */}
              {step === 4 && (
                <form onSubmit={confirmarCita} className="space-y-4">
                  <h2 className="font-semibold text-gray-700">5. Tus datos para confirmar</h2>

                  <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-700 space-y-1">
                    <p>💈 Servicio: <strong>{servicioElegido?.name}</strong> (${servicioElegido?.price})</p>
                    <p>✂️ Barbero: <strong>{empleadoElegido?.name}</strong></p>
                    <p>📅 Fecha: <strong>{booking.fecha}</strong> a las <strong>{booking.hora}</strong></p>
                  </div>

                  <input
                    type="text" required placeholder="Tu Nombre"
                    value={booking.clienteNombre}
                    onChange={e => setBooking({ ...booking, clienteNombre: e.target.value })}
                    className="w-full p-4 border border-gray-200 rounded-xl"
                  />
                  <input
                    type="tel" required placeholder="Tu WhatsApp (Ej. 300 123 4567)"
                    value={booking.clienteTelefono}
                    onChange={e => setBooking({ ...booking, clienteTelefono: formatPhoneNumber(e.target.value) })}
                    className="w-full p-4 border border-gray-200 rounded-xl"
                  />

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-4 bg-black text-white font-bold rounded-xl mt-4 disabled:opacity-50"
                  >
                    {loading ? 'Agendando...' : 'Confirmar Reserva'}
                  </button>
                </form>
              )}

              {/* PASO 5: Éxito (Confirmación Inversa por WhatsApp) */}
              {step === 5 && (
                <div className="text-center p-6 bg-white border border-gray-200 rounded-2xl mt-8 shadow-sm">
                  {!waConfirmado ? (
                    <>
                      <div className="text-4xl mb-3">⏳</div>
                      <h2 className="text-xl font-bold text-gray-800 mb-1">¡Tu cita está casi lista!</h2>
                      <p className="text-sm text-gray-500 mb-4">
                        Tu turno quedó apartado. Solo se confirma cuando envíes el mensaje por WhatsApp.
                      </p>

                      <div className="text-left bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-700 border border-gray-100">
                        <p>💈 <strong>Servicio:</strong> {servicioElegido?.name || booking.servicioId}</p>
                        <p>✂️ <strong>Barbero:</strong> {empleadoElegido?.name || booking.empleadoId}</p>
                        <p>📅 <strong>Fecha:</strong> {booking.fecha}</p>
                        <p>🕐 <strong>Hora:</strong> {booking.hora}</p>
                      </div>

                      {/* Bloque de validación humana obligatoria */}
                      {negocio.whatsapp && (
                        <div className="mt-6 p-5 bg-green-50 border border-green-200 rounded-xl">
                          <h3 className="font-bold text-green-900 mb-2">Último paso obligatorio</h3>
                          <p className="text-sm text-green-800 mb-4">
                            Para evitar reservas falsas, requerimos que confirmes esta cita desde tu WhatsApp real.
                          </p>

                          <a
                            href={`https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(`Hola, soy ${booking.clienteNombre}. Acabo de agendar un turno de ${servicioElegido?.name || booking.servicioId} con ${empleadoElegido?.name || booking.empleadoId} para el ${booking.fecha} a las ${booking.hora}. ¡Confirmo mi asistencia!`)}`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => setWaConfirmado(true)}
                            className="block w-full py-3.5 bg-green-500 text-white font-bold rounded-xl text-center shadow hover:bg-green-600 transition-colors"
                          >
                            ✅ Confirmar mi cita por WhatsApp
                          </a>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="text-4xl mb-3">✅</div>
                      <h2 className="text-xl font-bold text-gray-800 mb-1">¡Cita confirmada!</h2>
                      <p className="text-sm text-gray-500 mb-4">
                        Tu mensaje fue enviado por WhatsApp. Te esperamos el {booking.fecha} a las {booking.hora}.
                      </p>

                      <div className="text-left bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-700 border border-gray-100">
                        <p>💈 <strong>Servicio:</strong> {servicioElegido?.name || booking.servicioId}</p>
                        <p>✂️ <strong>Barbero:</strong> {empleadoElegido?.name || booking.empleadoId}</p>
                        <p>📅 <strong>Fecha:</strong> {booking.fecha}</p>
                        <p>🕐 <strong>Hora:</strong> {booking.hora}</p>
                      </div>
                      <p className="mt-4 text-sm text-gray-500">
                        💡 Llega <strong>5 minutos antes</strong> de tu cita.
                      </p>
                    </>
                  )}

                  <div className="mt-6 flex justify-center">
                    <button
                      onClick={volverAlMenu}
                      className="text-sm text-gray-500 font-medium hover:text-gray-700 underline"
                    >
                      Volver al inicio
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ESCALAMIENTO A AGENTE: botón flotante de WhatsApp */}
      {negocio?.whatsapp && (
        <a
          href={`https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent('Hola, tengo una duda sobre una cita')}`}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-6 right-6 z-50 w-14 h-14 bg-green-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-green-600"
          aria-label="Hablar con un asesor por WhatsApp"
          title="¿Dudas? Háblanos por WhatsApp"
        >
          <svg viewBox="0 0 32 32" className="w-7 h-7 fill-current">
            <path d="M16.004 3C9.383 3 4 8.383 4 15.004c0 2.117.555 4.184 1.609 6.004L4 29l8.156-1.57A11.94 11.94 0 0 0 16.004 29C22.625 29 28 23.617 28 17.004S22.625 3 16.004 3zm0 23.5c-1.746 0-3.457-.469-4.957-1.352l-.355-.211-4.84.93.918-4.719-.231-.37A9.94 9.94 0 0 1 6.5 15.004C6.5 9.746 10.746 5.5 16.004 5.5s9.504 4.246 9.504 9.504-4.246 9.5-9.504 9.5zm5.219-7.117c-.285-.145-1.687-.832-1.949-.926-.262-.094-.453-.145-.644.145-.191.285-.738.926-.906 1.117-.168.191-.332.211-.617.066-.285-.145-1.207-.445-2.301-1.418-.852-.762-1.426-1.703-1.594-1.988-.168-.285-.016-.441.129-.582.129-.129.285-.336.426-.504.141-.168.191-.285.285-.473.094-.191.047-.355-.023-.5-.074-.145-.644-1.551-.883-2.125-.234-.566-.469-.488-.644-.5-.168-.008-.355-.008-.543-.008-.191 0-.5.07-.762.355-.262.285-1 .977-1 2.383s1.023 2.766 1.168 2.957c.141.191 2.012 3.074 4.875 4.309.68.293 1.211.469 1.625.602.684.215 1.305.184 1.797.113.547-.082 1.687-.691 1.926-1.355.238-.668.238-1.238.168-1.355-.074-.121-.266-.191-.551-.336z" />
          </svg>
        </a>
      )}
    </div>
  );
}