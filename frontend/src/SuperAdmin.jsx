import { useState, useEffect, useCallback } from 'react';
import { auth, provider, db } from './firebase';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import {
  collection, doc, updateDoc, onSnapshot, query, where,
} from 'firebase/firestore';
import { formatearTelefono } from './fecha.js';
import { DialogoProvider, useDialogo } from './ConfirmDialog.jsx';

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

function NegocioCard({ negocio, onSelect, selected, onToggleSuspend }) {
  const suspended = negocio.suspended === true;

  return (
    <div
      className={`relative rounded-2xl border-2 transition-all ${
        selected
          ? 'border-black bg-white shadow-lg ring-2 ring-black ring-offset-1'
          : suspended
            ? 'border-amber-200 bg-amber-50 shadow-sm'
            : 'border-gray-200 bg-white hover:border-gray-400 shadow-sm'
      }`}
    >
      <button
        onClick={() => onSelect(negocio.id)}
        aria-label={`Ver detalle de ${negocio.name || negocio.id}`}
        className="w-full text-left p-5 active:scale-[0.99] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black rounded-t-2xl"
      >
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-bold text-base truncate text-gray-900">
                {negocio.name || negocio.id}
              </p>
              {suspended && (
                <span className="text-[10px] font-black bg-amber-600 text-white px-2 py-0.5 rounded-full shrink-0">
                  PAUSADO
                </span>
              )}
              {selected && (
                <span className="text-[10px] font-black bg-black text-white px-2 py-0.5 rounded-full shrink-0">
                  VIENDO
                </span>
              )}
            </div>
            <p className="text-xs mt-1 font-medium text-gray-400">
              /{negocio.id}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-lg font-black text-gray-900">
              {negocio.stats_citas_activas || 0}
            </p>
            <p className="text-[11px] font-bold uppercase text-gray-500">
              próximas
            </p>
          </div>
        </div>
        <div className="flex gap-4 mt-3 pt-3 border-t border-gray-100">
          <span className="text-xs font-bold text-gray-500">
            👥 {negocio.stats_total_clientes || 0} clientes
          </span>
          <span className="text-xs font-bold text-gray-500">
            💰 {formatDinero(negocio.stats_ingresos_totales || 0)}
          </span>
          {negocio.created_at?.seconds && (
            <span className="text-[11px] font-medium ml-auto text-gray-400">
              Desde {new Date(negocio.created_at.seconds * 1000).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>
      </button>

      {/* Botones de acción (fuera del área clickeable de selección) */}
      <div className="flex border-t border-gray-100">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSuspend(negocio.id, suspended); }}
          title={suspended ? 'Los clientes podrán volver a reservar' : 'Los clientes no podrán reservar; las citas existentes se conservan'}
          className={`flex-1 min-h-[44px] py-2.5 text-xs font-bold active:scale-95 transition-transform rounded-bl-2xl ${
            suspended
              ? 'text-green-700 hover:bg-green-50'
              : 'text-amber-700 hover:bg-amber-50'
          }`}
        >
          {suspended ? '✓ Reanudar reservas' : '⏸ Pausar reservas'}
        </button>
        <div className="w-px bg-gray-100" />
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(negocio.id); }}
          className="flex-1 min-h-[44px] py-2.5 text-xs font-bold active:scale-95 transition-transform text-blue-700 hover:bg-blue-50 rounded-br-2xl"
        >
          Ver detalle →
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// NegocioDetalle — con eliminación de negocio
// ──────────────────────────────────────────────────────────────

function NegocioDetalle({ negocioId, negocio, onBack, onDeleted }) {
  const { confirmar, avisar, pedirTexto } = useDialogo();
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
    // Primera confirmación: diálogo propio con la lista de lo que se borra.
    const ok = await confirmar({
      titulo: `¿Borrar "${negocioId}" del todo?`,
      detalle: 'Se eliminará el negocio, sus servicios, su equipo, sus citas y sus clientes.',
      consecuencia: 'No se puede deshacer.',
      confirmarTexto: 'Sí, borrar todo',
      variante: 'peligro',
      icono: '🗑️',
    });
    if (!ok) return;

    // Segunda confirmación: escribir el ID exacto (freno a clics accidentales).
    const idIngresado = await pedirTexto({
      titulo: 'Confirmación final',
      detalle: `Para borrar "${negocioId}" y TODA su data, escribe el ID exacto:`,
      etiqueta: `Escribe: ${negocioId}`,
      placeholder: negocioId,
      verificacion: negocioId,
      confirmarTexto: 'Borrar definitivamente',
    });
    if (idIngresado === null) return; // Canceló
    if (idIngresado !== negocioId) {
      await avisar('El ID no coincide. Operación cancelada.', 'error');
      return;
    }

    setEliminando(true);
    try {
      // Usamos el token del usuario actual (que sabemos que es el SuperAdmin)
      const token = await auth.currentUser.getIdToken();

      const res = await fetch(`${API_URL}/api/v1/b/${negocioId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('No autorizado o error del servidor');
      }

      await avisar(`Negocio "${negocioId}" borrado correctamente.`, 'exito');
      onDeleted(); // Dispara la actualización de la lista de negocios en SuperAdmin
    } catch (err) {
      console.error('Error eliminando negocio:', err);
      await avisar('No se pudo borrar el negocio. Intenta de nuevo.', 'error');
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
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-black text-gray-900">{negocio?.name || negocioId}</h2>
              {suspended && (
                <span className="text-[10px] font-black bg-amber-600 text-white px-2.5 py-1 rounded-full">
                  ⚠️ PAUSADO
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 font-medium mt-0.5">/{negocioId}</p>
            {suspended && (
              <p className="text-xs text-amber-700 font-semibold mt-2">
                Los clientes ven “No disponible” y no pueden reservar. Las citas ya agendadas se conservan.
              </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              <span className="text-xs font-bold text-gray-600">📅 {reservas.length} citas próximas</span>
              <span className="text-xs font-bold text-gray-600">👥 {clientes.length} clientes</span>
              <span className="text-xs font-bold text-gray-600">💰 {formatDinero(totalIngresos)} sumados</span>
            </div>
          </div>
        </div>
      </div>

      {/* Acciones de administración */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-1">Qué quieres hacer</h3>
        <p className="text-[11px] text-gray-500 font-medium mb-3">Ver su página como un cliente o borrarlo del todo (con doble confirmación).</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <a
            href={`/shop/${negocioId}`}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-h-[48px] py-3 bg-blue-600 text-white font-bold rounded-xl text-xs text-center active:scale-95 transition-transform shadow-sm flex items-center justify-center"
          >
            🔗 Ver su página de reservas
          </a>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/shop/${negocioId}`);
                await avisar('Enlace copiado.', 'exito');
              } catch {
                await avisar(`Copia este enlace:\n\n${window.location.origin}/shop/${negocioId}`, 'info');
              }
            }}
            className="flex-1 min-h-[48px] py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs text-center active:scale-95 transition-transform"
          >
            📋 Copiar enlace
          </button>
          <button
            onClick={handleEliminarNegocio}
            disabled={eliminando}
            title="Borra el negocio, sus servicios, su equipo, sus citas y sus clientes. No se puede deshacer."
            className="flex-1 min-h-[48px] py-3 bg-red-50 text-red-700 font-bold rounded-xl text-xs active:scale-95 transition-transform disabled:opacity-50 border border-red-200"
          >
            {eliminando ? 'Borrando...' : '🗑️ Borrar negocio'}
          </button>
        </div>
      </div>

      {/* Datos de contacto y antigüedad */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-1 border-b border-gray-100 pb-2">
          📋 Datos del negocio y su dueño
        </h3>
        <p className="text-[11px] text-gray-500 font-medium mb-3">Información interna para dar soporte. El código del dueño sirve para ubicar su cuenta.</p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600">
          <div>
            <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Código del dueño</dt>
            <dd className="mt-1 flex items-center gap-2">
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[11px] font-mono truncate">{negocio?.owner_uid || 'N/A'}</code>
              {negocio?.owner_uid && (
                <button
                  onClick={() => navigator.clipboard.writeText(negocio.owner_uid)}
                  className="min-h-[36px] px-2 text-[11px] font-bold text-gray-600 bg-gray-100 rounded-lg shrink-0"
                >
                  Copiar
                </button>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">WhatsApp del local</dt>
            <dd className="mt-1 font-semibold text-gray-800">{negocio?.whatsapp ? formatearTelefono(negocio.whatsapp) : 'Sin configurar'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Teléfono</dt>
            <dd className="mt-1 font-semibold text-gray-800">{negocio?.telefono || 'Sin configurar'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Dirección</dt>
            <dd className="mt-1 font-semibold text-gray-800">{negocio?.direccion || 'Sin configurar'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Hora del negocio</dt>
            <dd className="mt-1 font-semibold text-gray-800">{negocio?.timezone || 'America/Bogota'}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Registrado el</dt>
            <dd className="mt-1 font-semibold text-gray-800">
              {negocio?.created_at?.seconds
                ? new Date(negocio.created_at.seconds * 1000).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' })
                : 'Sin fecha'}
            </dd>
          </div>
        </dl>
      </div>

      {/* Próximas citas */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900 mb-1">Próximas citas ({reservas.length})</h3>
        <p className="text-[11px] text-gray-500 font-medium mb-3">Solo futuras y no canceladas, en la hora del negocio.</p>
        {reservas.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">Sin citas próximas</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {reservas.slice(0, 20).map((r) => {
              const t = r.date_time?.seconds * 1000;
              const tz = negocio?.timezone || 'America/Bogota';
              const fecha = t ? new Date(t).toLocaleDateString('es-CO', { timeZone: tz }) : 'Sin fecha';
              const hora = t
                ? new Date(t).toLocaleTimeString('es-CO', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
                : '';
              return (
                <div key={r.id} className="flex justify-between items-center gap-2 py-2 border-b border-gray-50">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{r.client_name}</p>
                    <p className="text-[11px] text-gray-500">{r.service_name}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-gray-700">{fecha} {hora}</p>
                    <p className="text-[11px] text-gray-500">{formatDinero(r.price)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Servicios y Equipo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Servicios ({servicios.length})</h3>
          <p className="text-[11px] text-gray-500 font-medium mb-3">Lo que sus clientes pueden reservar.</p>
          {servicios.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Sin servicios todavía</p>
          ) : (
            <div className="space-y-2">
              {servicios.map((s) => (
                <div key={s.id} className="flex justify-between items-center gap-2 py-1.5">
                  <p className="text-xs font-bold text-gray-700 truncate">{s.name}</p>
                  <p className="text-[11px] text-gray-500 shrink-0">{s.duration_minutes} min</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <h3 className="text-sm font-bold text-gray-900 mb-1">Equipo ({empleados.length})</h3>
          <p className="text-[11px] text-gray-500 font-medium mb-3">Quienes atienden, y si tienen Google Calendar.</p>
          {empleados.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">Sin equipo todavía</p>
          ) : (
            <div className="space-y-2">
              {empleados.map((e) => (
                <div key={e.id} className="flex justify-between items-center gap-2 py-1.5">
                  <p className="text-xs font-bold text-gray-700 truncate">{e.name}</p>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                    e.calendar_id ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {e.calendar_id ? '✓ Google' : 'Sin Google'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top Clientes */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-sm font-bold text-gray-900">
          Mejores clientes
        </h3>
        <p className="text-[11px] text-gray-500 font-medium mt-0.5 mb-3">
          {clientes.length} en total · {totalVisitas} visitas · {formatDinero(totalIngresos)} sumados
        </p>
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
  return (
    <DialogoProvider>
      <SuperAdminPanel />
    </DialogoProvider>
  );
}

function SuperAdminPanel() {
  const { confirmar, avisar } = useDialogo();
  const [user, setUser] = useState(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [negocios, setNegocios] = useState([]);
  const [selectedNegocio, setSelectedNegocio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsSuperAdmin(currentUser?.uid === SUPER_ADMIN_UID);
      setLoading(false);
    });
    return unsub;
  }, []);

  // Cargar todos los negocios y sus métricas embebidas (Zero Extra Queries:
  // el backend mantiene stats_* en cada doc, una sola lectura por negocio)
  useEffect(() => {
    if (!isSuperAdmin) return;
    const unsubNegocios = onSnapshot(collection(db, 'negocios'), (snap) => {
      const negs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setNegocios(negs);
    });
    return unsubNegocios;
  }, [isSuperAdmin]);

  // Suspender / reactivar negocio
  const handleToggleSuspend = useCallback(async (negocioId, currentlySuspended) => {
    const action = currentlySuspended ? 'reanudar' : 'pausar';
    const ok = await confirmar(
      currentlySuspended
        ? {
            titulo: `¿Reanudar las reservas de "${negocioId}"?`,
            detalle: 'Los clientes podrán volver a agendar citas.',
            confirmarTexto: 'Sí, reanudar',
            variante: 'info',
          }
        : {
            titulo: `¿Pausar las reservas de "${negocioId}"?`,
            detalle: 'Los clientes verán “No disponible” y no podrán agendar. Las citas ya agendadas se conservan.',
            confirmarTexto: 'Sí, pausar',
            variante: 'peligro',
          },
    );
    if (!ok) return;

    try {
      await updateDoc(doc(db, 'negocios', negocioId), {
        suspended: !currentlySuspended,
        suspended_at: currentlySuspended ? null : new Date(),
      });
      // Limpiar la caché del backend (el banner de suspendido se sirve vía API).
      try {
        const token = await auth.currentUser.getIdToken();
        await fetch(`${API_URL}/api/v1/b/${negocioId}/cache/invalidate`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        console.error('No se pudo invalidar caché:', err);
      }
      await avisar(`Reservas ${currentlySuspended ? 'reanudadas' : 'pausadas'} correctamente.`, 'exito');
    } catch (err) {
      console.error(`Error al ${action} negocio:`, err);
      await avisar(`No se pudo ${action} el negocio. Intenta de nuevo.`, 'error');
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
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <p className="text-xs font-black tracking-widest text-gray-400 uppercase mb-2">TurnoBot</p>
          <h1 className="text-3xl font-extrabold text-gray-900">Negocios TurnoBot</h1>
          <p className="mt-2 text-sm text-gray-600">Solo tú puedes entrar aquí: ver, pausar o borrar negocios.</p>
        </div>
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-6 shadow rounded-2xl border border-gray-100">
            <button
              onClick={() => signInWithPopup(auth, provider)}
              className="w-full p-4 bg-black text-white font-bold rounded-xl shadow-md active:scale-95 transition-transform text-sm"
            >
              Iniciar Sesión con Google
            </button>
            <p className="mt-4 text-center text-xs text-gray-400">Solo el super administrador puede acceder.</p>
          </div>
        </div>
      </div>
    );
  }

  // No es super admin
  if (!isSuperAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
        <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
          <p className="text-xs font-black tracking-widest text-gray-400 uppercase mb-2">TurnoBot</p>
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-2xl font-extrabold text-gray-900">Acceso Restringido</h1>
          <p className="mt-2 text-sm text-gray-600">Solo el administrador del sistema puede acceder a este panel.</p>
        </div>
        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-6 shadow rounded-2xl border border-gray-100">
            <button
              onClick={() => signOut(auth)}
              className="w-full px-6 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-sm active:scale-95 transition-transform"
            >
              Cerrar Sesión
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Métricas globales: cálculos instantáneos en memoria sobre los
  // contadores embebidos (sin queries adicionales)
  const totalNegocios = negocios.length;
  const negociosActivos = negocios.filter((n) => n.suspended !== true).length;
  const negociosSuspendidos = negocios.filter((n) => n.suspended === true).length;

  const totalReservas = negocios.reduce((sum, n) => sum + (n.stats_citas_activas || 0), 0);
  const totalClientes = negocios.reduce((sum, n) => sum + (n.stats_total_clientes || 0), 0);
  const totalIngresos = negocios.reduce((sum, n) => sum + (n.stats_ingresos_totales || 0), 0);

  const negocioSeleccionado = negocios.find((n) => n.id === selectedNegocio);

  return (
    <div className="max-w-5xl mx-auto bg-gray-50 min-h-screen pb-24 font-sans antialiased">
      {/* Header */}
      <header className="px-5 py-4 bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-xl font-black text-gray-900">Negocios TurnoBot</h1>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">
              Todos los negocios en un solo lugar
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-500 font-medium max-w-[140px] truncate" title={user.email}>{user.email}</span>
            <button
              onClick={() => signOut(auth)}
              className="min-h-[44px] text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg active:scale-95 transition-transform"
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
              <MetricCard icon="🏢" label="Negocios" value={totalNegocios} sub={`${negociosActivos} recibiendo reservas · ${negociosSuspendidos} pausados`} />
              <MetricCard icon="📅" label="Citas próximas" value={totalReservas} sub="futuras y no canceladas" />
              <MetricCard icon="👥" label="Clientes" value={totalClientes} sub="sumando todos los negocios" />
              <MetricCard icon="💰" label="Ingresos sumados" value={formatDinero(totalIngresos)} sub="de todos los negocios" />
            </div>

            {/* Lista de Negocios */}
            <div>
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
                <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                  Negocios ({totalNegocios})
                </h2>
                <div className="relative w-full sm:w-64">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <span className="text-gray-400" aria-hidden="true">🔍</span>
                  </div>
                  <label className="sr-only" htmlFor="buscar-negocio">Buscar negocio por nombre o dirección</label>
                  <input
                    id="buscar-negocio"
                    type="search"
                    placeholder="Buscar por nombre o dirección…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="block w-full min-h-[44px] pl-9 pr-3 py-2 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-black focus-visible:ring-2 focus-visible:ring-black"
                  />
                </div>
              </div>
              {(() => {
                const filtered = negocios.filter(n =>
                  n.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  n.id.toLowerCase().includes(searchTerm.toLowerCase())
                );
                if (filtered.length === 0) {
                  return (
                    <div className="text-center py-12 bg-white rounded-2xl border border-gray-200 border-dashed">
                      <div className="text-4xl mb-3">{searchTerm ? '🔍' : '🏢'}</div>
                      <p className="text-sm font-medium text-gray-500">
                        {searchTerm ? 'No se encontraron negocios.' : 'No hay negocios registrados aún.'}
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="grid gap-3 md:grid-cols-2">
                    {filtered.map((neg) => (
                      <NegocioCard
                        key={neg.id}
                        negocio={neg}
                        onSelect={setSelectedNegocio}
                        selected={selectedNegocio === neg.id}
                        onToggleSuspend={handleToggleSuspend}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
