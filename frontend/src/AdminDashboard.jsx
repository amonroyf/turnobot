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
  // Normalizar: empleados antiguos pueden tener un horario parcial (solo
  // algunos días). Se rellena con el horario por defecto para que el guardado
  // siempre envíe la semana completa que exigen las reglas de Firestore.
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
    setHorario({
      ...horario,
      [dia]: { ...actual, activo: !actual.activo },
    });
  };

  const handleTurnoChange = (dia, index, field, value) => {
    const nuevosTurnos = [...(horario[dia]?.turnos || [])];
    nuevosTurnos[index] = { ...nuevosTurnos[index], [field]: value };
    setHorario({
      ...horario,
      [dia]: { ...horario[dia], turnos: nuevosTurnos },
    });
  };

  const agregarTurno = (dia) => {
    const actuales = horario[dia]?.turnos || [];
    // Las reglas de Firestore permiten máximo 4 turnos por día.
    if (actuales.length >= 4) {
      alert('Máximo 4 turnos por día');
      return;
    }
    setHorario({
      ...horario,
      [dia]: {
        ...horario[dia],
        turnos: [...actuales, { inicio: '14:00', fin: '18:00' }],
      },
    });
  };

  const eliminarTurno = (dia, index) => {
    const nuevosTurnos = (horario[dia]?.turnos || []).filter((_, i) => i !== index);
    setHorario({
      ...horario,
      [dia]: { ...horario[dia], turnos: nuevosTurnos },
    });
  };

  const guardarHorario = async () => {
    setGuardando(true);
    try {
      const empRef = doc(db, `negocios/${negocioId}/empleados`, empleado.id);
      await updateDoc(empRef, { horario });
      alert(`Horario de ${empleado.name} actualizado`);
      onClose();
    } catch (err) {
      console.error('Error guardando horario:', err);
      alert(`Error al guardar el horario (${err?.code || 'desconocido'}). Revisa que cada turno tenga hora válida y máximo 4 turnos por día.`);
    }
    setGuardando(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-1">Horario Laboral</h3>
        <p className="text-sm text-gray-500 mb-4">{empleado.name}</p>

        <div className="space-y-4">
          {DIAS_SEMANA.map((dia) => (
            <div key={dia} className="border-b pb-3">
              <div className="flex justify-between items-center mb-2">
                <span className="capitalize font-semibold">{dia}</span>
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
                        type="time"
                        value={t.inicio}
                        onChange={(e) => handleTurnoChange(dia, idx, 'inicio', e.target.value)}
                        className="border p-1 rounded text-sm"
                      />
                      <span className="text-gray-400">a</span>
                      <input
                        type="time"
                        value={t.fin}
                        onChange={(e) => handleTurnoChange(dia, idx, 'fin', e.target.value)}
                        className="border p-1 rounded text-sm"
                      />
                      {(horario[dia].turnos || []).length > 1 && (
                        <button
                          onClick={() => eliminarTurno(dia, idx)}
                          className="text-red-400 hover:text-red-600 text-xs"
                          title="Eliminar turno"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => agregarTurno(dia)}
                    className="text-xs text-blue-600 font-bold hover:underline"
                  >
                    + Agregar Turno Partido
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 border rounded-xl font-bold text-sm">
            Cancelar
          </button>
          <button
            onClick={guardarHorario}
            disabled={guardando}
            className="px-4 py-2 bg-black text-white rounded-xl font-bold text-sm disabled:opacity-50"
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
  const [servicios, setServicios] = useState([]);
  const [profesionales, setProfesionales] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelando, setCancelando] = useState('');

  const [nuevoServicio, setNuevoServicio] = useState({
    name: '',
    duration_minutes: 30,
    price: '',
  });
  const [nuevoProfesional, setNuevoProfesional] = useState({ name: '' });
  const [eliminando, setEliminando] = useState('');
  const [horarioModal, setHorarioModal] = useState(null); // null or {id, name, horario}
  const [whatsApp, setWhatsApp] = useState('');
  const [codigoPais, setCodigoPais] = useState('57');
  const [guardandoWhatsApp, setGuardandoWhatsApp] = useState(false);
  const [enlaceCopiado, setEnlaceCopiado] = useState(false);

  useEffect(() => {
    if (negocio) setWhatsApp(negocio.whatsapp || '');
  }, [negocio]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        const qNegocio = query(
          collection(db, 'negocios'),
          where('owner_uid', '==', currentUser.uid),
        );
        const qs = await getDocs(qNegocio);

        if (!qs.empty) {
          const docSnap = qs.docs[0];
          setNegocio({ id: docSnap.id, ...docSnap.data() });

          onSnapshot(
            collection(db, `negocios/${docSnap.id}/servicios`),
            (snapshot) =>
              setServicios(
                snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
              ),
          );

          onSnapshot(
            collection(db, `negocios/${docSnap.id}/empleados`),
            (snapshot) =>
              setProfesionales(
                snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
              ),
          );

          const qReservas = query(
            collection(db, 'reservas'),
            where('negocio_id', '==', docSnap.id),
          );
          const intentosReservas = { n: 0 };
          const suscribirReservas = () => {
            onSnapshot(
              qReservas,
              (snapshot) => {
                intentosReservas.n = 0;
                const citas = snapshot.docs
                  .map((d) => ({ id: d.id, ...d.data() }))
                  .sort(
                    (a, b) =>
                      (a.date_time?.seconds || 0) - (b.date_time?.seconds || 0),
                  );
                setReservas(citas);
              },
              (err) => {
                // Consistencia eventual de reglas: el get() sobre el negocio
                // recién creado puede fallar en el primer subscribe. Se reintenta
                // con backoff; la suscripción nueva entrega el estado actual.
                if (intentosReservas.n < 5 && err?.code === 'permission-denied') {
                  intentosReservas.n += 1;
                  setTimeout(suscribirReservas, 2000 * intentosReservas.n);
                } else {
                  console.error('Error en listener de reservas:', err);
                }
              },
            );
          };
          suscribirReservas();

          const qClientes = query(
            collection(db, 'clientes'),
            where('negocio_id', '==', docSnap.id),
          );
          const intentosClientes = { n: 0 };
          const suscribirClientes = () => {
            onSnapshot(
              qClientes,
              (snapshot) => {
                intentosClientes.n = 0;
                setClientes(
                  snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
                );
              },
              (err) => {
                if (intentosClientes.n < 5 && err?.code === 'permission-denied') {
                  intentosClientes.n += 1;
                  setTimeout(suscribirClientes, 2000 * intentosClientes.n);
                } else {
                  console.error('Error en listener de clientes:', err);
                }
              },
            );
          };
          suscribirClientes();
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

  const handleAddServicio = async (e) => {
    e.preventDefault();
    if (!negocio) return;

    try {
      await addDoc(
        collection(db, `negocios/${negocio.id}/servicios`),
        {
          name: nuevoServicio.name,
          duration_minutes: Number(nuevoServicio.duration_minutes),
          price: nuevoServicio.price,
        },
      );
      setNuevoServicio({ name: '', duration_minutes: 30, price: '' });
    } catch (err) {
      console.error('Error al guardar el servicio:', err);
      alert('Error al guardar el servicio');
    }
  };

  const handleAddProfesional = async (e) => {
    e.preventDefault();
    if (!negocio) return;

    try {
      await addDoc(
        collection(db, `negocios/${negocio.id}/empleados`),
        {
          name: nuevoProfesional.name,
          calendar_id: '',
        },
      );
      setNuevoProfesional({ name: '' });
    } catch (err) {
      console.error('Error al guardar el profesional:', err);
      alert('Error al guardar el profesional');
    }
  };

  const handleEliminarServicio = async (servicio) => {
    if (!negocio || !user) return;
    if (
      !confirm(
        `¿Eliminar "${servicio.name}"? También se cancelarán sus citas futuras y se liberarán las agendas.`,
      )
    )
      return;

    setEliminando(servicio.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/servicios/${servicio.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error('Error al eliminar');
    } catch (err) {
      console.error(err);
      alert('No se pudo eliminar el servicio. Intenta nuevamente.');
    }
    setEliminando('');
  };

  const handleEliminarProfesional = async (profesional) => {
    if (!negocio || !user) return;
    if (
      !confirm(
        `¿Eliminar a "${profesional.name}"? También se cancelarán sus citas futuras y se liberará su agenda de Google Calendar.`,
      )
    )
      return;

    setEliminando(profesional.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/empleados/${profesional.id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error('Error al eliminar');
    } catch (err) {
      console.error(err);
      alert('No se pudo eliminar el profesional. Intenta nuevamente.');
    }
    setEliminando('');
  };

  const handleCancelarReserva = async (citaId) => {
    if (
      !confirm(
        '¿Seguro que deseas cancelar esta cita? Se eliminará del calendario del profesional.',
      )
    )
      return;

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

      if (!res.ok) throw new Error('Error al cancelar');
    } catch (err) {
      alert('No se pudo cancelar la cita. Intenta nuevamente.');
    } finally {
      setCancelando('');
    }
  };

  const handleGuardarWhatsApp = async (e) => {
    e.preventDefault();
    if (!negocio) return;
    const digitos = whatsApp.replace(/\D/g, '');
    const limpio = digitos.startsWith(codigoPais) ? digitos : codigoPais + digitos;
    if (limpio.length < 10) {
      alert('Ingresa el número local del WhatsApp (ej. 3001234567)');
      return;
    }
    setGuardandoWhatsApp(true);
    try {
      await updateDoc(doc(db, 'negocios', negocio.id), { whatsapp: limpio });
      setNegocio({ ...negocio, whatsapp: limpio });
      alert('WhatsApp actualizado');
    } catch (err) {
      console.error('Error guardando WhatsApp:', err);
      alert('No se pudo actualizar el WhatsApp. Intenta nuevamente.');
    }
    setGuardandoWhatsApp(false);
  };

  // --- LÓGICA CRM (Cerrojo SaaS) ---
  // Los clientes viven en la colección clientes (mantenida por el backend).
  // Ordenamos por número de visitas (los más leales primero).
  const formatDinero = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
  // Fecha de la última cita: primero el respaldo YYYY-MM-DD en zona del negocio
  // (evita desfases por zona horaria del navegador); si no existe, cae al
  // Timestamp de Firestore; si tampoco, "N/A".
  const fechaUltimaVisita = (c) => {
    if (c.last_date_str) {
      const [year, month, day] = c.last_date_str.split('-').map(Number);
      if (year && month && day) {
        return new Date(year, month - 1, day).toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      }
    }
    if (c.last_seen) {
      const ms = c.last_seen.seconds
        ? c.last_seen.seconds * 1000
        : c.last_seen instanceof Date
          ? c.last_seen.getTime()
          : NaN;
      if (ms) {
        return new Date(ms).toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
      }
    }
    return 'N/A';
  };
  const clientesCRM = [...clientes].sort(
    (a, b) => (b.visits || 0) - (a.visits || 0),
  );

  if (loading) return <div className="p-8 text-center">Cargando panel...</div>;

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <h1 className="text-3xl font-bold mb-6 text-gray-800">Turnobot Admin</h1>
        <button
          onClick={() => signInWithPopup(auth, provider)}
          className="p-4 bg-black text-white font-bold rounded-xl w-full max-w-xs"
        >
          Iniciar Sesión con Google
        </button>
      </div>
    );
  }

  if (!negocio) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <h1 className="text-3xl font-bold mb-4 text-gray-800">Turnobot Admin</h1>
        <p className="text-gray-600 mb-6">
          Aún no has configurado tu negocio.
        </p>
        <a
          href="/register"
          className="p-4 bg-black text-white font-bold rounded-xl w-full max-w-xs text-center"
        >
          Crear mi negocio
        </a>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4 font-sans antialiased pb-28">
      {/* CABECERA MÓVIL */}
      <header className="mb-6 flex justify-between items-center border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{negocio.name}</h1>
          <p className="text-xs text-gray-400">Panel de Administración</p>
        </div>
        <button
          onClick={logout}
          className="text-xs font-bold text-red-500 px-3 py-2 bg-red-50 rounded-xl"
        >
          Cerrar Sesión
        </button>
      </header>

      {/* WHATSAPP DEL NEGOCIO */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm mb-6">
        <h2 className="text-base font-bold text-gray-800 mb-1">WhatsApp del local</h2>
        <p className="text-xs text-gray-500 mb-3">
          Número al que llegan las confirmaciones de citas y las consultas de tus clientes.
        </p>
        <form onSubmit={handleGuardarWhatsApp} className="space-y-2">
          <div className="flex gap-2">
            <select
              value={codigoPais}
              onChange={(e) => setCodigoPais(e.target.value)}
              className="p-3 border border-gray-200 rounded-xl text-sm bg-white font-semibold"
            >
              <option value="57">🇨🇴 +57</option>
              <option value="52">🇲🇽 +52</option>
              <option value="51">🇵🇪 +51</option>
              <option value="56">🇨🇱 +56</option>
              <option value="54">🇦🇷 +54</option>
              <option value="58">🇻🇪 +58</option>
              <option value="593">🇪🇨 +593</option>
              <option value="55">🇧🇷 +55</option>
              <option value="34">🇪🇸 +34</option>
              <option value="1">🇺🇸 +1</option>
            </select>
            <input
              type="tel"
              value={whatsApp}
              onChange={(e) => setWhatsApp(e.target.value)}
              placeholder="Ej. 3001234567"
              className="flex-1 min-w-[160px] p-3 border border-gray-200 rounded-xl text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={guardandoWhatsApp}
            className="w-full py-3 bg-black text-white font-bold rounded-xl text-sm disabled:opacity-50"
          >
            {guardandoWhatsApp ? 'Guardando...' : 'Guardar WhatsApp'}
          </button>
          <p className="text-xs text-gray-400">
            Escribe solo los 10 dígitos locales (sin 0 inicial ni espacios). Cambia el indicativo si tu WhatsApp es de otro país.
          </p>
        </form>
      </div>

      {/* GESTIÓN DE SERVICIOS */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-3">Servicios</h2>
        <ul className="space-y-2.5 mb-4">
          {servicios.length === 0 && (
            <div className="text-center py-6">
              <div className="text-4xl mb-2">🛠️</div>
              <p className="text-sm text-gray-500 mb-4">
                Aún no tienes servicios. Agrega el primero para empezar a recibir reservas.
              </p>
              <button
                onClick={() => document.getElementById('inp-nuevo-servicio').focus()}
                className="px-4 py-2 bg-black text-white font-bold rounded-xl text-sm"
              >
                Crea tu primer servicio
              </button>
            </div>
          )}
          {servicios.map((s) => (
            <li
              key={s.id}
              className="flex justify-between items-center p-3 bg-gray-50 rounded-xl text-sm border border-gray-100"
            >
              <div>
                <p className="font-bold text-gray-800">{s.name}</p>
                <p className="text-xs text-gray-400">{s.duration_minutes} min</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-semibold">${s.price}</span>
                <button
                  onClick={() => handleEliminarServicio(s)}
                  disabled={eliminando === s.id}
                  aria-label={`Eliminar servicio ${s.name}`}
                  title="Eliminar servicio"
                  className="text-red-400 hover:text-red-600 disabled:opacity-40"
                >
                  {eliminando === s.id ? '…' : '🗑️'}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddServicio} className="space-y-2.5 pt-3 border-t border-gray-100">
          <input
            id="inp-nuevo-servicio"
            type="text"
            required
            placeholder="Nombre (ej. Corte clásico)"
            value={nuevoServicio.name}
            onChange={(e) =>
              setNuevoServicio({ ...nuevoServicio, name: e.target.value })
            }
            className="w-full p-3 border border-gray-200 rounded-xl text-sm"
          />
          <div className="flex gap-2">
            <input
              type="number"
              required
              placeholder="Minutos"
              value={nuevoServicio.duration_minutes}
              onChange={(e) =>
                setNuevoServicio({
                  ...nuevoServicio,
                  duration_minutes: e.target.value,
                })
              }
              className="w-1/2 p-3 border border-gray-200 rounded-xl text-sm"
            />
            <input
              type="text"
              required
              placeholder="Precio"
              value={nuevoServicio.price}
              onChange={(e) =>
                setNuevoServicio({ ...nuevoServicio, price: e.target.value })
              }
              className="w-1/2 p-3 border border-gray-200 rounded-xl text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full py-3 bg-black text-white font-bold rounded-xl text-sm"
          >
            Guardar Servicio
          </button>
        </form>
      </div>

      {/* GESTIÓN DE PROFESIONALES */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-3">Profesionales</h2>
        <ul className="space-y-3 mb-4">
          {profesionales.length === 0 && (
            <div className="text-center py-6">
              <div className="text-4xl mb-2">👥</div>
              <p className="text-sm text-gray-500 mb-4">
                Aún no tienes profesionales. Agrega la primera persona que atenderá tus turnos.
              </p>
              <button
                onClick={() => document.getElementById('inp-nuevo-profesional').focus()}
                className="px-4 py-2 bg-black text-white font-bold rounded-xl text-sm"
              >
                Crea tu primer profesional ahora
              </button>
            </div>
          )}
          {profesionales.map((p) => (
            <li key={p.id} className="p-3.5 bg-gray-50 rounded-xl text-sm border border-gray-100 space-y-2">
              <div className="flex justify-between items-center">
                <p className="font-bold text-gray-800">{p.name}</p>
                <button
                  onClick={() => handleEliminarProfesional(p)}
                  disabled={eliminando === p.id}
                  aria-label={`Eliminar profesional ${p.name}`}
                  title="Eliminar profesional"
                  className="px-3 py-2 bg-red-50 text-red-600 font-semibold rounded-lg text-xs disabled:opacity-40"
                >
                  {eliminando === p.id ? '…' : 'Eliminar'}
                </button>
              </div>
              <div className="flex items-center justify-between gap-2">
                {p.calendar_id ? (
                  <span className="inline-block px-2.5 py-1 bg-green-100 text-green-700 text-xs font-bold rounded-lg">
                    ✅ Calendario Vinculado
                  </span>
                ) : (
                  <a
                    href={`${import.meta.env.VITE_API_URL || ''}/auth/google/login?negocio_id=${negocio.id}&emp_id=${p.id}`}
                    className="block text-center py-2 bg-blue-600 text-white font-bold rounded-lg text-xs flex-1"
                  >
                    🔗 Vincular Google Calendar
                  </a>
                )}
                <button
                  onClick={() => setHorarioModal(p)}
                  className="px-3 py-2 bg-gray-100 text-gray-700 font-semibold rounded-lg text-xs hover:bg-gray-200"
                >
                  ⏰ Horario
                </button>
              </div>
            </li>
          ))}
        </ul>
        {profesionales.length > 0 && profesionales.some((p) => !p.horario) && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-xl">
            ⚠️ Algunos profesionales no tienen horario individual configurado. Usarán el horario general del negocio como respaldo. Haz clic en ⏰ Horario para definir turnos por profesional.
          </div>
        )}
        <form onSubmit={handleAddProfesional} className="space-y-2.5 pt-3 border-t border-gray-100">
          <input
            id="inp-nuevo-profesional"
            type="text"
            required
            placeholder="Nombre del profesional"
            value={nuevoProfesional.name}
            onChange={(e) =>
              setNuevoProfesional({ name: e.target.value })
            }
            className="w-full p-3 border border-gray-200 rounded-xl text-sm"
          />
          <button
            type="submit"
            className="w-full py-3 bg-black text-white font-bold rounded-xl text-sm"
          >
            Añadir Profesional
          </button>
        </form>
      </div>

      {/* PRÓXIMAS RESERVAS (TARJETAS MÓVILES) */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-4">Próximas Reservas ({reservas.length})</h2>
        {reservas.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">No hay citas agendadas aún.</p>
        ) : (
          <div className="space-y-3">
            {reservas.map((r) => {
              const fechaObj = r.date_time ? new Date(r.date_time.seconds * 1000) : null;
              const fechaFormateada = fechaObj
                ? fechaObj.toLocaleDateString('es-ES', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })
                : 'N/A';
              const horaFormateada = fechaObj
                ? fechaObj.toLocaleTimeString('es-ES', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'N/A';
              const profesional = profesionales.find((p) => p.id === r.emp_id);

              return (
                <div key={r.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl space-y-2">
                  <div className="flex justify-between items-start gap-3">
                    <div>
                      <p className="font-bold text-gray-900 text-sm">{r.client_name}</p>
                      <p className="text-xs text-gray-500">{r.service_name} • {profesional?.name || 'Profesional'}</p>
                      <p className="text-xs text-gray-500 capitalize">{fechaFormateada} · {horaFormateada}</p>
                    </div>
                    <a
                      href={`https://wa.me/${r.user_phone}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-green-600 font-bold whitespace-nowrap"
                    >
                      💬 WhatsApp
                    </a>
                  </div>
                  <div className="flex justify-end pt-2 border-t border-gray-200/60">
                    <button
                      onClick={() => handleCancelarReserva(r.id)}
                      disabled={cancelando === r.id}
                      className="text-xs text-red-500 font-bold disabled:opacity-50"
                    >
                      {cancelando === r.id ? 'Cancelando...' : 'Cancelar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CRM: DIRECTORIO DE CLIENTES (TARJETAS MÓVILES) */}
      <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm mb-6">
        <h2 className="text-base font-bold text-gray-900 mb-3">Directorio de Clientes ({clientesCRM.length})</h2>
        <p className="text-xs text-gray-500 mb-4">
          LTV, visitas y última visita de tus clientes más leales. Úsalos para enviarles promociones por WhatsApp.
        </p>
        {clientesCRM.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-6">
            Los clientes aparecerán automáticamente al agendar una cita.
          </p>
        ) : (
          <div className="space-y-3">
            {clientesCRM.map((c) => (
              <div key={c.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl flex justify-between items-center gap-3">
                <div>
                  <p className="font-bold text-gray-900 text-sm">{c.client_name}</p>
                  <a
                    href={`https://wa.me/${c.cliente_phone}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-green-600 font-semibold"
                  >
                    💬 {c.cliente_phone}
                  </a>
                  <p className="text-[10px] text-gray-400 font-semibold mt-1">
                    {c.visits || 0} visitas · Última: {fechaUltimaVisita(c)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="block text-sm font-black text-green-700 bg-green-50 px-2 py-0.5 rounded-md">
                    {formatDinero(c.total_spent)}
                  </span>
                  <span className="text-[10px] text-gray-400 font-semibold">LTV</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* BARRA DE ACCIÓN FIJA: COMPARTIR ENLACE */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-gray-200 z-50">
        <button
          onClick={copiarEnlace}
          className="w-full max-w-2xl mx-auto py-3.5 bg-blue-600 text-white font-bold rounded-2xl shadow-md flex items-center justify-center gap-2 text-sm"
        >
          {enlaceCopiado ? '✅ ¡Enlace copiado!' : '🔗 Copiar mi Enlace de Reservas'}
        </button>
      </div>

      {horarioModal && (
        <HorarioEmpleadoModal
          negocioId={negocio.id}
          empleado={horarioModal}
          onClose={() => setHorarioModal(null)}
        />
      )}
    </div>
  );
}