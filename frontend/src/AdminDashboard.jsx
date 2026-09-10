import { useState, useEffect } from 'react';
import { auth, provider, db } from './firebase';
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
import { requestPushPermission, listenForMessages } from './pushNotifications';

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
    setHorario({
      ...horario,
      [dia]: { ...horario[dia], turnos: [...actuales, { inicio: '14:00', fin: '18:00' }] },
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

  // MEJORA 5: Prevención de errores humanos (Inicio >= Fin)
  const errorValidacion = (() => {
    for (const dia of DIAS_SEMANA) {
      const data = horario[dia];
      if (data?.activo && data?.turnos) {
        for (const t of data.turnos) {
          if (t.inicio && t.fin && t.inicio >= t.fin) {
            return `Revisa el ${dia}: La hora de fin debe ser posterior a la de inicio.`;
          }
        }
      }
    }
    return null;
  })();

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-xl">
        <h3 className="text-lg font-bold mb-1 text-gray-900">Horario Laboral</h3>
        <p className="text-sm text-gray-500 mb-4">{empleado.name}</p>
        
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

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [negocio, setNegocio] = useState(null);
  const [view, setView] = useState('agenda');
  
  const [servicios, setServicios] = useState([]);
  const [profesionales, setProfesionales] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);

  const [infoLocal, setInfoLocal] = useState({ name: '', direccion: '', horario: '', telefono: '' });
  const [guardandoInfo, setGuardandoInfo] = useState(false);

  const [cancelando, setCancelando] = useState('');
  const [nuevoServicio, setNuevoServicio] = useState({ name: '', duration_minutes: 30, price: '' });
  const [nuevoProfesional, setNuevoProfesional] = useState({ name: '' });
  const [eliminando, setEliminando] = useState('');
  const [horarioModal, setHorarioModal] = useState(null);
  const [whatsApp, setWhatsApp] = useState('');
  const [codigoPais, setCodigoPais] = useState('57');
  const [guardandoWhatsApp, setGuardandoWhatsApp] = useState(false);
  const [enlaceCopiado, setEnlaceCopiado] = useState(false);

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

          const qReservas = query(collection(db, 'reservas'), where('owner_uid', '==', currentUser.uid));
          onSnapshot(qReservas, (snapshot) => {
            const inicioHoy = new Date();
            inicioHoy.setHours(0, 0, 0, 0);

            const citas = snapshot.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .filter((c) => (c.date_time?.seconds * 1000 || 0) >= inicioHoy.getTime())
              .sort((a, b) => (a.date_time?.seconds || 0) - (b.date_time?.seconds || 0));
            setReservas(citas);
          }, (error) => console.error("Error consultando reservas:", error));

          const qClientes = query(collection(db, 'clientes'), where('owner_uid', '==', currentUser.uid));
          onSnapshot(qClientes, (snapshot) => {
            setClientes(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
          }, (error) => console.error("Error consultando clientes:", error));

          // Registrar push token automáticamente al iniciar sesión
          try {
            await requestPushPermission(docSnap.id);
            listenForMessages((payload) => {
              alert(`🔔 ${payload.notification?.title}\n${payload.notification?.body}`);
            });
          } catch (err) {
            console.warn('Push registration failed:', err);
          }
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const logout = () => signOut(auth);

  const copiarEnlace = async () => {
    const url = `${window.location.origin}/shop/${negocio.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setEnlaceCopiado(true);
      setTimeout(() => setEnlaceCopiado(false), 2000);
    } catch {
      prompt('Copia tu enlace de reservas:', url);
    }
  };

  const handleGuardarInfoLocal = async (e) => {
    e.preventDefault();
    setGuardandoInfo(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), infoLocal);
      setNegocio(prev => ({ ...prev, ...infoLocal }));
      alert('Información del local actualizada');
    } catch (err) {
      alert('Error al actualizar la información');
    }
    setGuardandoInfo(false);
  };

  const handleGuardarWhatsApp = async (e) => {
    e.preventDefault();
    if (!negocio) return;
    const digitos = whatsApp.replace(/\D/g, '');
    const limpio = digitos.startsWith(codigoPais) ? digitos : codigoPais + digitos;
    if (limpio.length < 10) return alert('Ingresa el número local (ej. 3001234567)');
    setGuardandoWhatsApp(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), { whatsapp: limpio });
      setNegocio({ ...negocio, whatsapp: limpio });
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
    } catch (err) {
      alert('Error al guardar el servicio');
    }
  };

  const handleAddProfesional = async (e) => {
    e.preventDefault();
    try {
      await addDoc(collection(db, `negocios/${negocio.id}/empleados`), { name: nuevoProfesional.name, calendar_id: '' });
      setNuevoProfesional({ name: '' });
    } catch (err) {
      alert('Error al guardar el profesional');
    }
  };

  const handleEliminarServicio = async (servicio) => {
    if (!confirm(`¿Eliminar "${servicio.name}"? También se cancelarán sus citas futuras.`)) return;
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
    if (!confirm(`¿Eliminar a "${profesional.name}"? También se cancelarán sus citas futuras.`)) return;
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
    if (!confirm('¿Seguro que deseas cancelar esta cita? Se eliminará del calendario del profesional.')) return;
    setCancelando(citaId);
    try {
      const token = await user.getIdToken();
      await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/citas/${citaId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
      });
    } catch (err) {
      alert('No se pudo cancelar la cita. Intenta nuevamente.');
    } finally {
      setCancelando('');
    }
  };

  const [noShowMarking, setNoShowMarking] = useState('');

  const handleMarcarNoShow = async (citaId) => {
    if (!confirm('¿Marcar esta cita como no-show? El cliente será notificado.')) return;
    setNoShowMarking(citaId);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/no-show/${citaId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        alert('⚠️ Cita marcada como no-show');
      } else {
        alert('No se pudo marcar como no-show. Intenta nuevamente.');
      }
    } catch (err) {
      alert('No se pudo marcar como no-show. Intenta nuevamente.');
    }
    setNoShowMarking('');
  };

  const formatDinero = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

  const fechaUltimaVisita = (c) => {
    if (c.last_date_str) {
      const [year, month, day] = c.last_date_str.split('-').map(Number);
      if (year && month && day) return new Date(year, month - 1, day).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    return 'N/A';
  };

  const clientesCRM = [...clientes].sort((a, b) => (b.visits || 0) - (a.visits || 0));

  const fechaHoy = new Date();
  fechaHoy.setHours(0, 0, 0, 0);
  const fechaManana = new Date(fechaHoy);
  fechaManana.setDate(fechaManana.getDate() + 1);
  const fechaPasado = new Date(fechaHoy);
  fechaPasado.setDate(fechaPasado.getDate() + 2);

  const citasHoy = reservas.filter(r => {
    const t = r.date_time?.seconds * 1000;
    return t >= fechaHoy.getTime() && t < fechaManana.getTime();
  });
  const citasManana = reservas.filter(r => {
    const t = r.date_time?.seconds * 1000;
    return t >= fechaManana.getTime() && t < fechaPasado.getTime();
  });
  const citasProximas = reservas.filter(r => {
    const t = r.date_time?.seconds * 1000;
    return t >= fechaPasado.getTime();
  });

  // MEJORA 3: Función agrupadora para transformar la lista plana en bloques visuales de hora
  const agruparPorHora = (citasArray) => {
    const agrupadas = {};
    citasArray.forEach(r => {
      const timeMs = r.date_time?.seconds * 1000;
      const fechaObj = r.date_time ? new Date(timeMs) : null;
      const horaStr = fechaObj ? fechaObj.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
      
      if (!agrupadas[horaStr]) agrupadas[horaStr] = [];
      agrupadas[horaStr].push(r);
    });

    const horasOrdenadas = Object.keys(agrupadas).sort();
    return horasOrdenadas.map(hora => ({ hora, citas: agrupadas[hora] }));
  };

  const RenderCitaCard = ({ r }) => {
    const timeMs = r.date_time?.seconds * 1000;
    const isPast = timeMs < ahora;
    const isNoShow = r.no_show === true;
    const profesional = profesionales.find((p) => p.id === r.emp_id);

    return (
      <div className={`p-4 rounded-2xl border transition-all ${
        isNoShow ? 'bg-amber-50 border-amber-200' :
        isPast ? 'bg-gray-50 border-gray-100 opacity-60' :
        'bg-white border-gray-200 shadow-2xs'
      }`}>
        <div className="flex justify-between items-start gap-3">
          <div className={isPast && !isNoShow ? 'grayscale' : ''}>
            <p className="font-bold text-gray-900 text-sm">{r.client_name}</p>
            <p className="text-xs text-gray-500 font-medium mt-1">✨ {r.service_name}</p>
            <p className="text-xs text-gray-500 font-medium">👤 {profesional?.name || 'Profesional'}</p>
          </div>
          
          {isNoShow ? (
            <span className="text-[10px] font-bold bg-amber-200 text-amber-800 px-2.5 py-1.5 rounded-lg flex items-center shrink-0">
              ⚠️ No Show
            </span>
          ) : isPast ? (
            <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-2.5 py-1.5 rounded-lg flex items-center shrink-0">
              ✅ Finalizada
            </span>
          ) : (
            <a
              href={`https://wa.me/${r.user_phone}`} target="_blank" rel="noreferrer"
              className="text-[11px] text-green-800 bg-green-100 px-3.5 py-2 rounded-full font-bold active:scale-95 transition-transform flex items-center gap-1 shrink-0"
            >
              💬 WhatsApp
            </a>
          )}
        </div>
        {!isPast && !isNoShow && (
          <div className="flex justify-end pt-3 mt-3 border-t border-gray-100 gap-2">
            <button
              onClick={() => handleMarcarNoShow(r.id)}
              disabled={noShowMarking === r.id}
              className="text-xs text-amber-600 font-bold active:scale-95 transition-transform bg-amber-50 px-3 py-1.5 rounded-lg disabled:opacity-50"
            >
              {noShowMarking === r.id ? 'Marcando...' : '⚠️ No Llegó'}
            </button>
            <button
              onClick={() => handleCancelarReserva(r.id)} disabled={cancelando === r.id}
              className="text-xs text-red-500 font-bold active:scale-95 transition-transform bg-red-50 px-3 py-1.5 rounded-lg"
            >
              {cancelando === r.id ? 'Cancelando...' : 'Cancelar Cita'}
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="p-8 text-center text-gray-500 font-medium">Cargando panel...</div>;
  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <h1 className="text-3xl font-bold mb-6 text-gray-800">Turnobot Admin</h1>
        <button onClick={() => signInWithPopup(auth, provider)} className="p-4 bg-black text-white font-bold rounded-2xl shadow-md w-full max-w-xs active:scale-95 transition-transform">
          Iniciar Sesión con Google
        </button>
      </div>
    );
  }
  if (!negocio) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <h1 className="text-3xl font-bold mb-4 text-gray-800">Turnobot Admin</h1>
        <p className="text-gray-600 mb-6 font-medium text-sm">Aún no has configurado tu negocio.</p>
        <a href="/register" className="p-4 bg-black text-white font-bold rounded-2xl shadow-md w-full max-w-xs text-center active:scale-95 transition-transform">
          Crear mi negocio
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased flex flex-col">
      <header className="px-5 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm flex flex-col justify-center items-center">
        <h1 className="text-xl font-black text-gray-900 leading-none">{negocio.name}</h1>
        <p className="text-[11px] font-bold text-gray-400 mt-1 uppercase tracking-widest">Modo Administrador</p>
      </header>

      <main className="p-4 space-y-6 flex-1">
        {/* PESTAÑA: AGENDA */}
        {view === 'agenda' && (
          <div className="space-y-6">
            <button onClick={copiarEnlace} className="w-full py-4 bg-blue-600 text-white font-bold rounded-2xl shadow-md flex items-center justify-center gap-2 text-sm active:scale-95 transition-transform">
              {enlaceCopiado ? '✅ ¡Enlace copiado!' : '🔗 Copiar mi Enlace de Reservas'}
            </button>

            {reservas.length === 0 ? (
               <div className="py-8 text-center bg-gray-50 rounded-2xl border border-gray-200 border-dashed">
                 <div className="text-4xl mb-3">📅</div>
                 <p className="text-sm font-medium text-gray-500">No hay citas agendadas en el sistema.</p>
               </div>
            ) : (
              <div className="space-y-8">
                {/* SECCIÓN HOY (Agrupada por Hora) */}
                {citasHoy.length > 0 && (
                  <div>
                    <h3 className="text-sm font-black text-gray-900 mb-4 flex items-center gap-2 uppercase tracking-wider">
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span> 
                      Hoy
                    </h3>
                    <div className="space-y-5">
                      {agruparPorHora(citasHoy).map(grupo => (
                        <div key={grupo.hora} className="relative">
                          <h4 className="text-[11px] font-bold text-gray-400 mb-2 pl-1 border-b border-gray-200/60 pb-1">{grupo.hora}</h4>
                          <div className="space-y-3">
                            {grupo.citas.map(r => <RenderCitaCard key={r.id} r={r} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SECCIÓN MAÑANA (Agrupada por Hora) */}
                {citasManana.length > 0 && (
                  <div>
                    <h3 className="text-sm font-black text-gray-500 mb-4 flex items-center gap-2 uppercase tracking-wider">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> 
                      Mañana
                    </h3>
                    <div className="space-y-5">
                      {agruparPorHora(citasManana).map(grupo => (
                        <div key={grupo.hora} className="relative">
                          <h4 className="text-[11px] font-bold text-gray-400 mb-2 pl-1 border-b border-gray-200/60 pb-1">{grupo.hora}</h4>
                          <div className="space-y-3">
                            {grupo.citas.map(r => <RenderCitaCard key={r.id} r={r} />)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* SECCIÓN PRÓXIMAS (Agrupada por Día y Hora) */}
                {citasProximas.length > 0 && (
                  <div>
                    <h3 className="text-sm font-black text-gray-400 mb-4 flex items-center gap-2 uppercase tracking-wider">
                      Próximas
                    </h3>
                    <div className="space-y-3">
                      {citasProximas.map(r => <RenderCitaCard key={r.id} r={r} />)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* PESTAÑA: CLIENTES (CRM) */}
        {view === 'clientes' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 mb-1">Directorio de Clientes ({clientesCRM.length})</h2>
              <p className="text-xs text-gray-500 font-medium mb-4 leading-relaxed">
                Tus clientes más leales organizados por visitas y dinero invertido (LTV). Escríbeles para promociones.
              </p>
              {clientesCRM.length === 0 ? (
                <div className="py-8 text-center bg-gray-50 rounded-2xl border border-gray-100 border-dashed">
                  <div className="text-3xl mb-2">👥</div>
                  <p className="text-sm font-medium text-gray-500">Los clientes aparecerán aquí automáticamente.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {clientesCRM.map((c) => (
                    <div key={c.id} className="p-4 bg-white border border-gray-200 rounded-2xl shadow-2xs flex justify-between items-center gap-3">
                      <div>
                        <p className="font-bold text-gray-900 text-sm mb-1">{c.client_name}</p>
                        <a href={`https://wa.me/${c.cliente_phone}`} target="_blank" rel="noreferrer" className="text-xs text-green-600 font-bold bg-green-50 px-2 py-1 rounded-md">
                          {c.cliente_phone}
                        </a>
                        <p className="text-[10px] text-gray-400 font-bold mt-2 uppercase tracking-wider">
                          {c.visits || 0} visitas • Última: {fechaUltimaVisita(c)}
                        </p>
                      </div>
                      <div className="text-right flex flex-col items-end">
                        <span className="block text-sm font-black text-gray-900 bg-gray-50 px-2.5 py-1 rounded-lg border border-gray-200">
                          {formatDinero(c.total_spent)}
                        </span>
                        <span className="text-[10px] text-gray-400 font-bold uppercase mt-1">LTV</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PESTAÑA: AJUSTES */}
        {view === 'ajustes' && (
          <div className="space-y-5">
            {/* DATOS DEL LOCAL */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">Información del Local</h2>
              <p className="text-[11px] font-medium text-gray-500 mb-4">Estos datos se muestran en tu página pública.</p>
              <form onSubmit={handleGuardarInfoLocal} className="space-y-3">
                <input
                  type="text" required placeholder="Nombre del Negocio" value={infoLocal.name}
                  onChange={(e) => setInfoLocal({ ...infoLocal, name: e.target.value })}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                />
                <input
                  type="text" placeholder="Dirección física" value={infoLocal.direccion}
                  onChange={(e) => setInfoLocal({ ...infoLocal, direccion: e.target.value })}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                />
                <input
                  type="text" placeholder="Horario (Ej. Lun - Sáb: 9am a 7pm)" value={infoLocal.horario}
                  onChange={(e) => setInfoLocal({ ...infoLocal, horario: e.target.value })}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                />
                <input
                  type="tel" placeholder="Teléfono de contacto (Fijo o Móvil)" value={infoLocal.telefono}
                  onChange={(e) => setInfoLocal({ ...infoLocal, telefono: e.target.value })}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                />
                <button type="submit" disabled={guardandoInfo} className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform">
                  {guardandoInfo ? 'Guardando...' : 'Guardar Información'}
                </button>
              </form>
            </div>

            {/* WHATSAPP DEL NEGOCIO */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-1">WhatsApp de Reservas</h2>
              <p className="text-[11px] font-medium text-gray-500 mb-4">Número al que llegan las notificaciones de los clientes.</p>
              <form onSubmit={handleGuardarWhatsApp} className="space-y-3">
                <div className="flex gap-2">
                  <select
                    value={codigoPais}
                    onChange={(e) => setCodigoPais(e.target.value)}
                    className="p-3.5 border border-gray-200 rounded-xl text-sm bg-white font-bold focus:border-black focus:outline-none"
                  >
                    <option value="57">🇨🇴 +57</option>
                    <option value="52">🇲🇽 +52</option>
                    <option value="51">🇵🇪 +51</option>
                    <option value="56">🇨🇱 +56</option>
                    <option value="54">🇦🇷 +54</option>
                    <option value="34">🇪🇸 +34</option>
                    <option value="1">🇺🇸 +1</option>
                  </select>
                  <input
                    type="tel" inputMode="numeric" value={whatsApp}
                    onChange={(e) => setWhatsApp(e.target.value)}
                    placeholder="Ej. 3001234567"
                    className="flex-1 w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                  />
                </div>
                <button type="submit" disabled={guardandoWhatsApp} className="w-full py-3.5 bg-green-600 text-white font-bold rounded-xl text-sm disabled:opacity-50 active:scale-95 transition-transform shadow-sm">
                  {guardandoWhatsApp ? 'Guardando...' : 'Actualizar WhatsApp'}
                </button>
              </form>
            </div>

            {/* GESTIÓN DE SERVICIOS */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-4">Servicios Activos</h2>
              <ul className="space-y-2 mb-4">
                {servicios.length === 0 && <p className="text-sm font-medium text-gray-500 text-center py-4">No has agregado servicios.</p>}
                {servicios.map((s) => (
                  <li key={s.id} className="flex justify-between items-center p-3.5 bg-white border border-gray-200 shadow-2xs rounded-xl text-sm">
                    <div>
                      <p className="font-bold text-gray-900">{s.name}</p>
                      <p className="text-xs font-medium text-gray-500">{s.duration_minutes} min</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-black text-gray-900">{formatDinero(s.price)}</span>
                      <button onClick={() => handleEliminarServicio(s)} disabled={eliminando === s.id} className="text-red-500 font-black text-sm active:scale-90 transition-transform bg-red-50 w-8 h-8 rounded-full flex items-center justify-center">✕</button>
                    </div>
                  </li>
                ))}
              </ul>
              <form onSubmit={handleAddServicio} className="space-y-3 pt-3 border-t border-gray-100">
                <input
                  type="text" required placeholder="Nombre del servicio (ej. Corte clásico)" value={nuevoServicio.name}
                  onChange={(e) => setNuevoServicio({ ...nuevoServicio, name: e.target.value })}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                />
                <div className="flex gap-2">
                  <input
                    type="number" required placeholder="Minutos" inputMode="numeric" value={nuevoServicio.duration_minutes}
                    onChange={(e) => setNuevoServicio({ ...nuevoServicio, duration_minutes: e.target.value })}
                    className="w-1/2 p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                  />
                  <input
                    type="number" required placeholder="Precio" inputMode="numeric" value={nuevoServicio.price}
                    onChange={(e) => setNuevoServicio({ ...nuevoServicio, price: e.target.value })}
                    className="w-1/2 p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                  />
                </div>
                <button type="submit" className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform">
                  + Agregar Servicio
                </button>
              </form>
            </div>

            {/* GESTIÓN DE PROFESIONALES */}
            <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
              <h2 className="text-base font-bold text-gray-900 mb-4">Profesionales de la agenda</h2>
              <ul className="space-y-3 mb-4">
                {profesionales.length === 0 && <p className="text-sm font-medium text-gray-500 text-center py-4">No has agregado profesionales.</p>}
                {profesionales.map((p) => (
                  <li key={p.id} className="p-4 bg-white border border-gray-200 shadow-2xs rounded-xl text-sm space-y-3">
                    <div className="flex justify-between items-center">
                      <p className="font-bold text-gray-900 text-base">{p.name}</p>
                      <button onClick={() => handleEliminarProfesional(p)} disabled={eliminando === p.id} className="px-2.5 py-1.5 bg-red-50 text-red-600 font-bold rounded-lg text-xs active:scale-95 transition-transform">Eliminar</button>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
                      {p.calendar_id ? (
                        <span className="flex-1 text-center py-2 bg-green-50 text-green-700 text-[11px] font-black rounded-lg border border-green-100">✓ Calendar Activo</span>
                      ) : (
                        <a href={`${import.meta.env.VITE_API_URL || ''}/auth/google/login?negocio_id=${negocio.id}&emp_id=${p.id}`} className="flex-1 text-center py-2 bg-blue-600 text-white font-bold rounded-lg text-[11px] active:scale-95 shadow-sm">🔗 Vincular Calendar</a>
                      )}
                      <button onClick={() => setHorarioModal(p)} className="px-3.5 py-2 bg-gray-50 border border-gray-200 text-gray-800 font-bold rounded-lg text-[11px] flex items-center gap-1 shadow-sm active:scale-95">🕒 Horario</button>
                    </div>
                  </li>
                ))}
              </ul>
              {profesionales.length > 0 && profesionales.some((p) => !p.horario) && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-800 font-medium text-[11px] rounded-xl leading-relaxed">
                  ⚠️ Algunos profesionales no tienen horario individual. Usa el botón <b>🕒 Horario</b> para definir sus turnos y descansos.
                </div>
              )}
              <form onSubmit={handleAddProfesional} className="space-y-3 pt-3 border-t border-gray-100">
                <input
                  type="text" required placeholder="Nombre del profesional" value={nuevoProfesional.name}
                  onChange={(e) => setNuevoProfesional({ name: e.target.value })}
                  className="w-full p-3.5 border border-gray-200 rounded-xl text-sm focus:border-black focus:outline-none"
                />
                <button type="submit" className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-xl text-sm active:scale-95 transition-transform">+ Añadir Profesional</button>
              </form>
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

      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-2.5 flex justify-around items-center z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <button onClick={() => setView('agenda')} className={`flex flex-col items-center gap-1 text-[11px] font-black transition-colors ${view === 'agenda' ? 'text-black' : 'text-gray-400'}`}>
          <span className="text-xl">📅</span>
          <span>Agenda</span>
        </button>
        <button onClick={() => setView('clientes')} className={`flex flex-col items-center gap-1 text-[11px] font-black transition-colors ${view === 'clientes' ? 'text-black' : 'text-gray-400'}`}>
          <span className="text-xl">👥</span>
          <span>Clientes</span>
        </button>
        <button onClick={() => setView('ajustes')} className={`flex flex-col items-center gap-1 text-[11px] font-black transition-colors ${view === 'ajustes' ? 'text-black' : 'text-gray-400'}`}>
          <span className="text-xl">⚙️</span>
          <span>Ajustes</span>
        </button>
      </nav>

      {horarioModal && <HorarioEmpleadoModal negocioId={negocio.id} empleado={horarioModal} onClose={() => setHorarioModal(null)} />}
    </div>
  );
}
