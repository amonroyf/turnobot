import { useState, useEffect } from 'react';
import { auth, provider, db } from './firebase';
import usePushNotifications from './usePushNotifications';
import NotificationDrawer from './NotificationDrawer';
import { DialogoProvider, useDialogo } from './ConfirmDialog.jsx';
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
import { HorarioModal } from './HorarioModal.jsx';
import RegistroManual from './RegistroManual.jsx';
import { COLORES_MARCA, colorMarca, textoSobreMarca, inicialMarca, fondoMarca } from './marca.js';

export function HorarioEmpleadoModal({ negocioId, empleado, onClose }) {
  return (
    <HorarioModal
      titulo="Horario de trabajo"
      nombre={empleado.name}
      bajada="Días y turnos en que recibe reservas. Lo que desmarques queda cerrado."
      horarioInicial={empleado.horario}
      onGuardar={async (horario) => {
        const empRef = doc(db, `negocios/${negocioId}/empleados`, empleado.id);
        await updateDoc(empRef, { horario });
      }}
      exito={`Horario de ${empleado.name} actualizado.`}
      onClose={onClose}
    />
  );
}

export function HorarioRecursoModal({ negocioId, recurso, onClose }) {
  return (
    <HorarioModal
      titulo="Horario del espacio"
      nombre={recurso.name}
      bajada="Días y turnos en que se puede reservar. Déjalo vacío para usar la jornada del negocio."
      horarioInicial={recurso.horario}
      onGuardar={async (horario) => {
        const recRef = doc(db, `negocios/${negocioId}/recursos`, recurso.id);
        await updateDoc(recRef, { horario });
      }}
      exito={`Horario de ${recurso.name} actualizado.`}
      onClose={onClose}
    />
  );
}

