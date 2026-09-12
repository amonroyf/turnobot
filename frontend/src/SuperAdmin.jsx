import { useState, useEffect, useCallback } from 'react';
import { auth, provider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  collection, getDocs, doc, deleteDoc, updateDoc, onSnapshot, query, where,
} from 'firebase/firestore';
import { formatearTelefono } from './fecha.js';

const API_URL = import.meta.env.VITE_API_URL || '';

// UID del super admin del SaaS (solo esta cuenta tiene acceso)
const SUPER_ADMIN_UID = '0FF1nrcBnSPIdB1rMgYocmRnYUb2';

const formatDinero = (n) => '$' + Number(n || 0).toLocaleString('es-CO');

// ──────────────────────────────────────────────────────────────
// Componentes auxiliares
// ──────────────────────────────────────────────────────────────

function MetricCard({ icon, label, value, sub }) {
  return (
    <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-start gap-4">
      <div className="text-2xl">{icon}</div>
      <div>
        <p className="text-2xl font-black text-gray-900">{value}</p>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mt-0.5">{label}</p>
        {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// NegocioCard — con badge de suspensión y botón de acción
// ──────────────────────────────────────────────────────────────

function NegocioCard({ negocio, stats, onSelect, selected, onToggleSuspend }) {
  const suspended = negocio.suspended === true;

  return (
    <div
      className={`relative rounded-2xl border transition-all ${
        selected
          ? 'border-black bg-black text-white shadow-lg'
          : suspended
            ? 'border-amber-200 bg-amber-50 shadow-sm'
            : 'border-gray-200 bg-white hover:border-gray-300 shadow-sm'
      }`}
    >
      <button
        onClick={() => onSelect(negocio.id)}
        className="w-full text-left p-5 active:scale-[0.99] transition-transform"
      >
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className={`font-bold text-base truncate ${selected ? 'text-white' : 'text-gray-900'}`}>
                {negocio.name || negocio.id}
              </p>
              {suspended && (
                <span className="text-[10px] font-black bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full shrink-0">
                  SUSPENDIDO
                </span>
              )}
            </div>
            <p className={`text-xs mt-1 font-medium ${selected ? 'text-gray-300' : 'text-gray-400'}`}>
              /{negocio.id}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-lg font-black ${selected ? 'text-white' : 'text-gray-900'}`}>
              {stats?.reservas || 0}
            </p>
            <p className={`text-[10px] font-bold uppercase ${selected ? 'text-gray-400' : 'text-gray-400'}`}>
              citas
            </p>
          </div>
        </div>
        <div className={`flex gap-4 mt-3 pt-3 border-t ${selected ? 'border-gray-700' : 'border-gray-100'}`}>
          <span className={`text-[11px] font-bold ${selected ? 'text-gray-300' : 'text-gray-500'}`}>
            👥 {stats?.clientes || 0} clientes
          </span>
          <span className={`text-[11px] font-bold ${selected ? 'text-gray-300' : 'text-gray-500'}`}>
            💰 {formatDinero(stats?.ingresos || 0)}
          </span>
          <span className={`text-[11px] font-bold ${selected ? 'text-gray-300' : 'text-gray-500'}`}>
            ✂️ {stats?.servicios || 0} servicios
          </span>
        </div>
      </button>

      {/* Botones de acción (fuera del área clickeable de selección) */}
      <div className={`flex border-t ${selected ? 'border-gray-700' : 'border-gray-100'}`}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSuspend(negocio.id, suspended); }}
          className={`flex-1 py-2.5 text-[11px] font-bold active:scale-95 transition-transform ${
            suspended
              ? 'text-green-600 hover:bg-green-50'
              : 'text-amber-600 hover:bg-amber-50'
          }`}
        >
          {suspended ? '✓ Reactivar' : '⏸ Suspender'}
        </button>
        <div className={`w-px ${selected ? 'bg-gray-700' : 'bg-gray-100'}`} />
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(negocio.id); }}
          className={`flex-1 py-2.5 text-[11px] font-bold active:scale-95 transition-transform ${
            selected ? 'text-gray-300 hover:bg-gray-800' : 'text-blue-600 hover:bg-blue-50'
          }`}
        >
          🔍 Ver Detalle
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// NegocioDetalle — con eliminación de negocio
// ──────────────────────────────────────────────────────────────

function NegocioDetalle({ negocioId, negocio, onBack, onDeleted }) {
  const [reservas, setReservas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [servicios, setServicios] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    const unsubReservas = onSnapshot(
      query(collection(db, 'reservas'), where('negocio_id', '==', negocioId)),
      (snap) => {
        const now = Date.now();
        const citas = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((c) => {
            const t = c.date_time?.seconds * 1000;
            return t && t >= now && c.cancelled !== true;
          })
          .sort((a, b) => (a.date_time?.seconds || 0) - (b.date_time?.seconds || 0));
        setReservas(citas);
      },
    );

    const unsubClientes = onSnapshot(
      query(collection(db, 'clientes'), where('negocio_id', '==', negocioId)),
      (snap) => setClientes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );

    const unsubServicios = onSnapshot(
      collection(db, `negocios/${negocioId}/servicios`),
      (snap) => setServicios(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );

    const unsubEmpleados = onSnapshot(
      collection(db, `negocios/${negocioId}/empleados`),
      (snap) => {
        setEmpleados(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setLoading(false);
      },
    );

    return () => {
      unsubReservas();
      unsubClientes();
      unsubServicios();
      unsubEmpleados();
    };
  }, [negocioId]);

  const totalIngresos = clientes.reduce((sum, c) => sum + (c.total_spent || 0), 0);
  const totalVisitas = clientes.reduce((sum, c) => sum + (c.visits || 0), 0);
  const suspended = negocio?.suspended === true;

  const handleEliminarNegocio = async () => {
    const confirmacion = window.confirm(
      `⚠️ ELIMINAR NEGOCIO "${negocioId}"\n\n` +
      `Esto eliminará:\n` +
      `• El documento del negocio\n` +
      `• Todos sus servicios (${servicios.length})\n` +
      `• Todos sus profesionales (${empleados.length})\n` +
      `• Todas sus citas futuras (${reservas.length})\n` +
      `• Los registros de clientes\n\n` +
      `Esta acción NO se puede deshacer.`,
    );
    if (!confirmacion) return;

    setEliminando(true);
    try {
      // 1. Eliminar reservas futuras del Firestore
      const reservasSnap = await getDocs(
        query(collection(db, 'reservas'), where('negocio_id', '==', negocioId)),
      );
      const batch1 = [];
      for (const d of reservasSnap.docs) {
        batch1.push(deleteDoc(d.ref));
      }
      await Promise.all(batch1);

      // 2. Eliminar clientes
      const clientesSnap = await getDocs(
        query(collection(db, 'clientes'), where('negocio_id', '==', negocioId)),
      );
      const batch2 = [];
      for (const d of clientesSnap.docs) {
        batch2.push(deleteDoc(d.ref));
      }
      await Promise.all(batch2);

      // 3. Eliminar servicios
      const svcSnap = await getDocs(collection(db, `negocios/${negocioId}/servicios`));
      const batch3 = [];
      for (const d of svcSnap.docs) {
        batch3.push(deleteDoc(d.ref));
      }
      await Promise.all(batch3);

      // 4. Eliminar empleados
      const empSnap = await getDocs(collection(db, `negocios/${negocioId}/empleados`));
      const batch4 = [];
      for (const d of empSnap.docs) {
        batch4.push(deleteDoc(d.ref));
      }
      await Promise.all(batch4);

      // 5. Eliminar el documento del negocio
      await deleteDoc(doc(db, 'negocios', negocioId));

      alert(`✅ Negocio "${negocioId}" eliminado correctamente.`);
      onDeleted();
    } catch (err) {
      console.error('Error eliminando negocio:', err);
      alert('Error al eliminar el negocio. Intenta de nuevo.');
    }
    setEliminando(false);
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500 font-medium">Cargando detalle...</div>
    );
  }

  return (
    <div className="space-y-5">
      <button
        onClick={onBack}
        className="text-xs font-bold text-gray-500 flex items-center gap-1 active:opacity-70"
      >
        ← Volver a la lista
      </button>

      {/* Header */}
      <div className={`p-5 rounded-2xl border shadow-sm ${
        suspended ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'
      }`}>
        <div className="flex justify-between items-start gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-gray-900">{negocioId}</h2>
              {suspended && (
                <span className="text-[10px] font-black bg-amber-200 text-amber-800 px-2.5 py-1 rounded-full">
                  ⚠️ SUSPENDIDO
                </span>
              )}
            </div>
            <div className="flex gap-4 mt-3">
              <span className="text-xs font-bold text-gray-500">📅 {reservas.length} citas activas</span>
              <span className="text-xs font-bold text-gray-500">👥 {clientes.length} clientes</span>
              <span className="text-xs font-bold text-gray-500">💰 {formatDinero(totalIngresos)} ingresos</span>
            </div>
          </div>
        </div>
      </div>

      {/* Acciones de administración */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-3">⚙️ Acciones de Administración</h3>
        <div className="flex gap-3">
          <a
            href={`/shop/${negocioId}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl text-xs text-center active:scale-95 transition-transform shadow-sm"
          >
            🔗 Ver Página Pública
          </a>
          <a
            href={`${API_URL}/auth/google/login?negocio_id=${negocioId}&emp_id=`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs text-center active:scale-95 transition-transform"
          >
            🔑 Vincular Calendar
          </a>
          <button
            onClick={handleEliminarNegocio}
            disabled={eliminando}
            className="flex-1 py-3 bg-red-50 text-red-600 font-bold rounded-xl text-xs active:scale-95 transition-transform disabled:opacity-50 border border-red-200"
          >
            {eliminando ? 'Eliminando...' : '🗑️ Eliminar Negocio'}
          </button>
        </div>
      </div>

      {/* Próximas citas */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Próximas Citas ({reservas.length})</h3>
        {reservas.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">No hay citas activas</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {reservas.slice(0, 20).map((r) => {
              const t = r.date_time?.seconds * 1000;
              const fecha = t ? new Date(t).toLocaleDateString('es-CO') : 'N/A';
              const hora = t
                ? new Date(t).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })
                : 'N/A';
              return (
                <div key={r.id} className="flex justify-between items-center py-2 border-b border-gray-50">
                  <div>
                    <p className="text-xs font-bold text-gray-900">{r.client_name}</p>
                    <p className="text-[10px] text-gray-400">{r.service_name}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-bold text-gray-700">{fecha} {hora}</p>
                    <p className="text-[10px] text-gray-400">{formatDinero(r.price)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Servicios y Empleados */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Servicios ({servicios.length})</h3>
          {servicios.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Sin servicios</p>
          ) : (
            <div className="space-y-2">
              {servicios.map((s) => (
                <div key={s.id} className="flex justify-between items-center py-1.5">
                  <p className="text-xs font-bold text-gray-700">{s.name}</p>
                  <p className="text-[10px] text-gray-400">{s.duration_minutes}min</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-3">Equipo ({empleados.length})</h3>
          {empleados.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Sin equipo</p>
          ) : (
            <div className="space-y-2">
              {empleados.map((e) => (
                <div key={e.id} className="flex justify-between items-center py-1.5">
                  <p className="text-xs font-bold text-gray-700">{e.name}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    e.calendar_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {e.calendar_id ? '✓ Cal' : 'Sin Cal'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Clientes */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-3">
          Top Clientes ({clientes.length} total · {totalVisitas} visitas · {formatDinero(totalIngresos)} ingresos)
        </h3>
        {clientes.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Sin clientes registrados</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {[...clientes]
              .sort((a, b) => (b.total_spent || 0) - (a.total_spent || 0))
              .slice(0, 15)
              .map((c) => (
                <div key={c.id} className="flex justify-between items-center py-2 border-b border-gray-50">
                  <div>
                    <p className="text-xs font-bold text-gray-900">{c.client_name}</p>
                    <p className="text-[10px] text-gray-400">{formatearTelefono(c.cliente_phone)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-gray-900">{formatDinero(c.total_spent)}</p>
                    <p className="text-[10px] text-gray-400">{c.visits || 0} visitas</p>
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// SuperAdmin — componente principal
// ──────────────────────────────────────────────────────────────

export default function SuperAdmin() {
  const [user, setUser] = useState(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [negocios, setNegocios] = useState([]);
  const [stats, setStats] = useState({});
  const [selectedNegocio, setSelectedNegocio] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsSuperAdmin(currentUser?.uid === SUPER_ADMIN_UID);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Cargar todos los negocios y sus métricas
  useEffect(() => {
    if (!isSuperAdmin) return;

    const unsubNegocios = onSnapshot(collection(db, 'negocios'), async (snap) => {
      const negs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setNegocios(negs);

      const newStats = {};
      for (const neg of negs) {
        const reservasSnap = await getDocs(
          query(collection(db, 'reservas'), where('negocio_id', '==', neg.id)),
        );
        const clientesSnap = await getDocs(
          query(collection(db, 'clientes'), where('negocio_id', '==', neg.id)),
        );
        const serviciosSnap = await getDocs(collection(db, `negocios/${neg.id}/servicios`));

        const reservas = reservasSnap.docs.map((d) => d.data());
        const clientes = clientesSnap.docs.map((d) => d.data());

        const now = Date.now();
        const citasActivas = reservas.filter((r) => {
          const t = r.date_time?.seconds * 1000;
          return t && t >= now && r.cancelled !== true;
        });

        newStats[neg.id] = {
          reservas: citasActivas.length,
          clientes: clientes.length,
          servicios: serviciosSnap.size,
          ingresos: clientes.reduce((sum, c) => sum + (c.total_spent || 0), 0),
          totalReservas: reservas.length,
        };
      }
      setStats(newStats);
    });

    return unsubNegocios;
  }, [isSuperAdmin]);

  // Suspender / reactivar negocio
  const handleToggleSuspend = useCallback(async (negocioId, currentlySuspended) => {
    const action = currentlySuspended ? 'reactivar' : 'suspender';
    const confirmacion = window.confirm(
      currentlySuspended
        ? `¿Reactivar el negocio "${negocioId}"?\n\nLos clientes podrán volver a agendar citas.`
        : `¿Suspender el negocio "${negocioId}"?\n\nLos clientes NO podrán agendar nuevas citas. Las citas existentes no se ven afectadas.`,
    );
    if (!confirmacion) return;

    try {
      await updateDoc(doc(db, 'negocios', negocioId), {
        suspended: !currentlySuspended,
        suspended_at: currentlySuspended ? null : new Date(),
      });
      alert(`✅ Negocio ${currentlySuspended ? 'reactivado' : 'suspendido'} correctamente.`);
    } catch (err) {
      console.error(`Error al ${action} negocio:`, err);
      alert(`Error al ${action} el negocio. Intenta de nuevo.`);
    }
  }, []);

  // Eliminar negocio completado — volver a la lista
  const handleDeleted = useCallback(() => {
    setSelectedNegocio(null);
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin mb-4"></div>
          <p className="text-sm text-gray-500 font-medium">Cargando panel SaaS...</p>
        </div>
      </div>
    );
  }

  // No autenticado
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <h1 className="text-3xl font-extrabold mb-2 text-gray-900">TurnoBot SaaS</h1>
        <p className="text-sm text-gray-500 mb-6">Panel de Administración</p>
        <button
          onClick={() => signInWithPopup(auth, provider)}
          className="p-4 bg-black text-white font-bold rounded-2xl shadow-md w-full max-w-xs active:scale-95 transition-transform"
        >
          Iniciar Sesión con Google
        </button>
      </div>
    );
  }

  // No es super admin
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="text-5xl mb-4">🔒</div>
        <h1 className="text-2xl font-bold mb-2 text-gray-900">Acceso Restringido</h1>
        <p className="text-sm text-gray-500 mb-6 text-center max-w-sm">
          Solo el administrador del sistema puede acceder a este panel.
        </p>
        <button
          onClick={() => signOut(auth)}
          className="px-6 py-3 bg-gray-200 text-gray-700 font-bold rounded-xl text-sm active:scale-95 transition-transform"
        >
          Cerrar Sesión
        </button>
      </div>
    );
  }

  // Métricas globales
  const totalNegocios = negocios.length;
  const negociosActivos = negocios.filter((n) => n.suspended !== true).length;
  const negociosSuspendidos = negocios.filter((n) => n.suspended === true).length;
  const totalReservas = Object.values(stats).reduce((sum, s) => sum + (s.reservas || 0), 0);
  const totalClientes = Object.values(stats).reduce((sum, s) => sum + (s.clientes || 0), 0);
  const totalIngresos = Object.values(stats).reduce((sum, s) => sum + (s.ingresos || 0), 0);

  const negocioSeleccionado = negocios.find((n) => n.id === selectedNegocio);

  return (
    <div className="max-w-5xl mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased">
      {/* Header */}
      <header className="px-5 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black text-gray-900">TurnoBot SaaS</h1>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              Panel de Administración
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 font-medium">{user.email}</span>
            <button
              onClick={() => signOut(auth)}
              className="text-xs font-bold text-red-500 bg-red-50 px-3 py-1.5 rounded-lg active:scale-95 transition-transform"
            >
              Salir
            </button>
          </div>
        </div>
      </header>

      <main className="p-4 space-y-6">
        {selectedNegocio ? (
          <NegocioDetalle
            negocioId={selectedNegocio}
            negocio={negocioSeleccionado}
            onBack={() => setSelectedNegocio(null)}
            onDeleted={handleDeleted}
          />
        ) : (
          <>
            {/* Métricas Globales */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard icon="🏢" label="Negocios" value={totalNegocios} sub={`${negociosActivos} activos · ${negociosSuspendidos} suspendidos`} />
              <MetricCard icon="📅" label="Citas Activas" value={totalReservas} sub="próximas" />
              <MetricCard icon="👥" label="Clientes" value={totalClientes} sub="en todos los negocios" />
              <MetricCard icon="💰" label="Ingresos Totales" value={formatDinero(totalIngresos)} sub="LTV agregado" />
            </div>

            {/* Lista de Negocios */}
            <div>
              <h2 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wider">
                Negocios Registrados ({totalNegocios})
              </h2>
              {negocios.length === 0 ? (
                <div className="text-center py-12 bg-white rounded-2xl border border-gray-200 border-dashed">
                  <div className="text-4xl mb-3">🏢</div>
                  <p className="text-sm font-medium text-gray-500">No hay negocios registrados aún.</p>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {negocios.map((neg) => (
                    <NegocioCard
                      key={neg.id}
                      negocio={neg}
                      stats={stats[neg.id]}
                      onSelect={setSelectedNegocio}
                      selected={selectedNegocio === neg.id}
                      onToggleSuspend={handleToggleSuspend}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
