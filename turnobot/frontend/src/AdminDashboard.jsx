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
} from 'firebase/firestore';

export default function AdminDashboard() {
  const [user, setUser] = useState(null);
  const [negocio, setNegocio] = useState(null);
  const [servicios, setServicios] = useState([]);
  const [profesionales, setProfesionales] = useState([]);
  const [reservas, setReservas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cancelando, setCancelando] = useState('');

  const [nuevoServicio, setNuevoServicio] = useState({
    name: '',
    duration_minutes: 30,
    price: '',
  });
  const [nuevoProfesional, setNuevoProfesional] = useState({ name: '' });

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

          const unSubServicios = onSnapshot(
            collection(db, `negocios/${docSnap.id}/servicios`),
            (snapshot) =>
              setServicios(
                snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
              ),
          );

          const unSubProfesionales = onSnapshot(
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
          const unSubReservas = onSnapshot(qReservas, (snapshot) => {
            const citas = snapshot.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort(
                (a, b) =>
                  (a.date_time?.seconds || 0) - (b.date_time?.seconds || 0),
              );
            setReservas(citas);
          });

          return () => {
            unSubServicios();
            unSubProfesionales();
            unSubReservas();
          };
        }
      }

      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = () => signOut(auth);

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
      alert('Error al guardar el profesional');
    }
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
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/v1/b/${negocio.id}/citas/${citaId}`,
        { method: 'DELETE' },
      );

      if (!res.ok) throw new Error('Error al cancelar');
    } catch (err) {
      alert('No se pudo cancelar la cita. Intenta nuevamente.');
    } finally {
      setCancelando('');
    }
  };

  if (loading) return <div className="p-8 text-center">Cargando panel...</div>;

  if (!user || !negocio) {
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

  return (
    <div className="max-w-4xl mx-auto p-6 font-sans">
      <header className="flex justify-between items-center mb-8 border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{negocio.name}</h1>
          <a
            href={`/shop/${negocio.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-blue-600 hover:underline"
          >
            Ver mi página pública
          </a>
        </div>
        <button
          onClick={logout}
          className="text-sm text-red-500 font-semibold px-4 py-2 bg-red-50 rounded-lg"
        >
          Cerrar Sesión
        </button>
      </header>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
          <h2 className="text-lg font-bold mb-4 text-gray-800">Servicios</h2>

          <ul className="space-y-3 mb-6">
            {servicios.length === 0 && (
              <p className="text-sm text-gray-500">No has agregado servicios.</p>
            )}
            {servicios.map((s) => (
              <li
                key={s.id}
                className="flex justify-between items-center p-3 bg-gray-50 rounded-xl text-sm"
              >
                <span>
                  <strong className="text-gray-800">{s.name}</strong> ({s.duration_minutes} min)
                </span>
                <span className="font-semibold">${s.price}</span>
              </li>
            ))}
          </ul>

          <form onSubmit={handleAddServicio} className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700">
              Agregar nuevo servicio
            </h3>
            <input
              type="text"
              required
              placeholder="Nombre (ej. Corte clásico)"
              value={nuevoServicio.name}
              onChange={(e) =>
                setNuevoServicio({ ...nuevoServicio, name: e.target.value })
              }
              className="w-full p-3 border border-gray-300 rounded-xl text-sm"
            />
            <div className="flex gap-3">
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
                className="w-1/2 p-3 border border-gray-300 rounded-xl text-sm"
              />
              <input
                type="text"
                required
                placeholder="Precio"
                value={nuevoServicio.price}
                onChange={(e) =>
                  setNuevoServicio({ ...nuevoServicio, price: e.target.value })
                }
                className="w-1/2 p-3 border border-gray-300 rounded-xl text-sm"
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

        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
          <h2 className="text-lg font-bold mb-4 text-gray-800">Profesionales</h2>

          <ul className="space-y-3 mb-6">
            {profesionales.length === 0 && (
              <p className="text-sm text-gray-500">
                No has agregado profesionales.
              </p>
            )}
            {profesionales.map((p) => (
              <li
                key={p.id}
                className="p-4 bg-gray-50 rounded-xl text-sm space-y-3"
              >
                <p className="font-bold text-gray-800">{p.name}</p>
                {p.calendar_id ? (
                  <span className="inline-block px-3 py-1 bg-green-100 text-green-700 text-xs font-semibold rounded-full">
                    ✅ Calendario Vinculado
                  </span>
                ) : (
                  <a
                    href={`${import.meta.env.VITE_API_URL || ''}/auth/google/login?negocio_id=${negocio.id}&emp_id=${p.id}`}
                    className="block text-center w-full py-2 bg-blue-600 text-white font-semibold rounded-lg text-xs"
                  >
                    Vincular Google Calendar
                  </a>
                )}
              </li>
            ))}
          </ul>

          <form onSubmit={handleAddProfesional} className="space-y-3 border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700">
              Agregar profesional
            </h3>
            <input
              type="text"
              required
              placeholder="Nombre del profesional"
              value={nuevoProfesional.name}
              onChange={(e) =>
                setNuevoProfesional({ name: e.target.value })
              }
              className="w-full p-3 border border-gray-300 rounded-xl text-sm"
            />
            <button
              type="submit"
              className="w-full py-3 bg-black text-white font-bold rounded-xl text-sm"
            >
              Añadir Profesional
            </button>
          </form>
        </div>
      </div>

      <div className="md:col-span-2 bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mt-2">
        <h2 className="text-lg font-bold mb-4 text-gray-800">Próximas Reservas</h2>

        {reservas.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            Aún no tienes citas agendadas.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                <tr>
                  <th className="p-3 rounded-tl-lg">Fecha y Hora</th>
                  <th className="p-3">Cliente</th>
                  <th className="p-3">Contacto</th>
                  <th className="p-3">Servicio</th>
                  <th className="p-3">Profesional</th>
                  <th className="p-3 text-right rounded-tr-lg">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reservas.map((r) => {
                  const fechaObj =
                    r.date_time ? new Date(r.date_time.seconds * 1000) : null;
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
                    <tr
                      key={r.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="p-3 font-medium text-gray-900 capitalize">
                        {fechaFormateada}{' '}
                        <span className="text-gray-500 font-normal ml-1">
                          {horaFormateada}
                        </span>
                      </td>
                      <td className="p-3">{r.client_name}</td>
                      <td className="p-3">
                        <a
                          href={`https://wa.me/${r.user_phone}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-green-600 hover:underline"
                        >
                          {r.user_phone}
                        </a>
                      </td>
                      <td className="p-3">{r.service_name}</td>
                      <td className="p-3">
                        {profesional?.name || 'Desconocido'}
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleCancelarReserva(r.id)}
                          disabled={cancelando === r.id}
                          className="text-red-500 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          {cancelando === r.id ? 'Cancelando...' : 'Cancelar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