export function ServiciosEmpleadoModal({ negocioId, empleado, servicios, onClose }) {
  const { avisar } = useDialogo();
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
      await avisar('No se pudo guardar. Intenta de nuevo.', 'error');
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
  const { avisar } = useDialogo();
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
        await avisar('No se pudo guardar la clave. Intenta de nuevo.', 'error');
      }
    } catch {
      await avisar('Error de conexión. Intenta de nuevo.', 'error');
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

function AdminPanel() {
  const { confirmar, avisar } = useDialogo();
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
  const [recursos, setRecursos] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [infoLocal, setInfoLocal] = useState({ name: '', direccion: '', horario: '', telefono: '' });
  const [guardandoInfo, setGuardandoInfo] = useState(false);
  // Marca y propósito (identidad del negocio, gratis, sin imágenes).
  const [marca, setMarca] = useState({ color: '', eslogan: '', descripcion: '', instagram: '', facebook: '', tiktok: '' });
  const [guardandoMarca, setGuardandoMarca] = useState(false);
  // Políticas de reserva (reglas del negocio, como en el mercado: Fresha,
  // Booksy y Vagaro las dejan configurar por negocio).
  const [politicas, setPoliticas] = useState({ cancel_window_hours: 24, min_notice_minutes: 0, booking_window_days: 30, max_bookings_per_phone_per_day: 3, open_time: '09:00', close_time: '18:00' });
  const [guardandoPoliticas, setGuardandoPoliticas] = useState(false);

  const [cancelando, setCancelando] = useState('');
  const [nuevoServicio, setNuevoServicio] = useState({ name: '', duration_minutes: 30, price: '' });
  const [nuevoProfesional, setNuevoProfesional] = useState({ name: '' });
  const [nuevoRecurso, setNuevoRecurso] = useState({ name: '', tipo: 'cancha', capacidad: 1, descripcion: '', duration_minutes: 60, price: '' });
  const [editandoRecurso, setEditandoRecurso] = useState(null);
  const [editRecursoVals, setEditRecursoVals] = useState({ capacidad: 1 });
  const [guardandoRecurso, setGuardandoRecurso] = useState(false);

  const guardarRecurso = async (recurso) => {
    const capacidad = Math.min(100, Math.max(1, Number(editRecursoVals.capacidad) || 1));
    setGuardandoRecurso(true);
    try {
      await updateDoc(doc(db, `negocios/${negocio.id}/recursos`, recurso.id), { capacidad });
      setEditandoRecurso(null);
      invalidarCache();
    } catch (err) {
      await avisar('No se pudo guardar. Intenta de nuevo.', 'error');
    }
    setGuardandoRecurso(false);
  };
  const [eliminando, setEliminando] = useState('');
  const [horarioModal, setHorarioModal] = useState(null);
  const [horarioRecursoModal, setHorarioRecursoModal] = useState(null);
  const [serviciosModal, setServiciosModal] = useState(null);
  const [pinModal, setPinModal] = useState(null);
  const [whatsApp, setWhatsApp] = useState('');
  const [codigoPais, setCodigoPais] = useState('57');
  const [guardandoWhatsApp, setGuardandoWhatsApp] = useState(false);
  const [contenidoCopiado, setContenidoCopiado] = useState('');
  const [searchTermClientes, setSearchTermClientes] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('todas'); // 'todas' | 'activas' | 'canceladas' | 'noshow'
  // Registro manual de citas (dueño anota clientes sin cita previa).
  const [showRegistro, setShowRegistro] = useState(false);

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
      setMarca({
        color: negocio.marca?.color || '',
        eslogan: negocio.marca?.eslogan || '',
        descripcion: negocio.marca?.descripcion || '',
        instagram: negocio.marca?.instagram || '',
        facebook: negocio.marca?.facebook || '',
        tiktok: negocio.marca?.tiktok || '',
      });
      setPoliticas({
        cancel_window_hours: negocio.cancel_window_hours || 24,
        min_notice_minutes: negocio.min_notice_minutes ?? 0,
        booking_window_days: negocio.booking_window_days || 30,
        max_bookings_per_phone_per_day: negocio.max_bookings_per_phone_per_day || 3,
        open_time: negocio.open_time || '09:00',
        close_time: negocio.close_time || '18:00',
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

          onSnapshot(collection(db, `negocios/${docSnap.id}/recursos`), (snapshot) =>
            setRecursos(snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))),
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
      await avisar(
        tipo === 'enlace' ? `Copia este enlace para tus clientes:\n\n${contenido}` : `Copia este mensaje para tus clientes:\n\n${contenido}`,
        'info',
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
      min_notice_minutes: Math.min(10080, Math.max(0, Number(politicas.min_notice_minutes) || 0)),
      booking_window_days: Math.min(365, Math.max(1, Number(politicas.booking_window_days) || 30)),
      max_bookings_per_phone_per_day: Math.min(20, Math.max(1, Number(politicas.max_bookings_per_phone_per_day) || 3)),
    };
    // Jornada base: valida HH:MM y que el cierre sea después de la apertura.
    const horaValida = (h) => /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(h || '');
    if (!horaValida(politicas.open_time) || !horaValida(politicas.close_time) || politicas.close_time <= politicas.open_time) {
      await avisar('Revisa la jornada: usa formato 24h y el cierre después de la apertura (ej. 09:00 a 18:00).', 'error');
      return;
    }
    limpio.open_time = politicas.open_time;
    limpio.close_time = politicas.close_time;
    setGuardandoPoliticas(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), limpio);
      setNegocio({ ...negocio, ...limpio });
      setPoliticas(limpio);
      await invalidarCache();
      await avisar('Reglas actualizadas. Aplican desde ya.', 'exito');
    } catch (err) {
      await avisar('No se pudieron guardar las reglas. Intenta de nuevo.', 'error');
    }
    setGuardandoPoliticas(false);
  };

  // Marca y propósito: colores curados + textos. Sin subir fotos: el logo es
  // la inicial y la portada un degradado. Vista previa en vivo abajo.
  const handleGuardarMarca = async (e) => {
    e.preventDefault();
    const limpio = {
      color: (marca.color || '').trim(),
      eslogan: (marca.eslogan || '').trim().slice(0, 80),
      descripcion: (marca.descripcion || '').trim().slice(0, 500),
      instagram: (marca.instagram || '').trim().slice(0, 120),
      facebook: (marca.facebook || '').trim().slice(0, 120),
      tiktok: (marca.tiktok || '').trim().slice(0, 120),
    };
    if (limpio.color && !/^#[0-9a-fA-F]{6}$/.test(limpio.color)) {
      await avisar('Ese color no es válido. Elige un preset o un hex como #16A34A.', 'error');
      return;
    }
    setGuardandoMarca(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), { marca: limpio });
      setNegocio({ ...negocio, marca: limpio });
      setMarca(limpio);
      await invalidarCache();
      await avisar('Marca actualizada. Así te verán tus clientes.', 'exito');
    } catch (err) {
      await avisar('No se pudo guardar la marca. Intenta de nuevo.', 'error');
    }
    setGuardandoMarca(false);
  };

  const handleGuardarInfoLocal = async (e) => {    e.preventDefault();
    setGuardandoInfo(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), infoLocal);
      setNegocio({ ...negocio, ...infoLocal });
      await invalidarCache();
      await avisar('Datos actualizados.', 'exito');
    } catch (err) {
      await avisar('No se pudo actualizar. Intenta de nuevo.', 'error');
    }
    setGuardandoInfo(false);
  };

  const handleGuardarWhatsApp = async (e) => {
    e.preventDefault();
    const digitos = whatsApp.replace(/\D/g, '');
    const limpio = digitos.startsWith(codigoPais) ? digitos : codigoPais + digitos;
    if (limpio.length < 10) {
      await avisar('Revisa el número: escribe solo los dígitos locales (ej. 3001234567).', 'error');
      return;
    }
    setGuardandoWhatsApp(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), { whatsapp: limpio });
      setNegocio({ ...negocio, whatsapp: limpio });
      await invalidarCache();
      await avisar('WhatsApp actualizado.', 'exito');
    } catch (err) {
      await avisar('No se pudo actualizar el WhatsApp. Intenta de nuevo.', 'error');
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
      await avisar('No se pudo guardar el servicio. Intenta de nuevo.', 'error');
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
      await avisar('No se pudo añadir. Intenta de nuevo.', 'error');
    }
  };

  const handleEliminarServicio = async (servicio) => {
    const ok = await confirmar({
      titulo: `¿Eliminar "${servicio.name}"?`,
      detalle: 'Ya no aparecerá para reservar.',
      consecuencia: 'Si tiene citas futuras, primero reubícalas o cancélalas.',
      confirmarTexto: 'Sí, eliminar',
      variante: 'peligro',
    });
    if (!ok) return;
    setEliminando(servicio.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/servicios/${servicio.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        await avisar(data?.message || 'No se pudo eliminar el servicio.', 'error');
      }
    } catch (err) {
      await avisar('No se pudo eliminar el servicio.', 'error');
    }
    setEliminando('');
  };

  // Crear espacio/clase por el backend (POST /recursos): el servidor sanea
  // y acota todo; el frontend solo pide y muestra.
  const handleAddRecurso = async (e) => {
    e.preventDefault();
    const nombre = (nuevoRecurso.name || '').trim();
    if (!nombre) {
      await avisar('Ponle un nombre al espacio (ej. Clase Funcional).', 'error');
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/recursos`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nombre,
          tipo: nuevoRecurso.tipo,
          capacidad: Number(nuevoRecurso.capacidad) || 1,
          duration_minutes: Number(nuevoRecurso.duration_minutes) || 60,
          price: nuevoRecurso.price === '' ? 0 : Number(nuevoRecurso.price),
          descripcion: (nuevoRecurso.descripcion || '').trim().slice(0, 500),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        await avisar(data?.message || await res.text().catch(() => '') || 'No se pudo guardar el espacio.', 'error');
        return;
      }
      setNuevoRecurso({ name: '', tipo: 'cancha', capacidad: 1, descripcion: '', duration_minutes: 60, price: '' });
      invalidarCache();
      await avisar('Espacio creado. Ya aparece para reservar.', 'exito');
    } catch (err) {
      await avisar('No se pudo guardar el espacio. Intenta de nuevo.', 'error');
    }
  };

  const handleEliminarRecurso = async (recurso) => {
    const ok = await confirmar({
      titulo: `¿Borrar "${recurso.name}"?`,
      detalle: 'Ya no aparecerá para reservar.',
      consecuencia: 'Si tiene citas futuras, primero reubícalas o cancélalas.',
      confirmarTexto: 'Sí, borrar',
      variante: 'peligro',
    });
    if (!ok) return;
    setEliminando(recurso.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/recursos/${recurso.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        await avisar(data?.message || 'No se pudo borrar el espacio.', 'error');
      }
    } catch (err) {
      await avisar('No se pudo borrar el espacio.', 'error');
    }
    setEliminando('');
  };

  const handleEliminarProfesional = async (profesional) => {
    const ok = await confirmar({
      titulo: `¿Quitar a "${profesional.name}" del equipo?`,
      detalle: 'Ya no aparecerá para reservar.',
      consecuencia: 'Si tiene citas futuras, primero reubícalas o cancélalas.',
      confirmarTexto: 'Sí, quitar',
      variante: 'peligro',
    });
    if (!ok) return;
    setEliminando(profesional.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/empleados/${profesional.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        await avisar(data?.message || 'No se pudo quitar a esta persona.', 'error');
      }
    } catch (err) {
      await avisar('No se pudo quitar a esta persona.', 'error');
    }
    setEliminando('');
  };

  const handleCancelarReserva = async (citaId) => {
    const r = reservas.find((item) => item.id === citaId);
    if (!r) return;

    const ok = await confirmar({
      titulo: `¿Cancelar la cita de ${r.client_name}?`,
      detalle: r.service_name,
      consecuencia: 'El horario quedará libre para otros clientes.',
      confirmarTexto: 'Sí, cancelar',
      variante: 'peligro',
    });
    if (!ok) return;

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
        await avisar(data?.message || 'No se pudo cancelar la cita. Intenta de nuevo.', 'error');
      }
    } catch (err) {
      await avisar('No se pudo cancelar la cita. Intenta de nuevo.', 'error');
    } finally {
      setCancelando('');
    }
  };

  const [noShowMarking, setNoShowMarking] = useState('');
  const [undoingId, setUndoingId] = useState('');
  const [marcandoPago, setMarcandoPago] = useState('');

  // Caja en puerta: el dueño marca quién ya pagó (reversible por si se
  // toca sin querer). Escritura directa permitida por reglas (solo dueño).
  const handleTogglePagado = async (citaId) => {
    const r = reservas.find((item) => item.id === citaId);
    if (!r) return;
    const ok = await confirmar(r.pagado ? {
      titulo: `¿Quitar el pago de ${r.client_name}?`,
      detalle: 'Volverá a aparecer como sin pagar.',
      confirmarTexto: 'Sí, quitar pago',
      variante: 'info',
    } : {
      titulo: `¿Registrar pago de ${r.client_name}?`,
      detalle: r.price > 0 ? `Se registrará el cobro de ${formatDinero(r.price)}.` : 'Se marcará la reserva como pagada.',
      confirmarTexto: 'Sí, marcar pagado',
      variante: 'exito',
    });
    if (!ok) return;
    setMarcandoPago(citaId);
    try {
      await updateDoc(doc(db, 'reservas', citaId), { pagado: !r.pagado });
      setReservas(prev => prev.map(item => item.id === citaId ? { ...item, pagado: !r.pagado } : item));
    } catch (err) {
      await avisar('No se pudo guardar el pago. Intenta de nuevo.', 'error');
    }
    setMarcandoPago('');
  };

  const handleMarcarNoShow = async (citaId) => {
    const r = reservas.find((item) => item.id === citaId);
    const ok = await confirmar({
      titulo: `¿${r?.client_name || 'El cliente'} no vino?`,
      detalle: 'Se marcará como "No llegó" y se restará de sus visitas.',
      confirmarTexto: 'Marcar no llegó',
      variante: 'peligro',
    });
    if (!ok) return;
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
        const data = await res.json().catch(() => null);
        await avisar(data?.message || 'No se pudo marcar. Intenta de nuevo.', 'error');
      }
    } catch (err) {
      await avisar('No se pudo marcar. Intenta de nuevo.', 'error');
    }
    setNoShowMarking('');
  };

  const handleUndo = async (citaId) => {
    const ok = await confirmar({
      titulo: '¿Devolver esta cita a activa?',
      detalle: 'Volverá a aparecer en la agenda.',
      confirmarTexto: 'Devolver a activa',
      variante: 'info',
    });
    if (!ok) return;
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
        await avisar(data?.message || 'No se pudo devolver. Intenta de nuevo.', 'error');
      }
    } catch (err) {
      await avisar('No se pudo devolver. Intenta de nuevo.', 'error');
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

  // Agrupación de espacios (chunking): las reservas del mismo espacio y
  // hora se ven como UNA tarjeta de ocupación ("Fútbol · 10:00 · 12/30") con
  // lista plegable, en vez de inundar la agenda con 30 tarjetas.
  const iconoEspacio = (tipo) => (
    tipo === 'cancha' ? '⚽' : tipo === 'box' ? '🔧' : tipo === 'consultorio' ? '🩺'
    : tipo === 'sala' ? '🎶' : tipo === 'camilla' ? '💆' : tipo === 'clase' ? '🧘' : '📍'
  );

  const GrupoEspacioCard = ({ grupo }) => {
    const [abierto, setAbierto] = useState(true);
    const { recurso, horaStr, miembros } = grupo;
    const activas = miembros.filter(m => !m.cancelled && !m.no_show);
    const capacidad = recurso?.capacidad || Math.max(activas.length, 1);
    const pct = Math.min(100, Math.round((activas.length / capacidad) * 100));
    const lleno = activas.length >= capacidad;
    return (
      <div className="mb-4 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="w-full p-4 flex items-center gap-3 text-left active:bg-gray-50 transition-colors"
        >
          <span className="w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-lg shrink-0" aria-hidden="true">
            {iconoEspacio(recurso?.tipo)}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-gray-900 text-sm truncate">📍 {grupo.nombre} · {horaStr}</span>
            <span className="block mt-1.5 h-2 bg-gray-100 rounded-full overflow-hidden" aria-hidden="true">
              <span
                className={`block h-full rounded-full transition-all ${lleno ? 'bg-emerald-600' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-400'}`}
                style={{ width: `${pct}%` }}
              />
            </span>
            <span className="block text-[11px] font-bold text-gray-500 mt-1">
              {activas.length}/{capacidad} {lleno ? '· ¡Lleno!' : pct >= 70 ? '· ¡Casi lleno!' : ''}
            </span>
          </span>
          <span className={`text-xs font-black px-2.5 py-1 rounded-lg shrink-0 ${lleno ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
            {activas.length}/{capacidad}
          </span>
          <span className="text-gray-400 text-xs font-bold shrink-0" aria-hidden="true">{abierto ? '▲' : '▼'}</span>
        </button>
        {abierto && (
          <ul className="border-t border-gray-100 divide-y divide-gray-50">
            {miembros.map((m) => (
              <li key={m.id} className={`px-4 py-2.5 flex items-center gap-2 ${m.cancelled ? 'bg-red-50/60' : m.no_show ? 'bg-amber-50/60' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-800 truncate">
                    {m.client_name}
                    {m.cancelled && <span className="ml-2 text-[9px] font-black bg-red-200 text-red-800 px-1.5 py-0.5 rounded uppercase">Cancelada</span>}
                    {m.no_show && <span className="ml-2 text-[9px] font-black bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded uppercase">No llegó</span>}
                    {!m.cancelled && !m.no_show && m.pagado && <span className="ml-2 text-[9px] font-black bg-green-200 text-green-800 px-1.5 py-0.5 rounded uppercase">Pagó</span>}
                  </p>
                  <p className="text-[11px] text-gray-500 font-medium">📞 {formatearTelefono(m.user_phone)}</p>
                </div>
                {!m.cancelled && !m.no_show && (
                  <div className="flex gap-1 shrink-0">
                    <a
                      href={`https://wa.me/${m.user_phone}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp a ${m.client_name}`}
                      className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center text-green-700 bg-green-50 border border-green-200 rounded-lg text-xs font-bold active:scale-95"
                    >
                      📲
                    </a>
                    {m.pagado ? (
                      <button
                        onClick={() => handleTogglePagado(m.id)} disabled={marcandoPago === m.id} aria-label={`Quitar pago de ${m.client_name}`}
                        className="min-h-[40px] px-2.5 flex items-center text-[11px] font-black bg-green-100 text-green-800 rounded-lg border border-green-200 active:scale-95 disabled:opacity-50"
                      >
                        {marcandoPago === m.id ? '…' : '✅ Pagó'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleTogglePagado(m.id)} disabled={marcandoPago === m.id} aria-label={`Marcar pagado a ${m.client_name}`}
                        className="min-h-[40px] px-2.5 text-[11px] text-green-700 font-bold border border-green-200 bg-green-50 hover:bg-green-100 rounded-lg active:scale-95 disabled:opacity-50"
                      >
                        {marcandoPago === m.id ? '…' : '✅ Pagó'}
                      </button>
                    )}
                    <button
                      onClick={() => handleMarcarNoShow(m.id)} disabled={noShowMarking === m.id} aria-label={`Marcar no llegó a ${m.client_name}`}
                      className="min-h-[40px] px-2.5 text-[11px] text-gray-600 font-bold border border-transparent hover:border-amber-200 hover:bg-amber-50 rounded-lg active:scale-95 disabled:opacity-50"
                    >
                      {noShowMarking === m.id ? '…' : 'No llegó'}
                    </button>
                    <button
                      onClick={() => handleCancelarReserva(m.id)} disabled={cancelando === m.id} aria-label={`Cancelar cita de ${m.client_name}`}
                      className="min-h-[40px] px-2.5 text-[11px] text-red-600 font-bold bg-red-50 border border-red-100 rounded-lg active:scale-95 disabled:opacity-50"
                    >
                      {cancelando === m.id ? '…' : '✕'}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  // Divide la lista en citas de profesional (tarjeta individual) y grupos de
  // espacio (tarjeta de ocupación), ordenados por hora.
  const ListaAgenda = ({ items }) => {
    const pros = [];
    const gruposMap = new Map();
    for (const r of items) {
      if (!r.recurso_name) {
        pros.push(r);
        continue;
      }
      const timeMs = r.date_time?.seconds * 1000;
      const hora = timeMs ? horaEnZona(timeMs, zonaNegocio) : '--:--';
      const key = `${r.recurso_id || r.recurso_name}|${hora}`;
      if (!gruposMap.has(key)) {
        const recurso = recursos.find((x) => (r.recurso_id && x.id === r.recurso_id) || x.name === r.recurso_name);
        gruposMap.set(key, { key, nombre: r.recurso_name, recurso, horaStr: hora, miembros: [], minMs: timeMs || 0 });
      }
      gruposMap.get(key).miembros.push(r);
      if (timeMs && timeMs < gruposMap.get(key).minMs) gruposMap.get(key).minMs = timeMs;
    }
    pros.sort((a, b) => (a.date_time?.seconds || 0) - (b.date_time?.seconds || 0));
    const grupos = [...gruposMap.values()].sort((a, b) => a.minMs - b.minMs);
    // Intercala por hora: profesionales y grupos en una sola línea de tiempo.
    const bloques = [
      ...pros.map((r) => ({ ms: r.date_time?.seconds * 1000 || 0, nodo: <RenderCitaCard key={r.id} r={r} /> })),
      ...grupos.map((g) => ({ ms: g.minMs, nodo: <GrupoEspacioCard key={g.key} grupo={g} /> })),
    ].sort((a, b) => a.ms - b.ms);
    return <>{bloques.map((b, i) => <span key={i} className="block">{b.nodo}</span>)}</>;
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
                {isNoShow && <span className="text-[10px] font-bold bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded uppercase tracking-wider">No llegó</span>}
                {isCancelled && <span className="text-[10px] font-bold bg-red-200 text-red-800 px-1.5 py-0.5 rounded uppercase tracking-wider">Cancelada</span>}
              </div>
              <div className="space-y-1 mt-2">
                <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <span className="text-gray-400">📋</span> {r.service_name}
                </p>
                {r.recurso_name && (
                  <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                    <span className="text-gray-400">📍</span> {r.recurso_name}{r.cupos > 1 ? ` (${r.cupos} personas)` : ''}
                  </p>
                )}
                {(r.participantes || []).length > 0 && (
                  <p className="text-xs text-gray-500">🧑‍🤝‍🧑 Van: {r.participantes.join(', ')}</p>
                )}
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
              {r.pagado ? (
                <button onClick={() => handleTogglePagado(r.id)} disabled={marcandoPago === r.id} title="Pagado (toca para quitar)" aria-label={`Quitar pago de ${r.client_name}`} className="text-xs font-black text-green-800 bg-green-100 px-2 py-1 rounded-lg flex items-center gap-1 border border-green-200 active:scale-95 disabled:opacity-50">
                  ✅ Pagado
                </button>
              ) : r.price > 0 ? (
                <span className="text-xs font-black text-gray-900 bg-gray-100 px-2 py-1 rounded-lg">
                  {formatDinero(r.price)}
                </span>
              ) : null}
              {!isPast && !isNoShow && !isCancelled && (
                <a
                  href={`https://wa.me/${r.user_phone}`} target="_blank" rel="noreferrer"
                  className="mt-1 min-h-[44px] inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 hover:bg-green-100 px-3 py-2 rounded-md font-bold transition-colors border border-green-200"
                >
                  WhatsApp
                </a>
              )}
            </div>
          </div>

          {/* Acciones */}
          {!isNoShow && !isCancelled && (
            <div className="flex justify-end pt-3 mt-3 border-t border-gray-100/80 gap-2">
              {!r.pagado && (
                <button
                  onClick={() => handleTogglePagado(r.id)}
                  disabled={marcandoPago === r.id}
                  className="min-h-[44px] text-[11px] text-green-700 font-semibold active:scale-95 transition-all px-3 py-1.5 rounded-lg border border-green-200 bg-green-50 hover:bg-green-100 disabled:opacity-50"
                >
                  {marcandoPago === r.id ? '...' : '✅ Pagó'}
                </button>
              )}
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
    <div className={`${negocio?.marca?.color ? 'tema-marca ' : ''}max-w-2xl mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased flex flex-col`} style={negocio?.marca?.color ? { '--marca': negocio.marca.color, '--sobre-marca': textoSobreMarca(negocio.marca.color) } : undefined}>
      <header className="px-4 py-2.5 bg-white border-b border-gray-200 sticky top-0 z-40 flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
          style={negocio?.marca?.color
            ? { backgroundColor: negocio.marca.color, color: textoSobreMarca(negocio.marca.color) }
            : { backgroundColor: '#111', color: '#fff' }}
        >
          {inicialMarca(negocio.name)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-gray-900 leading-tight truncate">{negocio.name}</h1>
        </div>
        <NotificationDrawer storageKey={`admin_${negocio.id}`} onNotificationClick={() => setView('agenda')} />
        <button onClick={logout} className="text-[11px] text-gray-400 font-semibold hover:text-gray-600 transition-colors">
          Salir
        </button>
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

            {/* Registrar cita manual (dueño anota un cliente sin cita previa) */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <button
                type="button"
                onClick={() => setShowRegistro((v) => !v)}
                aria-expanded={showRegistro}
                className="w-full flex items-center justify-between min-h-[44px]"
              >
                <span className="text-base font-bold text-gray-900">＋ Nueva cita</span>
                <span className="text-xs font-bold text-gray-400">{showRegistro ? '▲' : '▼'}</span>
              </button>
              <p className="text-xs font-medium text-gray-500 mt-1">Anota un cliente de WhatsApp o mostrador con las mismas reglas.</p>
              {showRegistro && (
                <div className="mt-4 pt-4 border-t border-gray-100">
                  <RegistroManual
                    slug={negocio.id}
                    API_URL={import.meta.env.VITE_API_URL || ''}
                    negocio={{ ...negocio, servicios, empleados: profesionales, recursos }}
                    getHeaders={async () => ({ Authorization: `Bearer ${await user.getIdToken()}` })}
                  />
                </div>
              )}
            </div>

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
                    className={`min-h-[44px] px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
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
                        <ListaAgenda items={filtradas} />
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
                        <ListaAgenda items={filtradas} />
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
                        {(() => {
                          // Agrupa por día para la etiqueta de fecha, y dentro
                          // de cada día aplica la misma lista (profesionales +
                          // ocupación de espacios).
                          const porDia = new Map();
                          for (const r of filtradas) {
                            const timeMs = r.date_time?.seconds * 1000;
                            const fechaStr = timeMs ? diaKeyEnZona(timeMs, zonaNegocio) : '';
                            if (!porDia.has(fechaStr)) porDia.set(fechaStr, []);
                            porDia.get(fechaStr).push(r);
                          }
                          return [...porDia.entries()].map(([fechaStr, items]) => (
                            <div key={fechaStr}>
                              <div className="text-[10px] font-bold text-gray-400 ml-16 mb-2 uppercase tracking-wider">
                                {formatearFechaLarga(fechaStr)}
                              </div>
                              <ListaAgenda items={items} />
                            </div>
                          ));
                        })()}
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
                <>
                <button
                  onClick={async () => {
                    setPushTestMsg('');
                    const ok = await pushNotifications.subscribe();
                    if (!ok) setPushTestMsg('⚠️ No se pudieron activar. Revisa el permiso del navegador e intenta de nuevo.');
                  }}
                  className="w-full min-h-[48px] py-3.5 bg-blue-600 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform shadow-sm"
                >
                  🔔 Activar avisos en este dispositivo
                </button>
                {pushTestMsg && (
                  <p role="alert" className="text-xs font-bold text-center p-3 rounded-xl bg-red-50 border border-red-200 text-red-700">{pushTestMsg}</p>
                )}
                </>
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
                  <div>
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Aviso mínimo</span>
                    <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label="Atajos de aviso mínimo">
                      {[
                        { etiqueta: 'Ya', min: 0 },
                        { etiqueta: '30 min', min: 30 },
                        { etiqueta: '2 h', min: 120 },
                        { etiqueta: '12 h', min: 720 },
                        { etiqueta: '24 h', min: 1440 },
                      ].map((p) => (
                        <button
                          key={p.etiqueta}
                          type="button"
                          onClick={() => setPoliticas({ ...politicas, min_notice_minutes: p.min })}
                          aria-pressed={Number(politicas.min_notice_minutes) === p.min}
                          className={`min-h-[36px] px-2.5 rounded-lg text-[11px] font-bold transition-all ${
                            Number(politicas.min_notice_minutes) === p.min
                              ? 'bg-black text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {p.etiqueta}
                        </button>
                      ))}
                    </div>
                    <label className="block">
                      <span className="sr-only">Aviso mínimo en minutos</span>
                      <input
                        type="number" min={0} max={10080} inputMode="numeric"
                        value={politicas.min_notice_minutes}
                        onChange={(e) => setPoliticas({ ...politicas, min_notice_minutes: e.target.value })}
                        aria-label="Antelación mínima en minutos"
                        className="w-full p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                      />
                    </label>
                    <span className="block text-[11px] text-gray-400 font-medium mt-1">Cuánto antes debe reservar el cliente.</span>
                  </div>
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
                {/* Jornada base + zona horaria: cuando la persona o el espacio
                    NO tienen horario propio, la agenda usa estos horarios. */}
                <div className="p-4 bg-gray-50 border border-gray-200 rounded-2xl space-y-3">
                  <div>
                    <p className="text-xs font-bold text-gray-700">🕒 Jornada base del negocio</p>
                    <p className="text-[11px] text-gray-500 font-medium">Para quien no tenga horario propio (equipo o espacios). No cambia horarios ya definidos.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex-1 min-w-0">
                      <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Abre</span>
                      <input
                        type="time"
                        value={politicas.open_time}
                        onChange={(e) => setPoliticas({ ...politicas, open_time: e.target.value })}
                        aria-label="Hora de apertura"
                        className="w-full min-h-[48px] p-2.5 border border-gray-200 rounded-xl bg-white text-sm text-center focus:border-black focus:outline-none"
                      />
                    </label>
                    <span className="text-gray-400 font-bold mt-5" aria-hidden="true">–</span>
                    <label className="flex-1 min-w-0">
                      <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Cierra</span>
                      <input
                        type="time"
                        value={politicas.close_time}
                        onChange={(e) => setPoliticas({ ...politicas, close_time: e.target.value })}
                        aria-label="Hora de cierre"
                        className="w-full min-h-[48px] p-2.5 border border-gray-200 rounded-xl bg-white text-sm text-center focus:border-black focus:outline-none"
                      />
                    </label>
                  </div>
                  <p className="text-[11px] text-gray-500 font-medium">
                    🌍 Hora del negocio: <strong>{negocio?.timezone || 'America/Bogota'}</strong> (las citas siempre se muestran en esta hora).
                  </p>
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
                        <div className="flex gap-1 shrink-0">
                          <button
                            onClick={async () => {
                              const url = `${window.location.origin}/shop/${negocio.id}?s=${s.id}`;
                              try {
                                await navigator.clipboard.writeText(url);
                                await avisar('Enlace directo copiado. Pégalo en Instagram o WhatsApp.', 'exito');
                              } catch {
                                await avisar(`Copia este enlace:\n\n${url}`, 'info');
                              }
                            }}
                            aria-label={`Copiar enlace directo de ${s.name}`}
                            className="min-h-[44px] px-3 bg-blue-50 border border-blue-200 text-blue-700 font-bold rounded-xl text-xs active:scale-95 transition-transform"
                          >
                            🔗 Link
                          </button>
                          <button onClick={() => handleEliminarServicio(s)} disabled={eliminando === s.id} aria-label={`Eliminar servicio ${s.name}`} className="shrink-0 min-h-[44px] px-3 text-red-600 font-bold text-xs active:scale-95 transition-transform bg-red-50 rounded-xl border border-red-100">
                            {eliminando === s.id ? 'Eliminando…' : 'Eliminar'}
                          </button>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-1 items-center">
                              <span className="text-[11px] font-bold text-gray-400 uppercase">Lo hacen:</span>
                        {encargados.length === 0 ? (
                          <span className="text-[11px] text-red-600 font-semibold">Nadie aún — asígnalo en “Qué servicios hace” del equipo</span>
                        ) : (
                          encargados.map((p) => (
                            <span key={p.id} className="text-[11px] font-bold bg-gray-100 text-gray-700 px-2 py-0.5 rounded-md">
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
                        <button
                          onClick={async () => {
                            try {
                              const t = await user.getIdToken();
                              window.open(`${import.meta.env.VITE_API_URL || ''}/auth/google/login?negocio_id=${negocio.id}&emp_id=${p.id}&otok=${t}&ret=admin`, '_blank', 'noopener');
                            } catch {
                              await avisar('No pudimos abrir la conexión. Intenta de nuevo.', 'error');
                            }
                          }}
                          className="flex-1 text-center py-2.5 bg-blue-600 text-white font-bold rounded-lg text-[11px] active:scale-95 shadow-sm min-h-[44px] flex items-center justify-center"
                        >
                          🔗 Conectar Google Calendar
                        </button>
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
              {profesionales.length > 0 && profesionales.some((p) => !p.calendar_id) && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 text-blue-800 font-medium text-xs rounded-xl leading-relaxed" role="alert">
                  📅 {profesionales.filter((p) => !p.calendar_id).map((p) => p.name).join(', ')} sin Google Calendar: reciben reservas igual, pero sin anti-choque con su agenda personal. Pueden conectarlo ellos mismos desde su portal.
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

            {/* ESPACIOS RESERVABLES (canchas, boxes...) */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Canchas, clases y espacios</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">Opcional. Define precio, duración y cupos: una clase grupal o una cancha se reservan directo, sin elegir profesional.</p>
              <ul className="space-y-3 mb-4">
                {recursos.length === 0 && (
                  <div className="p-5 text-center bg-gray-50 border border-dashed border-gray-200 rounded-2xl">
                    <p className="text-sm font-bold text-gray-700">Sin espacios</p>
                    <p className="text-[11px] text-gray-500 font-medium mt-1">Si solo atienden personas, no necesitas nada aquí.</p>
                  </div>
                )}
                {recursos.map((r) => (
                  <li key={r.id} className="p-3.5 bg-white border border-gray-200 shadow-2xs rounded-xl text-sm space-y-2">
                    <div className="flex justify-between items-center gap-2">
                      <div className="min-w-0">
                        <p className="font-bold text-gray-900 truncate">📍 {r.name}</p>
                        <p className="text-xs font-medium text-gray-500 capitalize">
                          {r.tipo || 'espacio'} · {(r.capacidad || 1) > 1 ? `${r.capacidad} cupos` : 'uso exclusivo'}{r.horario ? ' · horario propio' : ''}
                        </p>
                        <p className="text-xs font-semibold text-gray-700 mt-0.5">
                          ⏱️ {r.duration_minutes || 60} min · {formatDinero(r.price)}
                        </p>
                        {r.descripcion && (
                          <p className="text-xs font-medium text-gray-600 mt-0.5">{r.descripcion}</p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={async () => {
                            const url = `${window.location.origin}/shop/${negocio.id}?r=${r.id}`;
                            try {
                              await navigator.clipboard.writeText(url);
                              await avisar('Enlace directo copiado. Pégalo en Instagram o WhatsApp.', 'exito');
                            } catch {
                              await avisar(`Copia este enlace:\n\n${url}`, 'info');
                            }
                          }}
                          aria-label={`Copiar enlace directo de ${r.name}`}
                          className="min-h-[44px] px-3 bg-blue-50 border border-blue-200 text-blue-700 font-bold rounded-xl text-xs active:scale-95 transition-transform"
                        >
                          🔗 Link
                        </button>
                        <button onClick={() => setHorarioRecursoModal(r)} title={`Horario de ${r.name}`} aria-label={`Definir horario de ${r.name}`} className="min-h-[44px] px-3 bg-gray-50 border border-gray-200 text-gray-800 font-bold rounded-xl text-xs active:scale-95">🕒</button>
                        <button onClick={() => handleEliminarRecurso(r)} disabled={eliminando === r.id} aria-label={`Borrar espacio ${r.name}`} className="min-h-[44px] px-3 text-red-600 font-bold text-xs active:scale-95 transition-transform bg-red-50 rounded-xl border border-red-100">
                          {eliminando === r.id ? 'Borrando…' : 'Borrar'}
                        </button>
                      </div>
                    </div>
                    {(r.capacidad || 1) > 1 || editandoRecurso === r.id ? (
                      <div className="pt-2 border-t border-gray-100 flex items-end gap-2">
                        <label className="flex-1 min-w-0">
                          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Cupos</span>
                          <input
                            type="number" min={1} max={100} inputMode="numeric"
                            value={editandoRecurso === r.id ? editRecursoVals.capacidad : (r.capacidad || 1)}
                            onChange={(e) => { setEditandoRecurso(r.id); setEditRecursoVals({ capacidad: e.target.value }); }}
                            aria-label={`Cupos de ${r.name}`}
                            className="w-full p-2.5 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none"
                          />
                        </label>
                        {editandoRecurso === r.id && (
                          <>
                            <button onClick={() => guardarRecurso(r)} disabled={guardandoRecurso} className="min-h-[44px] px-3 bg-black text-white font-bold rounded-xl text-xs active:scale-95 disabled:opacity-50">
                              {guardandoRecurso ? '…' : 'Guardar'}
                            </button>
                            <button onClick={() => setEditandoRecurso(null)} className="min-h-[44px] px-3 bg-gray-100 text-gray-600 font-bold rounded-xl text-xs active:scale-95">
                              X
                            </button>
                          </>
                        )}
                      </div>
                    ) : (
                      <button onClick={() => { setEditandoRecurso(r.id); setEditRecursoVals({ capacidad: r.capacidad || 1 }); }} className="text-[11px] font-bold text-gray-500 underline">
                        Pasar a grupal (cupos)
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <form onSubmit={handleAddRecurso} className="space-y-3 pt-3 border-t border-gray-100">
                <h3 className="text-sm font-bold text-gray-800">Agregar clase o espacio</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nombre</span>
                    <input
                      type="text" required placeholder="Ej. Yoga, Cancha 1…" value={nuevoRecurso.name}
                      onChange={(e) => setNuevoRecurso({ ...nuevoRecurso, name: e.target.value })}
                      aria-label="Nombre del espacio nuevo"
                      className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Tipo</span>
                    <select
                      value={nuevoRecurso.tipo}
                      onChange={(e) => setNuevoRecurso({ ...nuevoRecurso, tipo: e.target.value })}
                      aria-label="Tipo de espacio"
                      className="w-full min-h-[48px] p-3 border border-gray-200 rounded-xl text-sm bg-white focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    >
                      <option value="clase">🧘 Clase grupal</option>
                      <option value="cancha">⚽ Cancha</option>
                      <option value="box">🔧 Box / elevador</option>
                      <option value="consultorio">🩺 Consultorio</option>
                      <option value="sala">🎶 Sala</option>
                      <option value="camilla">💆 Camilla</option>
                      <option value="otro">📍 Otro</option>
                    </select>
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Cupos (1 = exclusivo)</span>
                    <input
                      type="number" min={1} max={100} inputMode="numeric"
                      value={nuevoRecurso.capacidad}
                      onChange={(e) => setNuevoRecurso({ ...nuevoRecurso, capacidad: e.target.value })}
                      aria-label="Cupos por horario del espacio nuevo"
                      className="w-full min-h-[48px] p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Duración (min)</span>
                    <input
                      type="number" required min={15} max={480} placeholder="60" inputMode="numeric"
                      value={nuevoRecurso.duration_minutes}
                      onChange={(e) => setNuevoRecurso({ ...nuevoRecurso, duration_minutes: e.target.value })}
                      aria-label="Duración en minutos del espacio nuevo"
                      className="w-full min-h-[48px] p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Precio ($)</span>
                    <input
                      type="number" required min={0} placeholder="25000" inputMode="numeric"
                      value={nuevoRecurso.price}
                      onChange={(e) => setNuevoRecurso({ ...nuevoRecurso, price: e.target.value })}
                      aria-label="Precio del espacio nuevo"
                      className="w-full min-h-[48px] p-3 border border-gray-200 rounded-xl text-sm text-center focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Info del espacio (opcional, máx 500)</span>
                  <textarea
                    rows={2} maxLength={500} placeholder="Ej. Cancha sintética techada, trae zapatos de goma…"
                    value={nuevoRecurso.descripcion}
                    onChange={(e) => setNuevoRecurso({ ...nuevoRecurso, descripcion: e.target.value })}
                    aria-label="Información del espacio nuevo"
                    className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black resize-none"
                  />
                </label>
                <button type="submit" className="w-full min-h-[48px] py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform">+ Añadir espacio o clase</button>
              </form>
            </div>

            {/* MARCA Y PROPÓSITO */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Marca y propósito ✨</h2>
              <p className="text-xs font-medium text-gray-500 mb-4">Tu color, tu mensaje y tus redes. Gratis, sin subir fotos: el logo es tu inicial y la portada un degradado. Así te ven al reservar y en los paneles.</p>
              <form onSubmit={handleGuardarMarca} className="space-y-4">
                <div>
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Color de tu marca</span>
                  <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Color de la marca">
                    {COLORES_MARCA.map((c) => {
                      const activo = (marca.color || '') === c.color;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={activo}
                          title={c.nombre}
                          onClick={() => setMarca({ ...marca, color: c.color })}
                          className={`w-11 h-11 rounded-full border-2 flex items-center justify-center font-black text-sm active:scale-95 transition-all ${
                            activo ? 'border-black ring-2 ring-black ring-offset-2' : 'border-gray-200'
                          }`}
                          style={c.color ? { backgroundColor: c.color, color: textoSobreMarca(c.color) } : { backgroundColor: '#fff', color: '#111' }}
                        >
                          {activo ? '✓' : inicialMarca(infoLocal.name || negocio?.name)}
                        </button>
                      );
                    })}
                    <label
                      title="Color propio"
                      className={`relative w-11 h-11 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center overflow-hidden cursor-pointer active:scale-95 transition-all ${
                        marca.color && !COLORES_MARCA.some((c) => c.color === marca.color) ? 'ring-2 ring-black ring-offset-2' : ''
                      }`}
                      style={marca.color ? { backgroundColor: marca.color } : undefined}
                    >
                      <span className="sr-only">Elegir color propio</span>
                      <span aria-hidden="true" className="text-lg font-black" style={{ color: marca.color ? textoSobreMarca(marca.color) : '#9ca3af' }}>+</span>
                      <input
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(marca.color || '') ? marca.color : '#16a34a'}
                        onChange={(e) => setMarca({ ...marca, color: e.target.value })}
                        className="absolute opacity-0 w-11 h-11 cursor-pointer"
                        aria-label="Elegir color propio"
                      />
                    </label>
                  </div>
                </div>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Eslogan (máx 80)</span>
                  <input
                    type="text" maxLength={80} placeholder="Ej. Tu estilo, nuestra pasión"
                    value={marca.eslogan}
                    onChange={(e) => setMarca({ ...marca, eslogan: e.target.value })}
                    aria-label="Eslogan del negocio"
                    className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                  />
                </label>
                <label className="block">
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Tu propósito (máx 500)</span>
                  <textarea
                    rows={3} maxLength={500} placeholder="Ej. Hace 10 años embellecemos el barrio con precios justos…"
                    value={marca.descripcion}
                    onChange={(e) => setMarca({ ...marca, descripcion: e.target.value })}
                    aria-label="Descripción o propósito del negocio"
                    className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black resize-none"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { key: 'instagram', etiqueta: 'Instagram (@usuario)' },
                    { key: 'facebook', etiqueta: 'Facebook' },
                    { key: 'tiktok', etiqueta: 'TikTok (@usuario)' },
                  ].map((r) => (
                    <label key={r.key} className="block">
                      <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">{r.etiqueta}</span>
                      <input
                        type="text" maxLength={120} placeholder="@tu_cuenta"
                        value={marca[r.key]}
                        onChange={(e) => setMarca({ ...marca, [r.key]: e.target.value })}
                        aria-label={r.etiqueta}
                        className="w-full p-3 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                      />
                    </label>
                  ))}
                </div>
                {/* Vista previa en vivo: mini página de reserva */}
                <div>
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2">Así te verán</span>
                  <div className="rounded-2xl overflow-hidden border border-gray-200" aria-hidden="true">
                    <div className="px-4 py-4 text-center" style={marca.color ? { background: fondoMarca(marca.color), color: textoSobreMarca(marca.color) } : { backgroundColor: '#fff', color: '#111' }}>
                      <div
                        className="w-11 h-11 rounded-full mx-auto flex items-center justify-center text-xl font-black border"
                        style={marca.color
                          ? { backgroundColor: 'rgba(255,255,255,0.25)', borderColor: 'rgba(255,255,255,0.5)' }
                          : { backgroundColor: '#111', color: '#fff', borderColor: '#111' }}
                      >
                        {inicialMarca(infoLocal.name || negocio?.name)}
                      </div>
                      <p className="font-bold text-sm mt-2">{infoLocal.name || negocio?.name || 'Tu negocio'}</p>
                      {marca.eslogan ? <p className="text-[11px] opacity-90 font-medium">{marca.eslogan}</p> : null}
                    </div>
                    <div className="p-3 bg-gray-50">
                      <div
                        className="w-full py-3 rounded-xl text-center text-xs font-bold"
                        style={marca.color ? { backgroundColor: marca.color, color: textoSobreMarca(marca.color) } : { backgroundColor: '#111', color: '#fff' }}
                      >
                        Confirmar Reserva
                      </div>
                    </div>
                  </div>
                </div>
                <button type="submit" disabled={guardandoMarca} className="w-full min-h-[48px] py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform disabled:opacity-50">
                  {guardandoMarca ? 'Guardando…' : 'Guardar marca'}
                </button>
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
                  <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Horario de atención (texto para clientes)</span>
                <input
                  type="text" placeholder="Ej. Lun a Sáb, 9am a 7pm" value={infoLocal.horario}
                  onChange={(e) => setInfoLocal({ ...infoLocal, horario: e.target.value })}
                  aria-label="Horario de atención"
                  aria-describedby="ayuda-horario-texto"
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                />
                <span id="ayuda-horario-texto" className="block text-[11px] text-gray-400 font-medium mt-1">Solo se muestra; la agenda real sale de la jornada y los horarios del equipo.</span>
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
      {horarioRecursoModal && <HorarioRecursoModal negocioId={negocio.id} recurso={horarioRecursoModal} onClose={() => { setHorarioRecursoModal(null); invalidarCache(); }} />}
      {serviciosModal && <ServiciosEmpleadoModal negocioId={negocio.id} empleado={serviciosModal} servicios={servicios} onClose={() => { setServiciosModal(null); invalidarCache(); }} />}
      {pinModal && <PinEmpleadoModal negocioId={negocio.id} empleado={pinModal} onClose={() => setPinModal(null)} />}
    </div>
  );
}

export default function AdminDashboard() {
  return (
    <DialogoProvider>
      <AdminPanel />
    </DialogoProvider>
  );
}
