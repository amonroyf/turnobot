import { useState, useEffect } from 'react';
import { auth, provider, db } from './firebase';
import usePushNotifications from './usePushNotifications';
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { fechaHoyEnZona, sumarDias, diaKeyEnZona, horaEnZona, formatearFechaLarga, formatearTelefono, fechaHoraAUtc } from './fecha.js';
import { IconoCalendario, IconoUsuarios, IconoAjustes } from './Iconos.jsx';

const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
const defaultHorario = {
  lunes:     { activo: true,  turnos: [{ inicio: '09:00', fin: '13:00' }, { inicio: '14:00', fin: '18:00' }] },
  martes:    { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  miercoles: { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  jueves:    { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  viernes:   { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  sabado:    { activo: true,  turnos: [{ inicio: '09:00', fin: '14:00' }] },
  domingo:   { activo: false, turnos: [] },
};

export function HorarioEmpleadoModal({ negocioId, empleado, onClose }) {
  const [horario, setHorario] = useState(() => {
    const base = empleado.horario || {};
    const completo = {};
    for (const d of DIAS_SEMANA) {
      const dia = base[d] || defaultHorario[d];
      completo[d] = {
        activo: dia.activo ?? false,
        turnos: Array.isArray(dia.turnos) && dia.turnos.length > 0 ? dia.turnos : [],
      };
    }
    return completo;
  });
  const [guardando, setGuardando] = useState(false);

  const toggleDia = (dia) => {
    const actual = horario[dia] || { activo: false, turnos: [] };
    setHorario({ ...horario, [dia]: { ...actual, activo: !actual.activo } });
  };

  const handleTurnoChange = (dia, index, field, value) => {
    const nuevosTurnos = [...(horario[dia]?.turnos || [])];
    nuevosTurnos[index] = { ...nuevosTurnos[index], [field]: value };
    setHorario({ ...horario, [dia]: { ...horario[dia], turnos: nuevosTurnos } });
  };

  const agregarTurno = (dia) => {
    const actuales = horario[dia]?.turnos || [];
    if (actuales.length >= 4) return;

    // Sugerencia inteligente: arrancar 1h después del fin del último turno
    // (tope 22:00, fin tope 23:59) para no duplicar el estático 14:00-18:00.
    const aMinutos = (h) => {
      const [hh, mm] = String(h || '14:00').split(':').map(Number);
      return hh * 60 + (mm || 0);
    };
    const aHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    let nuevoInicio = '14:00';
    let nuevoFin = '18:00';
    if (actuales.length > 0) {
      const finUltimo = aMinutos(actuales[actuales.length - 1].fin);
      if (finUltimo >= 14 * 60 && finUltimo < 21 * 60) {
        const ini = Math.min(finUltimo + 60, 22 * 60);
        const fin = Math.min(ini + 180, 23 * 60 + 59);
        if (fin > ini) {
          nuevoInicio = aHHMM(ini);
          nuevoFin = aHHMM(fin);
        }
      }
    }

    setHorario({
      ...horario,
      [dia]: { ...horario[dia], turnos: [...actuales, { inicio: nuevoInicio, fin: nuevoFin }] },
    });
  };

  const eliminarTurno = (dia, index) => {
    const nuevosTurnos = (horario[dia]?.turnos || []).filter((_, i) => i !== index);
    setHorario({ ...horario, [dia]: { ...horario[dia], turnos: nuevosTurnos } });
  };

  const guardarHorario = async () => {
    setGuardando(true);
    try {
      const empRef = doc(db, `negocios/${negocioId}/empleados`, empleado.id);
      await updateDoc(empRef, { horario });
      alert(`Horario de ${empleado.name} actualizado`);
      onClose();
    } catch (err) {
      alert(`Error al guardar el horario.`);
    }
    setGuardando(false);
  };

  // MEJORA 5: Prevención de errores humanos (Inicio >= Fin y solapamientos)
  const errorValidacion = (() => {
    for (const dia of DIAS_SEMANA) {
      const data = horario[dia];
      if (data?.activo && data?.turnos) {
        // Validación 1: Inicio vs Fin
        for (const t of data.turnos) {
          if (t.inicio && t.fin && t.inicio >= t.fin) {
            return `Revisa el ${dia}: La hora de fin debe ser posterior a la de inicio.`;
          }
        }

        // Validación 2: solapamiento entre turnos (ordenados por inicio)
        if (data.turnos.length > 1) {
          const turnosOrdenados = [...data.turnos].sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
          for (let i = 0; i < turnosOrdenados.length - 1; i++) {
            if (turnosOrdenados[i].fin > turnosOrdenados[i + 1].inicio) {
              return `Revisa el ${dia}: Los turnos de trabajo no pueden solaparse.`;
            }
          }
        }
      }
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <h3 className="text-lg font-bold mb-1 text-gray-900">Horario de trabajo</h3>
        <p className="text-sm text-gray-500 mb-1">{empleado.name}</p>
        <p className="text-[11px] text-gray-400 font-medium mb-4">Días y turnos en que recibe reservas. Lo que desmarques queda cerrado.</p>

        {errorValidacion && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl font-medium">
            {errorValidacion}
          </div>
        )}

        <div className="space-y-4">
          {DIAS_SEMANA.map((dia) => (
            <div key={dia} className="border-b border-gray-100 pb-3">
              <div className="flex justify-between items-center mb-2">
                <span className="capitalize font-semibold text-gray-800">{dia}</span>
                <input
                  type="checkbox"
                  checked={horario[dia]?.activo ?? false}
                  onChange={() => toggleDia(dia)}
                  className="w-5 h-5 accent-black"
                />
              </div>
              {horario[dia]?.activo && (
                <div className="space-y-2 pl-2">
                  {(horario[dia].turnos || []).map((t, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="time" value={t.inicio}
                        onChange={(e) => handleTurnoChange(dia, idx, 'inicio', e.target.value)}
                        className={`border p-1.5 rounded-lg text-sm focus:outline-none ${t.inicio >= t.fin ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 focus:border-black'}`}
                      />
                      <span className="text-gray-400 font-medium">a</span>
                      <input
                        type="time" value={t.fin}
                        onChange={(e) => handleTurnoChange(dia, idx, 'fin', e.target.value)}
                        className={`border p-1.5 rounded-lg text-sm focus:outline-none ${t.inicio >= t.fin ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 focus:border-black'}`}
                      />
                      {(horario[dia].turnos || []).length > 1 && (
                        <button onClick={() => eliminarTurno(dia, idx)} className="text-red-400 hover:text-red-600 font-bold px-2 py-1 active:scale-95">✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => agregarTurno(dia)} disabled={(horario[dia].turnos || []).length >= 4} className="text-xs text-blue-600 font-bold active:scale-95 pt-1 disabled:opacity-30">
                    + Agregar Turno Partido
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm active:scale-95 transition-transform">
            Cancelar
          </button>
          <button
            onClick={guardarHorario}
            disabled={guardando || errorValidacion != null}
            className="px-5 py-2.5 bg-black text-white rounded-xl font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform shadow-md"
          >
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ServiciosEmpleadoModal({ negocioId, empleado, servicios, onClose }) {
  // Sin el array (empleado antiguo), se asume que hace todos por defecto.
  const [seleccionados, setSeleccionados] = useState(
    empleado.servicios_ids || servicios.map((s) => s.id)
  );
  const [guardando, setGuardando] = useState(false);

  const toggleServicio = (id) => {
    if (seleccionados.includes(id)) {
      setSeleccionados(seleccionados.filter((sId) => sId !== id));
    } else {
      setSeleccionados([...seleccionados, id]);
    }
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await updateDoc(doc(db, `negocios/${negocioId}/empleados`, empleado.id), {
        servicios_ids: seleccionados,
      });
      onClose();
    } catch (err) {
      alert('Error al guardar las especialidades.');
    }
    setGuardando(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
        <h3 className="text-lg font-bold mb-1 text-gray-900">Qué servicios hace</h3>
        <p className="text-sm text-gray-500 mb-1">{empleado.name}</p>
        <p className="text-[11px] text-gray-400 font-medium mb-4">Solo recibirá reservas de lo que marques aquí.</p>

        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {servicios.map((s) => (
            <label key={s.id} className="flex items-center gap-3 p-3 border border-gray-100 rounded-xl cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={seleccionados.includes(s.id)}
                onChange={() => toggleServicio(s.id)}
                className="w-5 h-5 accent-black"
              />
              <span className="text-sm font-semibold text-gray-800">{s.name}</span>
            </label>
          ))}
          {servicios.length === 0 && <p className="text-xs text-gray-400">No hay servicios creados.</p>}
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm">
            Cancelar
          </button>
          <button onClick={guardar} disabled={guardando} className="px-5 py-2.5 bg-black text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {guardando ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PinEmpleadoModal({ negocioId, empleado, onClose }) {
  const [pin, setPin] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);

  const handleGuardar = async (e) => {
    e.preventDefault();
    if (pin.length < 4) return;
    setGuardando(true);
    try {
      const user = auth.currentUser;
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocioId}/empleados/${empleado.id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pin }),
      });
      if (res.ok) {
        setExito(true);
        setTimeout(onClose, 1500);
      } else {
        alert('Error al guardar el PIN.');
      }
    } catch {
      alert('Error de conexión.');
    }
    setGuardando(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Clave de acceso de {empleado.name}</h3>
        <p className="text-xs text-gray-500 mb-4">Clave de 4 a 6 números. {empleado.name} la escribe en su enlace para ver solo sus citas. Puedes cambiarla cuando quieras.</p>
        {exito ? (
          <div className="text-center py-4">
            <p className="text-sm font-bold text-green-600">✓ PIN guardado</p>
          </div>
        ) : (
          <form onSubmit={handleGuardar} className="space-y-3">
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="w-full p-3.5 border border-gray-200 rounded-xl text-sm text-center tracking-[0.5em] focus:border-black focus:outline-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs">Cancelar</button>
              <button type="submit" disabled={guardando || pin.length < 4} className="flex-1 py-2.5 bg-black text-white font-bold rounded-xl text-xs active:scale-95 disabled:opacity-50">
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [negocio, setNegocio] = useState(null);
  const [view, setView] = useState('agenda');
  const pushNotifications = usePushNotifications(negocio?.id);

  // Toast en app para pushes que llegan con el panel abierto (primer plano):
  // el service worker solo muestra notificación del sistema en background.
  const [pushToast, setPushToast] = useState(null);
  useEffect(() => {
    const onPush = (e) => {
      const d = e.detail || {};
      setPushToast({ title: d.title || 'Nueva reserva', body: d.body || '' });
    };
    window.addEventListener('turnobot-push', onPush);
    return () => window.removeEventListener('turnobot-push', onPush);
  }, []);
  useEffect(() => {
    if (!pushToast) return;
    const t = setTimeout(() => setPushToast(null), 8000);
    return () => clearTimeout(t);
  }, [pushToast]);

  const [servicios, setServicios] = useState([]);
  const [profesionales, setProfesionales] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [infoLocal, setInfoLocal] = useState({ name: '', direccion: '', horario: '', telefono: '' });
  const [guardandoInfo, setGuardandoInfo] = useState(false);
  // Políticas de reserva (reglas del negocio, como en el mercado: Fresha,
  // Booksy y Vagaro las dejan configurar por negocio).
  const [politicas, setPoliticas] = useState({ cancel_window_hours: 24, min_notice_minutes: 0, booking_window_days: 30, max_bookings_per_phone_per_day: 3 });
  const [guardandoPoliticas, setGuardandoPoliticas] = useState(false);

  const [cancelando, setCancelando] = useState('');
  const [nuevoServicio, setNuevoServicio] = useState({ name: '', duration_minutes: 30, price: '' });
  const [nuevoProfesional, setNuevoProfesional] = useState({ name: '' });
  const [eliminando, setEliminando] = useState('');
  const [horarioModal, setHorarioModal] = useState(null);
  const [serviciosModal, setServiciosModal] = useState(null);
  const [pinModal, setPinModal] = useState(null);
  const [whatsApp, setWhatsApp] = useState('');
  const [codigoPais, setCodigoPais] = useState('57');
  const [guardandoWhatsApp, setGuardandoWhatsApp] = useState(false);
  const [contenidoCopiado, setContenidoCopiado] = useState('');
  const [searchTermClientes, setSearchTermClientes] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todas'); // 'todas' | 'activas' | 'canceladas' | 'noshow'

  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const interval = setInterval(() => setAhora(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (negocio) {
      setWhatsApp(negocio.whatsapp || '');
      setInfoLocal({
        name: negocio.name || '',
        direccion: negocio.direccion || '',
        horario: negocio.horario || '',
        telefono: negocio.telefono || ''
      });
      setPoliticas({
        cancel_window_hours: negocio.cancel_window_hours || 24,
        min_notice_minutes: negocio.min_notice_minutes ?? 0,
        booking_window_days: negocio.booking_window_days || 30,
        max_bookings_per_phone_per_day: negocio.max_bookings_per_phone_per_day || 3,
      });
    }
  }, [negocio]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const qNegocio = query(collection(db, 'negocios'), where('owner_uid', '==', currentUser.uid));
        const qs = await getDocs(qNegocio);
        if (!qs.empty) {
          const docSnap = qs.docs[0];
          setNegocio({ id: docSnap.id, ...docSnap.data() });

          onSnapshot(collection(db, `negocios/${docSnap.id}/servicios`), (snapshot) =>
            setServicios(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
          );

          onSnapshot(collection(db, `negocios/${docSnap.id}/empleados`), (snapshot) =>
            setProfesionales(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
          );

          // 1. AGENDA OPTIMIZADA: solo descarga de HOY en adelante con
          // filtro nativo (requiere índice owner_uid + date_time).
          // Medianoche en la ZONA DEL NEGOCIO (no del dispositivo): con TZ
          // distinta, la medianoche local excluiría citas reales de hoy.
          const tzAgenda = docSnap.data().timezone || 'America/Bogota';
          const inicioHoy = fechaHoraAUtc(fechaHoyEnZona(tzAgenda), '00:00', tzAgenda)
            || (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

          const qReservas = query(
            collection(db, 'reservas'),
            where('owner_uid', '==', currentUser.uid),
            where('date_time', '>=', inicioHoy)
          );

          onSnapshot(qReservas, (snapshot) => {
            const citas = snapshot.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (a.date_time?.seconds || 0) - (b.date_time?.seconds || 0));
            setReservas(citas);
          }, (error) => console.error("Error consultando reservas:", error));

          // NOTA: la suscripción pasiva de Clientes se eliminó de aquí; el
          // CRM usa lazy loading en el useEffect de abajo.
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // 2. LAZY LOADING DEL CRM: solo descarga si el usuario entra a la vista
  useEffect(() => {
    if (user && view === 'clientes' && clientes.length === 0) {
      const qClientes = query(collection(db, 'clientes'), where('owner_uid', '==', user.uid));
      const unsub = onSnapshot(qClientes, (snapshot) => {
        setClientes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
      }, (error) => console.error("Error cargando CRM:", error));
      return unsub;
    }
  }, [user, view, clientes.length]);

  const logout = () => signOut(auth);

  // Prueba de push: envía una notificación a los dispositivos del dueño para
  // verificar que llegan (útil al activar en un celular nuevo).
  const [probandoPush, setProbandoPush] = useState(false);
  const [pushTestMsg, setPushTestMsg] = useState('');
  const enviarPushPrueba = async () => {
    if (!user || !negocio || probandoPush) return;
    setProbandoPush(true);
    setPushTestMsg('');
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/push-test`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${idToken}` },
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        setPushTestMsg(data.sent > 0
          ? `✅ Prueba enviada (${data.sent}/${data.total}). Revisa tus dispositivos.`
          : '⚠️ No se pudo enviar a ningún dispositivo. Desactiva y vuelve a activar las notificaciones.');
      } else {
        setPushTestMsg('⚠️ No se pudo enviar la prueba. Intenta de nuevo.');
      }
    } catch {
      setPushTestMsg('⚠️ Error de red al enviar la prueba.');
    }
    setProbandoPush(false);
  };

  const copiarContenido = async (tipo) => {
    const url = `${window.location.origin}/shop/${negocio.id}`;
    const mensajeWhatsApp = `¡Hola! 👋 Te compartimos nuestro enlace de agendamiento en línea de *${negocio.name}*\n\nAhora puedes elegir tu servicio, ver nuestros horarios disponibles en tiempo real y reservar tu cita en segundos sin esperar confirmación:\n👉 ${url}\n\n¡Te esperamos! ✨`;
    const contenido = tipo === 'enlace' ? url : mensajeWhatsApp;

    try {
      await navigator.clipboard.writeText(contenido);
      setContenidoCopiado(tipo);
      setTimeout(() => setContenidoCopiado(''), 2500);
    } catch {
      prompt(
        tipo === 'enlace' ? 'Copia este enlace para tus clientes:' : 'Copia este mensaje para tus clientes:',
        contenido,
      );
    }
  };

  // Avisa al backend para limpiar su caché en RAM tras mutaciones vía SDK.
  const invalidarCache = async () => {
    try {
      const token = await user.getIdToken();
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/cache/invalidate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.error('No se pudo invalidar caché:', err);
    }
  };

  // Políticas de reserva: el dueño define sus reglas (como en el mercado).
  // Se guardan en el negocio y aplican de inmediato (con caché invalidada).
  const handleGuardarPoliticas = async (e) => {
    e.preventDefault();
    const limpio = {
      cancel_window_hours: Math.min(72, Math.max(1, Number(politicas.cancel_window_hours) || 24)),
      min_notice_minutes: Math.max(0, Number(politicas.min_notice_minutes) || 0),
      booking_window_days: Math.min(365, Math.max(1, Number(politicas.booking_window_days) || 30)),
      max_bookings_per_phone_per_day: Math.min(20, Math.max(1, Number(politicas.max_bookings_per_phone_per_day) || 3)),
    };
    setGuardandoPoliticas(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), limpio);
      setNegocio({ ...negocio, ...limpio });
      setPoliticas(limpio);
      await invalidarCache();
      alert('Políticas actualizadas. Aplican desde ya.');
    } catch (err) {
      alert('No se pudieron guardar las políticas. Intenta nuevamente.');
    }
    setGuardandoPoliticas(false);
  };

  const handleGuardarInfoLocal = async (e) => {    e.preventDefault();
    setGuardandoInfo(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), infoLocal);
      setNegocio({ ...negocio, ...infoLocal });
      await invalidarCache();
      alert('Información actualizada');
    } catch (err) {
      alert('No se pudo actualizar la información. Intenta nuevamente.');
    }
    setGuardandoInfo(false);
  };

  const handleGuardarWhatsApp = async (e) => {
    e.preventDefault();
    const digitos = whatsApp.replace(/\D/g, '');
    const limpio = digitos.startsWith(codigoPais) ? digitos : codigoPais + digitos;
    if (limpio.length < 10) return alert('Ingresa el número local (ej. 3001234567)');
    setGuardandoWhatsApp(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), { whatsapp: limpio });
      setNegocio({ ...negocio, whatsapp: limpio });
      await invalidarCache();
      alert('WhatsApp actualizado');
    } catch (err) {
      alert('No se pudo actualizar el WhatsApp. Intenta nuevamente.');
    }
    setGuardandoWhatsApp(false);
  };

  const handleAddServicio = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, `negocios/${negocio.id}/servicios`), {
        name: nuevoServicio.name,
        duration_minutes: Number(nuevoServicio.duration_minutes),
        price: nuevoServicio.price,
      });
      setNuevoServicio({ name: '', duration_minutes: 30, price: '' });
      invalidarCache();
    } catch (err) {
      alert('Error al guardar el servicio');
    }
  };



  const handleAddProfesional = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, `negocios/${negocio.id}/empleados`), {
        name: nuevoProfesional.name,
        calendar_id: '',
        servicios_ids: servicios.map((s) => s.id),
      });
      setNuevoProfesional({ name: '' });
      invalidarCache();
    } catch (err) {
      alert('Error al guardar el profesional');
    }
  };

  const handleEliminarServicio = async (servicio) => {
    if (!confirm(`¿Eliminar "${servicio.name}"? Ya no aparecerá para reservar y se cancelarán sus citas futuras. No se puede deshacer.`)) return;
    setEliminando(servicio.id);
    try {
      const token = await user.getIdToken();
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/servicios/${servicio.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      alert('No se pudo eliminar el servicio.');
    }
    setEliminando('');
  };

  const handleEliminarProfesional = async (profesional) => {
    if (!confirm(`¿Quitar a "${profesional.name}" del equipo? Se cancelarán sus citas futuras. No se puede deshacer.`)) return;
    setEliminando(profesional.id);
    try {
      const token = await user.getIdToken();
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/empleados/${profesional.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      alert('No se pudo eliminar el profesional.');
    }
    setEliminando('');
  };

  const handleCancelarReserva = async (citaId) => {
    const r = reservas.find((item) => item.id === citaId);
    if (!r) return;

    if (!confirm(`¿Cancelar la cita de ${r.client_name}? El horario quedará libre para otros clientes.`)) return;

    setCancelando(citaId);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/citas/${citaId}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (res.ok) {
        setReservas(prev => prev.map(item => item.id === citaId ? { ...item, cancelled: true } : item));
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.message || 'No se pudo cancelar la cita. Intenta nuevamente.');
      }
    } catch (err) {
      alert('No se pudo cancelar la cita. Intenta nuevamente.');
    } finally {
      setCancelando('');
    }
  };

  const [noShowMarking, setNoShowMarking] = useState('');
  const [undoingId, setUndoingId] = useState('');

  const handleMarcarNoShow = async (citaId) => {
    if (!confirm('¿El cliente no vino? Se marcará como "No llegó" y se restará de sus visitas.')) return;
    setNoShowMarking(citaId);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/no-show/${citaId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setReservas(prev => prev.map(item => item.id === citaId ? { ...item, no_show: true } : item));
      } else {
        alert('No se pudo marcar como no-show. Intenta nuevamente.');
      }
    } catch (err) {
      alert('No se pudo marcar como no-show. Intenta nuevamente.');
    }
    setNoShowMarking('');
  };

  const handleUndo = async (citaId) => {
    if (!confirm('¿Devolver esta cita a activa? Volverá a aparecer en la agenda de hoy.')) return;
    setUndoingId(citaId);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/citas/${citaId}/undo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        setReservas(prev => prev.map(item => item.id === citaId ? { ...item, cancelled: false, no_show: false } : item));
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.message || 'No se pudo deshacer. Intenta nuevamente.');
      }
    } catch (err) {
      alert('No se pudo deshacer. Intenta nuevamente.');
    }
    setUndoingId('');
  };

  const formatDinero = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

  const fechaUltimaVisita = (c) => {
    if (c.last_date_str) {
      const larga = formatearFechaLarga(c.last_date_str);
      if (larga !== c.last_date_str) return larga;
    }
    return 'N/A';
  };

  const clientesCRM = [...clientes].sort((a, b) => (b.visits || 0) - (a.visits || 0));

  const exportarClientesCSV = () => {
    if (!clientesCRM || clientesCRM.length === 0) return;

    const headers = [
      'Nombre del Cliente',
      'Telefono / WhatsApp',
      'Numero de Visitas',
      'Total Gastado (LTV)',
      'No-shows',
      'Fecha de Ultima Cita',
    ];

    const rows = clientesCRM.map((c) => [
      `"${(c.client_name || '').replace(/"/g, '""')}"`,
      `"${(c.cliente_phone || '').replace(/"/g, '""')}"`,
      c.visits || 0,
      c.total_spent || 0,
      Math.max(0, c.no_shows || 0),
      `"${(fechaUltimaVisita(c) || 'N/A').replace(/"/g, '""')}"`,
    ]);

    const csvContent =
      '\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `clientes-${negocio.id}-${fechaHoyEnZona(negocio.timezone)}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Agrupación Hoy/Mañana/Próximas en la zona del negocio (no del dispositivo).
  const zonaNegocio = negocio?.timezone || 'America/Bogota';
  const keyHoy = fechaHoyEnZona(zonaNegocio);
  const keyManana = sumarDias(keyHoy, 1);
  const keyPasado = sumarDias(keyHoy, 2);

  const citasHoy = reservas.filter(r => {
    const t = r.date_time?.seconds * 1000;
    return t && diaKeyEnZona(t, zonaNegocio) === keyHoy;
  });
  const citasManana = reservas.filter(r => {
    const t = r.date_time?.seconds * 1000;
    return t && diaKeyEnZona(t, zonaNegocio) === keyManana;
  });
  const citasProximas = reservas.filter(r => {
    const t = r.date_time?.seconds * 1000;
    return t && diaKeyEnZona(t, zonaNegocio) >= keyPasado;
  });

  // Función agrupadora: bloques visuales por hora (en zona del negocio).
  const agruparPorHora = (citasArray) => {
    const agrupadas = {};
    citasArray.forEach(r => {
      const timeMs = r.date_time?.seconds * 1000;
      const horaStr = timeMs ? horaEnZona(timeMs, zonaNegocio) : 'N/A';

      if (!agrupadas[horaStr]) agrupadas[horaStr] = [];
      agrupadas[horaStr].push(r);
    });

    const horasOrdenadas = Object.keys(agrupadas).sort();
    return horasOrdenadas.map(hora => ({ hora, citas: agrupadas[hora] }));
  };

  const RenderCitaCard = ({ r }) => {
    const timeMs = r.date_time?.seconds * 1000;
    const durationMs = (r.duration_minutes || 60) * 60000;
    const endTimeMs = timeMs + durationMs;
    const isPast = endTimeMs < ahora;
    const isNoShow = r.no_show === true;
    const isCancelled = r.cancelled === true;
    const profesional = profesionales.find((p) => p.id === r.emp_id);
    const horaStr = timeMs ? horaEnZona(timeMs, zonaNegocio) : '--:--';
    const isToday = timeMs ? diaKeyEnZona(timeMs, zonaNegocio) === diaKeyEnZona(ahora, zonaNegocio) : false;

    // Estilo de tarjeta según estado
    let cardStyle = 'bg-white border-gray-200 shadow-sm hover:shadow-md';
    let dotColor = 'bg-green-500';
    if (isNoShow) {
      cardStyle = 'bg-amber-50 border-amber-200 opacity-90';
      dotColor = 'bg-amber-500';
    } else if (isCancelled) {
      cardStyle = 'bg-red-50 border-red-200 opacity-80';
      dotColor = 'bg-red-500';
    } else if (isPast) {
      cardStyle = 'bg-gray-50 border-gray-200 opacity-70 grayscale-[0.5]';
      dotColor = 'bg-gray-400';
    }

    return (
      <div className="flex gap-3 items-stretch relative">
        {/* Timeline Line & Time */}
        <div className="flex flex-col items-center min-w-[50px] shrink-0">
          <span className="text-xs font-bold text-gray-800 bg-gray-100 px-2 py-1 rounded-md mb-1">{horaStr}</span>
          <div className="w-px h-full bg-gray-200 relative">
            <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full ${dotColor} border-2 border-white shadow-sm`}></div>
          </div>
        </div>

        {/* Card Content */}
        <div className={`flex-1 p-4 rounded-2xl border transition-all mb-4 ${cardStyle}`}>
          <div className="flex justify-between items-start gap-2">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-bold text-gray-900 text-sm">{r.client_name}</h4>
                {isNoShow && <span className="text-[9px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded uppercase tracking-wider">No llegó</span>}
                {isCancelled && <span className="text-[9px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded uppercase tracking-wider">Cancelada</span>}
              </div>
              <div className="space-y-1 mt-2">
                <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <span className="text-gray-400">📋</span> {r.service_name}
                </p>
                <p className="text-xs text-gray-600 flex items-center gap-1.5">
                  <span className="text-gray-400">👤</span> {profesional?.name || 'Sin Asignar'}
                </p>
                <p className="text-xs text-green-700 font-medium flex items-center gap-1.5 mt-1">
                  <span className="text-gray-400">📞</span> {formatearTelefono(r.user_phone)}
                </p>
                {r.notes && (
                  <div className="mt-2 p-2 bg-gray-100/50 rounded-lg border border-gray-100">
                    <p className="text-xs text-gray-600 italic">"{r.notes}"</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-2 shrink-0">
              {r.price > 0 && (
                <span className="text-xs font-black text-gray-900 bg-gray-100 px-2 py-1 rounded-lg">
                  {formatDinero(r.price)}
                </span>
              )}
              {!isPast && !isNoShow && !isCancelled && (
                <a
                  href={`https://wa.me/${r.user_phone}`} target="_blank" rel="noreferrer"
                  className="mt-1 text-[10px] text-green-700 bg-green-50 hover:bg-green-100 px-2 py-1.5 rounded-md font-bold transition-colors flex items-center gap-1 border border-green-200"
                >
                  WhatsApp
                </a>
              )}
            </div>
          </div>

          {/* Acciones */}
          {!isNoShow && !isCancelled && (
            <div className="flex justify-end pt-3 mt-3 border-t border-gray-100/80 gap-2">
              {(isPast || (r.date_time?.seconds * 1000 <= ahora)) && (
                <button
                  onClick={() => handleMarcarNoShow(r.id)}
                  disabled={noShowMarking === r.id}
                  className="text-[11px] text-gray-600 font-semibold hover:text-amber-700 active:scale-95 transition-all px-3 py-1.5 rounded-lg border border-transparent hover:border-amber-200 hover:bg-amber-50 disabled:opacity-50"
                >
                  {noShowMarking === r.id ? 'Marcando...' : 'No Llegó'}
                </button>
              )}
              <button
                onClick={() => handleCancelarReserva(r.id)} disabled={cancelando === r.id}
                className="text-[11px] text-red-600 font-semibold active:scale-95 transition-all px-3 py-1.5 rounded-lg border border-red-100 bg-red-50 hover:bg-red-100"
              >
                {cancelando === r.id ? '...' : 'Cancelar'}
              </button>
            </div>
          )}
          {/* Deshacer (solo citas de hoy canceladas/no-show) */}
          {(isCancelled || isNoShow) && isToday && (
            <div className="flex justify-end pt-3 mt-3 border-t border-gray-100/80">
              <button
                onClick={() => handleUndo(r.id)}
                disabled={undoingId === r.id}
                className="text-[11px] text-blue-600 font-semibold hover:text-blue-800 active:scale-95 transition-all px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
              >
                {undoingId === r.id ? 'Deshaciendo...' : '↩️ Deshacer'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) return <div className="p-8 text-center text-gray-500 font-medium">Cargando panel...</div>;
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <p className="text-xs font-black tracking-widest text-gray-400 uppercase mb-2">TurnoBot</p>
          <h1 className="text-3xl font-extrabold text-gray-900">Panel del Negocio</h1>
          <p className="mt-2 text-sm text-gray-600">Gestiona tus citas, servicios y equipo</p>
        </div>
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-6 shadow rounded-2xl border border-gray-100">
            <button onClick={() => signInWithPopup(auth, provider)} className="w-full p-4 bg-black text-white font-bold rounded-xl shadow-md active:scale-95 transition-transform text-sm">
              Iniciar Sesión con Google
            </button>
            <p className="mt-4 text-center text-xs text-gray-400">Solo el dueño del negocio puede acceder.</p>
          </div>
        </div>
      </div>
    );
  }
  if (!negocio) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <p className="text-xs font-black tracking-widest text-gray-400 uppercase mb-2">TurnoBot</p>
          <h1 className="text-3xl font-extrabold text-gray-900">Panel del Negocio</h1>
          <p className="mt-2 text-sm text-gray-600">Aún no has configurado tu negocio.</p>
        </div>
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-6 shadow rounded-2xl border border-gray-100">
            <a href="/register" className="block w-full p-4 bg-black text-white font-bold rounded-xl shadow-md text-center active:scale-95 transition-transform text-sm">
              Crear mi negocio
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased flex flex-col">
      <header className="px-5 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm flex flex-col justify-center items-center">
        <h1 className="text-xl font-black text-gray-900 leading-none">{negocio.name}</h1>
        <p className="text-[11px] font-bold text-gray-400 mt-1 uppercase tracking-widest">Modo Administrador</p>
        <p className="text-[9px] font-medium text-gray-300 mt-0.5">v{import.meta.env.VITE_APP_VERSION || '0.1.1'}</p>
      </header>

      {pushToast && (
        <button
          onClick={() => setPushToast(null)}
          className="mx-4 mt-3 p-4 bg-black text-white rounded-2xl shadow-lg text-left active:scale-[0.99] transition-transform"
        >
          <p className="text-sm font-bold">🔔 {pushToast.title}</p>
          {pushToast.body && <p className="text-xs opacity-80 mt-1">{pushToast.body}</p>}
        </button>
      )}

      <main className="p-4 space-y-6 flex-1">
        {/* PESTAÑA: AGENDA */}
        {view === 'agenda' && (
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 gap-3">
              <button onClick={() => copiarContenido('enlace')} className="w-full min-h-[48px] py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-md flex items-center justify-center gap-2 text-sm active:scale-95 transition-transform">
                {contenidoCopiado === 'enlace' ? '✅ ¡Enlace copiado!' : '🔗 Copiar enlace de reservas'}
              </button>
              <button onClick={() => copiarContenido('mensaje')} className="w-full py-4 bg-green-600 text-white font-bold rounded-2xl shadow-md flex items-center justify-center gap-2 text-sm active:scale-95 transition-transform">
                {contenidoCopiado === 'mensaje' ? '✅ ¡Mensaje copiado!' : '💬 Copiar mensaje para WhatsApp'}
              </button>
            </div>
            <p className="text-[11px] text-gray-400 font-medium text-center leading-relaxed">
              Para cancelar una cita, hazlo siempre desde aquí. Si borras el evento desde Google Calendar, el espacio seguirá bloqueado en tu página de reservas.
            </p>

            {/* Filtros de estado */}
            {reservas.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[
                  { key: 'todas', label: 'Todas', count: reservas.length },
                  { key: 'activas', label: 'Activas', count: reservas.filter(r => !r.cancelled && !r.no_show).length },
                  { key: 'canceladas', label: 'Canceladas', count: reservas.filter(r => r.cancelled).length },
                  { key: 'noshow', label: 'No llegó', count: reservas.filter(r => r.no_show).length },
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
            )}

            {reservas.length === 0 ? (
               <div className="py-8 text-center bg-gray-50 rounded-2xl border border-gray-200 border-dashed">
                 <div className="text-4xl mb-3">📅</div>
                 <p className="text-sm font-medium text-gray-500">No hay citas agendadas en el sistema.</p>
               </div>
            ) : (
              <div className="space-y-8">
                {/* SECCIÓN HOY */}
                {(() => {
                  const filtradas = citasHoy.filter(r => {
                    if (filtroEstado === 'activas') return !r.cancelled && !r.no_show;
                    if (filtroEstado === 'canceladas') return r.cancelled;
                    if (filtroEstado === 'noshow') return r.no_show;
                    return true;
                  });
                  return filtradas.length > 0 && (
                    <div className="mb-10">
                      <div className="sticky top-[72px] bg-gray-50/95 backdrop-blur-sm py-2 z-10 mb-4 border-b border-gray-200/50">
                        <h3 className="text-sm font-black text-gray-900 flex items-center gap-2 uppercase tracking-wider">
                          <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
                          Agenda de Hoy
                        </h3>
                      </div>
                      <div className="pl-1">
                        {filtradas.map(r => <RenderCitaCard key={r.id} r={r} />)}
                      </div>
                    </div>
                  );
                })()}

                {/* SECCIÓN MAÑANA */}
                {(() => {
                  const filtradas = citasManana.filter(r => {
                    if (filtroEstado === 'activas') return !r.cancelled && !r.no_show;
                    if (filtroEstado === 'canceladas') return r.cancelled;
                    if (filtroEstado === 'noshow') return r.no_show;
                    return true;
                  });
                  return filtradas.length > 0 && (
                    <div className="mb-10">
                      <div className="sticky top-[72px] bg-gray-50/95 backdrop-blur-sm py-2 z-10 mb-4 border-b border-gray-200/50">
                        <h3 className="text-sm font-black text-gray-700 flex items-center gap-2 uppercase tracking-wider">
                          <span className="w-2.5 h-2.5 rounded-full bg-blue-400"></span>
                          Mañana
                        </h3>
                      </div>
                      <div className="pl-1">
                        {filtradas.map(r => <RenderCitaCard key={r.id} r={r} />)}
                      </div>
                    </div>
                  );
                })()}

                {/* SECCIÓN PRÓXIMAS */}
                {(() => {
                  const filtradas = citasProximas.filter(r => {
                    if (filtroEstado === 'activas') return !r.cancelled && !r.no_show;
                    if (filtroEstado === 'canceladas') return r.cancelled;
                    if (filtroEstado === 'noshow') return r.no_show;
                    return true;
                  });
                  return filtradas.length > 0 && (
                    <div>
                      <div className="sticky top-[72px] bg-gray-50/95 backdrop-blur-sm py-2 z-10 mb-4 border-b border-gray-200/50">
                        <h3 className="text-sm font-black text-gray-500 flex items-center gap-2 uppercase tracking-wider">
                          <span className="w-2.5 h-2.5 rounded-full bg-gray-300"></span>
                          Días Siguientes
                        </h3>
                      </div>
                      <div className="pl-1">
                        {filtradas.map(r => {
                          const timeMs = r.date_time?.seconds * 1000;
                          const fechaStr = timeMs ? diaKeyEnZona(timeMs, zonaNegocio) : '';
                          return (
                            <div key={r.id}>
                              <div className="text-[10px] font-bold text-gray-400 ml-16 mb-2 uppercase tracking-wider">
                                {formatearFechaLarga(fechaStr)}
                              </div>
                              <RenderCitaCard r={r} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}

        {/* PESTAÑA: CLIENTES (CRM) */}
        {view === 'clientes' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              {/* Encabezado y Acciones */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-5">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                    <span className="text-xl">👥</span> Directorio de Clientes
                    <span className="bg-gray-100 text-gray-600 text-xs py-0.5 px-2 rounded-full font-semibold">
                      {clientesCRM.length}
                    </span>
                  </h2>
                  <p className="text-xs text-gray-500 font-medium mt-1">
                    Ordenados por fidelidad (LTV = Ganancia Total).
                  </p>
                </div>
                {clientesCRM.length > 0 && (
                  <button
                    onClick={exportarClientesCSV}
                    className="py-2.5 px-4 bg-green-50 hover:bg-green-100 text-green-700 font-bold rounded-xl text-xs flex items-center gap-2 transition-colors border border-green-200 w-full sm:w-auto justify-center"
                  >
                    <span>📊</span> Descargar Excel / CSV
                  </button>
                )}
              </div>

              {/* Barra de Búsqueda */}
              {clientesCRM.length > 0 && (
                <div className="relative mb-6">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-400">🔍</span>
                  </div>
                  <input
                    type="text"
                    placeholder="Buscar cliente por nombre o teléfono..."
                    value={searchTermClientes}
                    onChange={(e) => setSearchTermClientes(e.target.value)}
                    className="block w-full pl-10 pr-3 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors"
                  />
                </div>
              )}

              {/* Lista Vacía */}
              {clientesCRM.length === 0 ? (
                <div className="py-12 text-center bg-gray-50 rounded-2xl border border-gray-200 border-dashed">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="text-sm font-bold text-gray-700">Tu agenda está lista</p>
                  <p className="text-xs text-gray-500 mt-1">Los clientes aparecerán aquí automáticamente cuando reserven.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Lista Filtrada y Mapeada */}
                  {(() => {
                    const filtrados = clientesCRM.filter(c =>
                      (c.client_name || '').toLowerCase().includes(searchTermClientes.toLowerCase()) ||
                      (c.cliente_phone || '').includes(searchTermClientes)
                    );

                    if (filtrados.length === 0) {
                      return (
                        <div className="py-8 text-center text-gray-500 text-sm font-medium">
                          No se encontraron clientes con "{searchTermClientes}".
                        </div>
                      );
                    }

                    return filtrados.map((c, index) => {
                      // Top 3 clientes reciben una medalla visual
                      const isTop3 = index < 3 && !searchTermClientes;

                      return (
                        <div key={c.id} className="p-4 bg-white border border-gray-100 rounded-2xl shadow-sm hover:shadow-md transition-shadow relative overflow-hidden group">
                          {/* Etiqueta lateral verde sutil para los mejores clientes */}
                          {isTop3 && <div className="absolute left-0 top-0 bottom-0 w-1 bg-green-500"></div>}

                          <div className="flex justify-between items-start gap-4">
                            {/* Info Principal */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5">
                                <h3 className="font-bold text-gray-900 text-base truncate">
                                  {c.client_name}
                                </h3>
                                {isTop3 && <span title="Cliente VIP" className="text-sm">🌟</span>}
                                {(c.no_shows || 0) > 0 && (
                                  <span title="Veces que no llegó a su cita" className="text-[10px] font-black bg-amber-600 text-white px-2 py-0.5 rounded-full shrink-0">
                                    ⚠️ {c.no_shows} no llegó
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-600 mb-3">
                                <p className="flex items-center gap-1">
                                  <span className="text-gray-400">📅</span>
                                  Última vez: <span className="font-medium text-gray-800">{fechaUltimaVisita(c)}</span>
                                </p>
                                <p className="flex items-center gap-1">
                                  <span className="text-gray-400">🔄</span>
                                  <span className="font-medium text-gray-800">{Math.max(0, c.visits || 0)}</span> reservas
                                </p>
                              </div>

                              {/* Botón WhatsApp de Acción Rápida */}
                              <a
                                href={`https://wa.me/${c.cliente_phone}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs text-green-700 font-bold bg-green-50 hover:bg-green-100 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-green-200"
                              >
                                💬 WhatsApp: {formatearTelefono(c.cliente_phone)}
                              </a>
                            </div>

                            {/* Info Financiera: lo que este cliente ha gastado en total */}
                            <div className="text-right shrink-0 flex flex-col items-end">
                              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                Total gastado
                              </p>
                              <span className="block text-base font-black text-green-700 bg-green-50 px-3 py-1.5 rounded-xl border border-green-100">
                                {formatDinero(Math.max(0, c.total_spent || 0))}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PESTAÑA: AJUSTES */}
        {view === 'ajustes' && (
          <div className="space-y-5">
            {/* WHATSAPP DEL NEGOCIO */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">WhatsApp de reservas</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">A este número te avisamos cuando un cliente reserve. También aparece como contacto en tu página de reservas.</p>
              <form onSubmit={handleGuardarWhatsApp} className="space-y-3">
                <div className="flex gap-2">
                  <label>
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">País</span>
                  <select
                    value={codigoPais}
                    onChange={(e) => setCodigoPais(e.target.value)}
                    aria-label="Código de país"
                    className="p-3.5 border border-gray-200 rounded-xl text-sm bg-white font-bold focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  >
                    <option value="57">🇨🇴 +57</option>
                    <option value="52">🇲🇽 +52</option>
                    <option value="51">🇵🇪 +51</option>
                    <option value="56">🇨🇱 +56</option>
                    <option value="54">🇦🇷 +54</option>
                    <option value="34">🇪🇸 +34</option>
                    <option value="1">🇺🇸 +1</option>
                  </select>
                  </label>
                  <label className="flex-1 min-w-0">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Número de WhatsApp</span>
                  <input
                    type="tel" inputMode="numeric" value={whatsApp}
                    onChange={(e) => setWhatsApp(e.target.value)}
                    placeholder="Ej. 3001234567"
                    aria-label="Número de WhatsApp del negocio"
                    className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  />
                  </label>
                </div>
                <button type="submit" disabled={guardandoWhatsApp} className="w-full py-3.5 bg-green-600 text-white font-bold rounded-xl text-sm disabled:opacity-50 active:scale-95 transition-transform shadow-sm">
                  {guardandoWhatsApp ? 'Guardando...' : 'Actualizar WhatsApp'}
                </button>
              </form>
            </div>

            {/* NOTIFICACIONES PUSH */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">🔔 Avisos de nuevas reservas</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">Te avisamos en este dispositivo al instante cuando un cliente reserve, sin tener el panel abierto.</p>
              {pushNotifications.permission === 'denied' ? (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl" role="alert">
                  <p className="text-xs font-bold text-red-700">
                    ❌ Los avisos están bloqueados en este navegador.
                  </p>
                  <p className="text-[11px] text-red-600 mt-1">Actívalos en los ajustes del navegador para este sitio y vuelve aquí.</p>
                </div>
              ) : pushNotifications.isSubscribed ? (
                <div className="space-y-3">
                  <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                    <p className="text-xs font-bold text-green-800">✅ Avisos activados en este dispositivo</p>
                    <p className="text-[11px] text-green-700 mt-1">Recibirás un aviso con cada reserva nueva.</p>
                  </div>
                  <button
                    onClick={enviarPushPrueba}
                    disabled={probandoPush}
                    className="w-full min-h-[44px] py-3 bg-blue-50 text-blue-700 font-bold rounded-xl text-xs border border-blue-200 active:scale-95 transition-transform disabled:opacity-50"
                  >
                    {probandoPush ? '⏳ Enviando prueba...' : '📨 Enviarme una prueba'}
                  </button>
                  {pushTestMsg && (
                    <p role="status" className="text-xs font-bold text-center p-3 rounded-xl bg-gray-50 border border-gray-200 text-gray-700">{pushTestMsg}</p>
                  )}
                  <button
                    onClick={pushNotifications.unsubscribe}
                    className="w-full min-h-[44px] py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs active:scale-95 transition-transform"
                  >
                    Dejar de recibir avisos aquí
                  </button>
                </div>
              ) : (
                <button
                  onClick={pushNotifications.subscribe}
                  className="w-full min-h-[48px] py-3.5 bg-blue-600 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform shadow-sm"
                >
                  🔔 Activar avisos en este dispositivo
                </button>
              )}
            </div>

            {/* POLÍTICAS DE RESERVA */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Tus reglas de reserva</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">Como en las grandes plataformas: tú defines los tiempos y topes. Aplican desde que guardas.</p>
              <form onSubmit={handleGuardarPoliticas} className="space-y-4">
                <label className="block">
                  <span className="block text-xs font-bold text-gray-700 mb-1">El cliente puede cancelar hasta…</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" required min={1} max={72} inputMode="numeric"
                      value={politicas.cancel_window_hours}
                      onChange={(e) => setPoliticas({ ...politicas, cancel_window_hours: e.target.value })}
                      aria-label="Horas mínimas de antelación para cancelar"
                      className="w-24 p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                    <span className="text-xs text-gray-500 font-medium">horas antes de su cita (lo usual: 24h; spa/salud: 48h). Pasado ese punto, solo tú o tu equipo pueden cancelar.</span>
                  </div>
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Aviso mínimo (min)</span>
                    <input
                      type="number" min={0} max={10080} inputMode="numeric"
                      value={politicas.min_notice_minutes}
                      onChange={(e) => setPoliticas({ ...politicas, min_notice_minutes: e.target.value })}
                      aria-label="Antelación mínima en minutos"
                      className="w-full p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                    <span className="block text-[11px] text-gray-400 font-medium mt-1">0 = aceptas citas para ya.</span>
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Se reserva hasta (días)</span>
                    <input
                      type="number" min={1} max={365} inputMode="numeric"
                      value={politicas.booking_window_days}
                      onChange={(e) => setPoliticas({ ...politicas, booking_window_days: e.target.value })}
                      aria-label="Días máximos hacia adelante para reservar"
                      className="w-full p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                    <span className="block text-[11px] text-gray-400 font-medium mt-1">Qué tan lejos se ve el calendario.</span>
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Tope por número/día</span>
                    <input
                      type="number" min={1} max={20} inputMode="numeric"
                      value={politicas.max_bookings_per_phone_per_day}
                      onChange={(e) => setPoliticas({ ...politicas, max_bookings_per_phone_per_day: e.target.value })}
                      aria-label="Máximo de citas por número de WhatsApp al día"
                      className="w-full p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                    <span className="block text-[11px] text-gray-400 font-medium mt-1">Anti-spam (usual: 3).</span>
                  </label>
                </div>
                <button type="submit" disabled={guardandoPoliticas} className="w-full min-h-[48px] py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform disabled:opacity-50">
                  {guardandoPoliticas ? 'Guardando…' : 'Guardar reglas'}
                </button>
              </form>
            </div>

            {/* GESTIÓN DE SERVICIOS */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Servicios que ofreces</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">Lo que verán tus clientes en el paso 1 de la reserva: nombre, duración y precio.</p>
              <ul className="space-y-3 mb-4">
                {servicios.length === 0 && (
                  <div className="p-5 text-center bg-gray-50 border border-dashed border-gray-200 rounded-2xl">
                    <p className="text-sm font-bold text-gray-700">Aún no hay servicios</p>
                    <p className="text-[11px] text-gray-500 font-medium mt-1">Agrega el primero abajo 👇 para que los clientes puedan reservar.</p>
                  </div>
                )}
                {servicios.map((s) => {
                  const encargados = profesionales.filter(
                    (p) => !p.servicios_ids || p.servicios_ids.includes(s.id)
                  );
                  return (
                    <li key={s.id} className="p-3.5 bg-white border border-gray-200 shadow-2xs rounded-xl text-sm space-y-2">
                      <div className="flex justify-between items-center gap-2">
                        <div className="min-w-0">
                          <p className="font-bold text-gray-900">{s.name}</p>
                          <p className="text-xs font-medium text-gray-500">⏱️ {s.duration_minutes} min • {formatDinero(s.price)} en el local</p>
                        </div>
                        <button onClick={() => handleEliminarServicio(s)} disabled={eliminando === s.id} aria-label={`Eliminar servicio ${s.name}`} className="shrink-0 min-h-[44px] px-3 text-red-600 font-bold text-xs active:scale-95 transition-transform bg-red-50 rounded-xl border border-red-100">
                          {eliminando === s.id ? 'Eliminando…' : 'Eliminar'}
                        </button>
                      </div>
                      <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-1 items-center">
                        <span className="text-[11px] font-bold text-gray-500">Lo hacen:</span>
                        {encargados.length === 0 ? (
                          <span className="text-[11px] text-red-600 font-semibold">Nadie aún — asígnalo en “Qué servicios hace” del equipo</span>
                        ) : (
                          encargados.map((p) => (
                            <span key={p.id} className="text-[10px] font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md">
                              👤 {p.name}
                            </span>
                          ))
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>

              {/* FORMULARIO PARA AGREGAR NUEVO SERVICIO */}
              <form onSubmit={handleAddServicio} className="space-y-3 pt-3 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-800">Agregar un servicio nuevo</h3>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nombre del servicio</span>
                <input
                  type="text" required placeholder="Ej. Corte, Uñas, Limpieza" value={nuevoServicio.name}
                  onChange={(e) => setNuevoServicio({ ...nuevoServicio, name: e.target.value })}
                  aria-label="Nombre del servicio nuevo"
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                </label>
                <div className="flex gap-2">
                  <label className="flex-1 min-w-0">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Duración (min)</span>
                    <input
                      type="number" required min={1} placeholder="Ej. 30" inputMode="numeric" value={nuevoServicio.duration_minutes}
                      onChange={(e) => setNuevoServicio({ ...nuevoServicio, duration_minutes: e.target.value })}
                      className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                    />
                  </label>
                  <label className="flex-1 min-w-0">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Precio ($)</span>
                    <input
                      type="number" required min={0} placeholder="Ej. 20000" inputMode="numeric" value={nuevoServicio.price}
                      onChange={(e) => setNuevoServicio({ ...nuevoServicio, price: e.target.value })}
                      className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                    />
                  </label>
                </div>
                <button type="submit" className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform">
                  + Agregar Servicio
                </button>
              </form>
            </div>

            {/* GESTIÓN DE PROFESIONALES */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Tu equipo</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">Quienes atienden citas. Define qué servicios hace cada uno, su horario y su clave de acceso.</p>
              <ul className="space-y-3 mb-4">
                {profesionales.length === 0 && (
                  <div className="p-5 text-center bg-gray-50 border border-dashed border-gray-200 rounded-2xl">
                    <p className="text-sm font-bold text-gray-700">Aún no hay equipo</p>
                    <p className="text-[11px] text-gray-500 font-medium mt-1">Agrega a la primera persona abajo 👇 para empezar a recibir reservas.</p>
                  </div>
                )}
                {profesionales.map((p) => (
                  <li key={p.id} className="p-4 bg-white border border-gray-200 shadow-2xs rounded-xl text-sm space-y-3">
                    <div className="flex justify-between items-center gap-2">
                      <p className="font-bold text-gray-900 text-base">{p.name}</p>
                      <button onClick={() => handleEliminarProfesional(p)} disabled={eliminando === p.id} aria-label={`Quitar a ${p.name} del equipo`} className="shrink-0 min-h-[44px] px-3 bg-red-50 text-red-600 font-bold rounded-xl text-xs border border-red-100 active:scale-95 transition-transform">
                        {eliminando === p.id ? 'Quitando…' : 'Quitar'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
                      {p.calendar_id ? (
                        <span className="flex-1 text-center py-2.5 bg-green-50 text-green-700 text-[11px] font-black rounded-lg border border-green-100">✓ Google Calendar conectado</span>
                      ) : (
                        <a href={`${import.meta.env.VITE_API_URL || ''}/auth/google/login?negocio_id=${negocio.id}&emp_id=${p.id}`} className="flex-1 text-center py-2.5 bg-blue-600 text-white font-bold rounded-lg text-[11px] active:scale-95 shadow-sm min-h-[44px] flex items-center justify-center">🔗 Conectar Google Calendar</a>
                      )}
                      <button onClick={() => setServiciosModal(p)} title="Elegir qué servicios atiende esta persona" className="min-h-[44px] px-3.5 py-2 bg-gray-50 border border-gray-200 text-gray-800 font-bold rounded-lg text-[11px] flex items-center gap-1 shadow-sm active:scale-95">📋 Qué hace</button>
                      <button onClick={() => setHorarioModal(p)} title="Definir días y turnos de trabajo" className="min-h-[44px] px-3.5 py-2 bg-gray-50 border border-gray-200 text-gray-800 font-bold rounded-lg text-[11px] flex items-center gap-1 shadow-sm active:scale-95">🕒 Horario</button>
                      <button onClick={() => setPinModal(p)} title="Ver o cambiar su clave de acceso" className="min-h-[44px] px-3.5 py-2 bg-gray-50 border border-gray-200 text-gray-800 font-bold rounded-lg text-[11px] flex items-center gap-1 shadow-sm active:scale-95">🔑 Clave</button>
                    </div>
                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-[11px] font-bold text-gray-500 mb-1">Enlace para {p.name}</p>
                      <p className="text-[11px] text-gray-400 font-medium mb-2">Compártelo con {p.name} para que vea sus citas con su clave.</p>
                      <div className="flex items-center gap-2">
                      <a
                        href={`/employee/${negocio.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-blue-600 hover:text-blue-800 hover:underline truncate flex-1"
                      >
                        {window.location.origin}/employee/{negocio.id}
                      </a>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/employee/${negocio.id}`);
                          setContenidoCopiado(p.id);
                          setTimeout(() => setContenidoCopiado(''), 2000);
                        }}
                        className="min-h-[44px] px-3 text-[11px] text-gray-700 font-bold rounded-lg bg-gray-100 hover:bg-gray-200 shrink-0"
                      >
                        {contenidoCopiado === p.id ? '¡Copiado!' : 'Copiar enlace'}
                      </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {profesionales.length > 0 && profesionales.some((p) => !p.horario) && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 font-medium text-xs rounded-xl leading-relaxed" role="alert">
                  ⚠️ A alguien del equipo le falta horario. Toca <b>🕒 Horario</b> en su tarjeta para definir sus días y turnos; sin eso no recibe reservas.
                </div>
              )}
              <form onSubmit={handleAddProfesional} className="space-y-3 pt-3 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-800">Agregar a alguien al equipo</h3>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nombre de la persona</span>
                <input
                  type="text" required placeholder="Ej. Camila, Andrés…" value={nuevoProfesional.name}
                  onChange={(e) => setNuevoProfesional({ name: e.target.value })}
                  aria-label="Nombre de la persona nueva del equipo"
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                </label>
                <button type="submit" className="w-full min-h-[48px] py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform">+ Añadir al equipo</button>
              </form>
            </div>

            {/* DATOS DEL LOCAL */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Datos de tu página pública</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">Lo que ven los clientes al reservar: nombre, dónde estás y cómo contactarte.</p>
              <form onSubmit={handleGuardarInfoLocal} className="space-y-3">
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nombre del negocio</span>
                <input
                  type="text" required placeholder="Ej. Barbería El Corte" value={infoLocal.name}
                  onChange={(e) => setInfoLocal({ ...infoLocal, name: e.target.value })}
                  aria-label="Nombre del negocio"
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Dirección</span>
                <input
                  type="text" placeholder="Ej. Calle 10 # 5-20, Bogotá" value={infoLocal.direccion}
                  onChange={(e) => setInfoLocal({ ...infoLocal, direccion: e.target.value })}
                  aria-label="Dirección del local"
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Horario de atención</span>
                <input
                  type="text" placeholder="Ej. Lun a Sáb, 9am a 7pm" value={infoLocal.horario}
                  onChange={(e) => setInfoLocal({ ...infoLocal, horario: e.target.value })}
                  aria-label="Horario de atención"
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Teléfono de contacto</span>
                <input
                  type="tel" placeholder="Fijo o celular" value={infoLocal.telefono}
                  onChange={(e) => setInfoLocal({ ...infoLocal, telefono: e.target.value })}
                  aria-label="Teléfono de contacto"
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                </label>
                <button type="submit" disabled={guardandoInfo} className="w-full min-h-[48px] py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform">
                  {guardandoInfo ? 'Guardando...' : 'Guardar datos'}
                </button>
              </form>
            </div>

            {/* SOPORTE TURNOBOT */}
            <div className="bg-green-50 p-5 rounded-3xl border border-green-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Soporte TurnoBot</h2>
              <p className="text-[11px] font-medium text-gray-600 mb-4">
                ¿Necesitas ayuda? Escríbenos directamente por WhatsApp.
              </p>
              <a
                href="https://wa.me/573229124517?text=Hola%20TurnoBot%2C%20necesito%20ayuda%20con%20mi%20cuenta."
                target="_blank"
                rel="noreferrer"
                className="w-full py-3.5 bg-green-600 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-sm"
              >
                💬 Contactar soporte · 322 912 4517
              </a>
            </div>

            {/* BOTÓN CERRAR SESIÓN */}
            <div className="pt-4 pb-8 text-center">
               <button onClick={logout} className="text-sm font-bold text-red-500 bg-white border border-gray-200 px-6 py-3 rounded-2xl shadow-sm active:scale-95 transition-transform">
                  Cerrar Sesión
               </button>
            </div>
          </div>
        )}
      </main>

      <nav aria-label="Secciones del panel" className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2.5 flex justify-around items-center z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button onClick={() => setView('agenda')} aria-current={view === 'agenda' ? 'page' : undefined} className={`min-h-[48px] flex flex-col items-center justify-center gap-1 text-[11px] font-black transition-colors px-4 ${view === 'agenda' ? 'text-black' : 'text-gray-400'}`}>
          <IconoCalendario />
          <span>Agenda</span>
        </button>
        <button onClick={() => setView('clientes')} aria-current={view === 'clientes' ? 'page' : undefined} className={`min-h-[48px] flex flex-col items-center justify-center gap-1 text-[11px] font-black transition-colors px-4 ${view === 'clientes' ? 'text-black' : 'text-gray-400'}`}>
          <IconoUsuarios />
          <span>Clientes</span>
        </button>
        <button onClick={() => setView('ajustes')} aria-current={view === 'ajustes' ? 'page' : undefined} className={`min-h-[48px] flex flex-col items-center justify-center gap-1 text-[11px] font-black transition-colors px-4 ${view === 'ajustes' ? 'text-black' : 'text-gray-400'}`}>
          <IconoAjustes />
          <span>Ajustes</span>
        </button>
      </nav>

      {horarioModal && <HorarioEmpleadoModal negocioId={negocio.id} empleado={horarioModal} onClose={() => { setHorarioModal(null); invalidarCache(); }} />}
      {serviciosModal && <ServiciosEmpleadoModal negocioId={negocio.id} empleado={serviciosModal} servicios={servicios} onClose={() => { setServiciosModal(null); invalidarCache(); }} />}
      {pinModal && <PinEmpleadoModal negocioId={negocio.id} empleado={pinModal} onClose={() => setPinModal(null)} />}
    </div>
  );
}
