import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getToken } from 'firebase/messaging';
import { messaging } from './firebase.js';
import MisCitas from './MisCitas.jsx';
import { fechaHoyEnZona, sumarDias, formatearFechaLarga, formatearTelefono, descargarICS, generarEnlaceGoogleCalendar } from './fecha.js';
import { IconoCalendario, IconoLista, IconoPin } from './Iconos.jsx';
import { temaMarcaProps, textoSobreMarca, inicialMarca, fondoMarca, enlaceRed } from './marca.js';

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

// "Cualquiera disponible": valor especial de empleadoId que une la
// disponibilidad de todos los profesionales que ofrecen el servicio.
// El backend sigue exigiendo un emp_id concreto, así que al confirmar se
// resuelve a un profesional real (el primero con ese slot libre).
const EMP_ANY = '__any__';
const MAX_DIAS_HUECO = 14;

const claveClienteGuardado = (slug) => `turnobot-cliente-${slug}`;

const leerClienteGuardado = (slug) => {
  try {
    const raw = localStorage.getItem(claveClienteGuardado(slug));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d !== 'object') return null;
    return { nombre: d.nombre || '', telefono: d.telefono || '' };
  } catch {
    return null;
  }
};

const fetchSlotsRecurso = async (slug, recursoId, servicioId, fecha, cupos = 1) => {
  const res = await fetch(`${API_URL}/api/v1/b/${slug}/slots?recurso_id=${recursoId}&servicio_id=${servicioId}&fecha=${fecha}&cupos=${cupos}`);
  if (!res.ok) throw new Error('Error del servidor');
  const data = await res.json();
  // El backend responde objeto {slots, libres_por_hora} (o array en viejos).
  if (Array.isArray(data)) return { slots: data, libres: {} };
  return { slots: Array.isArray(data?.slots) ? data.slots : [], libres: data?.libres_por_hora || {} };
};

const fetchSlotsEmpleado = async (slug, empId, servicioId, fecha) => {
  const res = await fetch(`${API_URL}/api/v1/b/${slug}/slots?emp_id=${empId}&servicio_id=${servicioId}&fecha=${fecha}`);
  if (!res.ok) throw new Error('Error del servidor');
  const data = await res.json();
  // Un profesional devuelve array plano; el modo "any" del backend nuevo
  // devuelve objeto {slots, asignado_por_hora}. Se normaliza a un solo tipo.
  // esObjeto distingue un backend nuevo de uno viejo (el viejo responde
  // array incluso a emp_id=any, con datos mock que NO se deben usar).
  if (Array.isArray(data)) return { slots: data, porHora: {}, esObjeto: false };
  return { slots: Array.isArray(data?.slots) ? data.slots : [], porHora: data?.asignado_por_hora || {}, esObjeto: true };
};

// Fan-out para backends viejos (sin emp_id=any): consulta cada profesional.
// Se usa solo si el backend responde con array plano al pedir "any".
const fetchSlotsAnyLegacy = async (slug, empleados, servicioId, fecha) => {
  const resultados = await Promise.all(
    empleados.map(async (e) => {
      try {
        const { slots } = await fetchSlotsEmpleado(slug, e.id, servicioId, fecha);
        return { empId: e.id, slots };
      } catch {
        return { empId: e.id, slots: [] };
      }
    })
  );
  const porHora = {};
  for (const r of resultados) {
    for (const h of r.slots) {
      if (!(h in porHora)) porHora[h] = r.empId;
    }
  }
  return { slots: Object.keys(porHora).sort(), porHora };
};

// Empleados que ofrecen un servicio (para no resetear de más al cambiar).
const empleadosParaServicio = (negocio, servicioId) => (negocio?.empleados || [])
  .filter((e) => !servicioId || !e.servicios_ids || e.servicios_ids.includes(servicioId))
  .map((e) => e.id);

// Duración en lenguaje natural: 45 -> "unos 45 minutos".
const duracionAmable = (min) => {
  const n = Number(min || 0);
  if (!n) return 'Duración a convenir';
  if (n < 60) return `unos ${n} minutos`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `unas ${h} h ${m} min` : h === 1 ? '1 hora' : `unas ${h} horas`;
};

// Pasos del flujo (divulgación progresiva: el usuario siempre sabe dónde va).
const PASOS = [
  { n: 1, etiqueta: 'Servicio' },
  { n: 2, etiqueta: 'Profesional' },
  { n: 3, etiqueta: 'Día' },
  { n: 4, etiqueta: 'Hora' },
  { n: 5, etiqueta: 'Confirmar' },
];

// Modo "reservar espacio" (canchas, boxes): sin servicio ni profesional.
// Flujo propio: Espacio → Día → Hora → Confirmar.
const PASOS_ESPACIO = [
  { n: 1, etiqueta: 'Espacio' },
  { n: 2, etiqueta: 'Día' },
  { n: 3, etiqueta: 'Hora' },
  { n: 4, etiqueta: 'Confirmar' },
  { n: 5, etiqueta: 'Listo' },
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
  // Guard contra doble envío: un doble clic rápido puede disparar dos submits
  // antes de que React re-renderice el botón deshabilitado. Sin esto, el
  // backend crearía dos reservas (y dos pushes) para la misma cita.
  const enviandoRef = useRef(false);
  const [negocio, setNegocio] = useState(null);
  const [slots, setSlots] = useState([]);
  // En modo "cualquiera": hora -> id del profesional asignado (primero libre).
  const [slotsPorHora, setSlotsPorHora] = useState({});
  // En modo espacio: hora -> cupos libres (para "quedan N").
  const [libresPorHora, setLibresPorHora] = useState({});
  const [error, setError] = useState('');
  const [citaId, setCitaId] = useState('');
  // Primer hueco disponible (búsqueda en próximos días) y tira semanal.
  const [buscandoHueco, setBuscandoHueco] = useState(false);
  const [primerHueco, setPrimerHueco] = useState(null);
  const [semana, setSemana] = useState([]);
  const [cargandoSemana, setCargandoSemana] = useState(false);
  const semanaCacheRef = useRef({});
  // Ref al fetcher actual (evita closures viejos en los onClick de pasos).
  const fetchHorariosRef = useRef(null);
  // Cliente recurrente: datos guardados en este dispositivo por negocio.
  const [clienteGuardado, setClienteGuardado] = useState(null);
  const [recordarDatos, setRecordarDatos] = useState(true);
  // Modo de reserva: 'servicio' (clásico) o 'espacio' (canchas/boxes, sin
  // servicio ni profesional). Sin recursos en el negocio siempre es servicio.
  const [modo, setModo] = useState(null);
  // Búsqueda de servicios (ley de Hick: filtra cuando hay muchos).
  const [busquedaServicio, setBusquedaServicio] = useState('');
  // Estado del push post-agendamiento: 'idle' | 'loading' | 'success' | 'error'
  const [pushStatus, setPushStatus] = useState('idle');
  const [pushError, setPushError] = useState('');
  const [booking, setBooking] = useState({
    servicioId: '',
    empleadoId: '',
    recursoId: '',
    cupos: 1,
    participantes: [],
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
    setClienteGuardado(leerClienteGuardado(slug));
  }, [slug]);

  // Actualizar <meta name="theme-color"> dinámicamente según la marca.
  useEffect(() => {
    const color = negocio?.marca?.color;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', color || '#000000');
    return () => { if (meta) meta.setAttribute('content', '#000000'); };
  }, [negocio?.marca?.color]);

  // Pre-rellenar nombre/teléfono del cliente recurrente (sin borrar lo que
  // ya esté escribiendo). Solo rellena campos vacíos.
  useEffect(() => {
    if (!clienteGuardado) return;
    setBooking((prev) => ({
      ...prev,
      clienteNombre: prev.clienteNombre || clienteGuardado.nombre || '',
      clienteTelefono: prev.clienteTelefono || clienteGuardado.telefono || '',
    }));
  }, [clienteGuardado]);

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
  // Profesionales que ofrecen el servicio elegido (base para modo "any").
  const empleadosElegibles = (negocio?.empleados || []).filter(
    (e) => !booking.servicioId || !e.servicios_ids || e.servicios_ids.includes(booking.servicioId)
  );
  const esModoAny = booking.empleadoId === EMP_ANY;
  const empleadoElegido = esModoAny
    ? (booking.hora && slotsPorHora[booking.hora]
        ? negocio?.empleados?.find(e => e.id === slotsPorHora[booking.hora])
        : null)
    : negocio?.empleados?.find(e => e.id === booking.empleadoId);

  const hayRecursos = (negocio?.recursos || []).length > 0;
  const recursoElegido = negocio?.recursos?.find(r => r.id === booking.recursoId);
  // Clase predefinida: servicio y profesional atados al espacio (el backend
  // los hereda al reservar: nombre, duración y precio reales).
  const recursoServAtado = recursoElegido?.servicio_id
    ? negocio?.servicios?.find(s => s.id === recursoElegido.servicio_id) : null;
  const recursoEmpAtado = recursoElegido?.emp_id
    ? negocio?.empleados?.find(e => e.id === recursoElegido.emp_id) : null;
  // En modo espacio no hay servicio: el nombre se deriva del espacio.
  const servicioNombre = servicioElegido?.name || (recursoElegido ? `Reserva de ${recursoElegido.name}` : '');
  const pasos = modo === 'espacio' ? PASOS_ESPACIO : PASOS;
  const modoEspacio = modo === 'espacio';
  // Listo para ver calendario: espacio con su espacio, o servicio con
  // profesional. Caminos separados: el servicio nunca pide espacio.
  const listoParaCalendario = modoEspacio
    ? !!booking.recursoId
    : !!booking.servicioId && !!booking.empleadoId;

  const elegirModo = (m) => {
    setModo(m);
    setBooking((prev) => ({ ...prev, servicioId: '', empleadoId: '', recursoId: '', cupos: 1, participantes: [], fecha: '', hora: '' }));
    setSlots([]);
    setSlotsPorHora({});
    setLibresPorHora({});
    setPrimerHueco(null);
    setError('');
    setStep(1);
  };

  const fetchHorarios = async (fecha, opts = {}) => {
    // Camino espacio: solo espacio. Camino servicio: servicio + profesional.
    if (modoEspacio ? !booking.recursoId : (!booking.servicioId || !booking.empleadoId)) return;
    setLoading(true);
    if (!opts.preserveError) setError('');
    // No se resetea la hora aquí: se conserva si sigue libre en la nueva
    // rejilla (ver abajo). Solo se actualiza la fecha.
    setBooking((prev) => ({ ...prev, fecha }));
    try {
      let unidos = [];
      let porHora = {};
      setLibresPorHora({});
      if (booking.recursoId) {
        // Espacio elegido: su disponibilidad manda. Si además hay un
        // profesional concreto, se intersecta (ambos deben estar libres).
        const cupos = Math.max(1, Number(booking.cupos) || 1);
        const rr = await fetchSlotsRecurso(slug, booking.recursoId, booking.servicioId, fecha, cupos);
        unidos = rr.slots;
        setLibresPorHora(rr.libres);
        if (booking.empleadoId && booking.empleadoId !== EMP_ANY) {
          const r = await fetchSlotsEmpleado(slug, booking.empleadoId, booking.servicioId, fecha);
          const setEmp = new Set(r.slots);
          unidos = unidos.filter((h) => setEmp.has(h));
        }
        // En modo "any" + espacio no se asigna profesional (el local asigna).
        porHora = {};
      } else if (booking.empleadoId === EMP_ANY) {
        // Una sola llamada al backend nuevo (objeto); si responde array plano
        // es un backend viejo y se hace fan-out por profesional (fallback).
        // OJO: el array del backend viejo con emp_id=any puede ser mock:
        // se descarta y se consulta cada profesional de verdad.
        const r = await fetchSlotsEmpleado(slug, 'any', booking.servicioId, fecha);
        if (r.esObjeto) {
          unidos = r.slots;
          porHora = r.porHora;
        } else {
          const leg = await fetchSlotsAnyLegacy(slug, empleadosElegibles, booking.servicioId, fecha);
          unidos = leg.slots;
          porHora = leg.porHora;
        }
      } else {
        const r = await fetchSlotsEmpleado(slug, booking.empleadoId, booking.servicioId, fecha);
        unidos = r.slots;
      }
      setSlots(unidos);
      setSlotsPorHora(porHora);
      // Preservar la hora elegida si sigue disponible; si no, limpiarla
      // pero mantener la fecha (antes se perdía todo).
      setBooking((prev) => ({
        ...prev,
        fecha,
        hora: prev.hora && unidos.includes(prev.hora) ? prev.hora : '',
      }));
      setStep((prevStep) => Math.max(prevStep, 3));
    } catch (err) {
      setError("Error buscando horarios");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchHorariosRef.current = fetchHorarios;
  });

  // Primer hueco: pregunta al backend (una sola llamada); si el backend es
  // viejo (404), recorre los próximos días día por día como fallback.
  const buscarPrimerHueco = async () => {
    if (modoEspacio ? (!booking.recursoId || !negocio) : (!booking.servicioId || !booking.empleadoId || !negocio)) return;
    setBuscandoHueco(true);
    setPrimerHueco(null);
    setError('');
    const aplicarHueco = async (h) => {
      setPrimerHueco(h);
      // Saltar directo a ese día/hora sin perder servicio/profesional.
      // En modo "any" se conserva ANY; la asignación se resuelve al confirmar.
      setBooking((prev) => ({ ...prev, fecha: h.fecha, hora: '' }));
      await fetchHorarios(h.fecha, { preserveError: true });
      setBooking((prev) => ({ ...prev, fecha: h.fecha, hora: h.hora }));
      setStep(4);
    };
    try {
      const empParam = booking.empleadoId === EMP_ANY ? 'any' : booking.empleadoId;
      const recParam = booking.recursoId ? `&recurso_id=${booking.recursoId}` : '';
      const cupParam = booking.recursoId ? `&cupos=${Math.max(1, Number(booking.cupos) || 1)}` : '';
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/slots/primer-hueco?servicio_id=${booking.servicioId}&emp_id=${empParam}${recParam}${cupParam}&dias=${MAX_DIAS_HUECO}`);
      if (res.ok) {
        const h = await res.json();
        if (h?.fecha && h?.hora) {
          await aplicarHueco({ fecha: h.fecha, hora: h.hora, empId: h.emp_id, empName: h.emp_name });
          return;
        }
      } else if (res.status !== 404) {
        const data = await res.json().catch(() => null);
        if (data?.message) {
          setError(data.message);
          return;
        }
      }
      // Fallback (backend sin /primer-hueco): escaneo día por día.
      const hoyStr = fechaHoyEnZona(negocio?.timezone);
      if (booking.recursoId) {
        const cupos = Math.max(1, Number(booking.cupos) || 1);
        for (let d = 0; d < MAX_DIAS_HUECO; d++) {
          const fecha = sumarDias(hoyStr, d);
          try {
            const rr = await fetchSlotsRecurso(slug, booking.recursoId, booking.servicioId, fecha, cupos);
            if (rr.slots.length > 0) {
              await aplicarHueco({ fecha, hora: rr.slots[0] });
              return;
            }
          } catch {
            // sigue al siguiente día
          }
        }
        setError(`No encontramos espacios libres en los próximos ${MAX_DIAS_HUECO} días. Prueba con otro espacio o escríbenos.`);
        return;
      }
      const objetivos = booking.empleadoId === EMP_ANY ? empleadosElegibles : empleadosElegibles.filter(e => e.id === booking.empleadoId);
      if (objetivos.length === 0) {
        setError("No hay profesionales disponibles para este servicio en este momento.");
        return;
      }
      for (let d = 0; d < MAX_DIAS_HUECO; d++) {
        const fecha = sumarDias(hoyStr, d);
        const resultados = await Promise.all(
          objetivos.map(async (e) => {
            const cacheKey = `${booking.servicioId}|${e.id}|${fecha}`;
            if (semanaCacheRef.current[cacheKey] !== undefined) {
              return { empId: e.id, empName: e.name, slots: semanaCacheRef.current[cacheKey] };
            }
            try {
              const r = await fetchSlotsEmpleado(slug, e.id, booking.servicioId, fecha);
              semanaCacheRef.current[cacheKey] = r.slots;
              return { empId: e.id, empName: e.name, slots: r.slots };
            } catch {
              return { empId: e.id, empName: e.name, slots: [] };
            }
          })
        );
        const ordenados = resultados
          .flatMap(r => r.slots.map(h => ({ fecha, hora: h, empId: r.empId, empName: r.empName })))
          .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.hora < b.hora ? -1 : 1));
        if (ordenados.length > 0) {
          await aplicarHueco(ordenados[0]);
          return;
        }
      }
      setError(`No encontramos espacios libres en los próximos ${MAX_DIAS_HUECO} días. Prueba con otro profesional o escríbenos.`);
    } catch {
      setError("Error buscando el primer hueco disponible.");
    } finally {
      setBuscandoHueco(false);
    }
  };

  // Tira semanal comparativa: para la semana que contiene la fecha elegida
  // (o hoy), muestra el conteo de slots por día. Con espacio elegido cuenta
  // el espacio; en modo "any" suma todos los profesionales; si no, el elegido.
  useEffect(() => {
    const cargarSemana = async () => {
      if (!negocio || (modoEspacio ? !booking.recursoId : (!booking.servicioId || !booking.empleadoId))) {
        setSemana([]);
        return;
      }
      setCargandoSemana(true);
      try {
        const base = booking.fecha || fechaHoyEnZona(negocio?.timezone);
        const [by, bm, bd] = base.split('-').map(Number);
        const ref = new Date(by, bm - 1, bd);
        // Lunes como inicio de semana.
        const dow = (ref.getDay() + 6) % 7;
        const lunes = sumarDias(base, -dow);
        const objetivos = booking.empleadoId === EMP_ANY ? empleadosElegibles : empleadosElegibles.filter(e => e.id === booking.empleadoId);
        const dias = Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
        const hoyStr = fechaHoyEnZona(negocio?.timezone);
        const filas = await Promise.all(
          dias.map(async (fecha) => {
            if (fecha < hoyStr) return { fecha, total: -1 };
            // Espacio elegido: cuenta el espacio (una sola llamada por día).
            if (booking.recursoId) {
              const cacheKey = `${booking.servicioId}|rec:${booking.recursoId}|cup${booking.cupos}|${fecha}`;
              let s = semanaCacheRef.current[cacheKey];
              if (s === undefined) {
                try {
                  const rr = await fetchSlotsRecurso(slug, booking.recursoId, booking.servicioId, fecha, Math.max(1, Number(booking.cupos) || 1));
                  s = rr.slots;
                } catch {
                  s = [];
                }
                semanaCacheRef.current[cacheKey] = s;
              }
              return { fecha, total: s.length };
            }
            // Modo "any": una sola llamada (objeto del backend nuevo). Si el
            // backend es viejo (array), fan-out por profesional.
            if (booking.empleadoId === EMP_ANY) {
              try {
                const r = await fetchSlotsEmpleado(slug, 'any', booking.servicioId, fecha);
                if (r.esObjeto) return { fecha, total: r.slots.length };
              } catch {
                // cae al fan-out de abajo
              }
            }
            let total = 0;
            await Promise.all(
              objetivos.map(async (e) => {
                const cacheKey = `${booking.servicioId}|${e.id}|${fecha}`;
                let s = semanaCacheRef.current[cacheKey];
                if (s === undefined) {
                  try {
                    const r = await fetchSlotsEmpleado(slug, e.id, booking.servicioId, fecha);
                    s = r.slots;
                  } catch {
                    s = [];
                  }
                  semanaCacheRef.current[cacheKey] = s;
                }
                total += s.length;
              })
            );
            return { fecha, total };
          })
        );
        setSemana(filas);
      } catch {
        // La tira es informativa: si falla, no bloquea la reserva.
      } finally {
        setCargandoSemana(false);
      }
    };
    cargarSemana();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [negocio?.timezone, modo, booking.servicioId, booking.empleadoId, booking.recursoId, booking.cupos, booking.fecha]);

  const confirmarCita = async (e) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setLoading(true);
    setError('');

    // En modo "cualquiera" el backend exige un profesional concreto: se
    // resuelve a quien tenía ese slot libre (si cambió, al primero elegible
    // y el backend revalida con 409). Con espacio y sin profesional, el local
    // asigna (empleado vacío, permitido por el backend).
    let empleadoFinal = booking.empleadoId;
    if (booking.empleadoId === EMP_ANY) {
      empleadoFinal = booking.recursoId ? '' : (slotsPorHora[booking.hora] || empleadosElegibles[0]?.id || '');
    }
    if (!empleadoFinal && !booking.recursoId) {
      setError("Elige un profesional para confirmar.");
      enviandoRef.current = false;
      setLoading(false);
      return;
    }

    const payload = {
      ...booking,
      empleadoId: empleadoFinal,
      recursoId: booking.recursoId || '',
      cupos: booking.recursoId ? Math.max(1, Number(booking.cupos) || 1) : 1,
      participantes: (booking.participantes || []).map((p) => String(p || '').trim()).filter(Boolean).slice(0, 20),
      clienteTelefono: booking.clienteTelefono.replace(/\D/g, ''),
    };
    try {
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.cita_id) setCitaId(data.cita_id);
        // Cliente recurrente: guardar nombre/teléfono en este dispositivo
        // (o borrarlos si desactivó "recordar").
        try {
          if (recordarDatos) {
            localStorage.setItem(claveClienteGuardado(slug), JSON.stringify({
              nombre: booking.clienteNombre.trim(),
              telefono: formatPhoneNumber(booking.clienteTelefono),
            }));
            setClienteGuardado({ nombre: booking.clienteNombre.trim(), telefono: formatPhoneNumber(booking.clienteTelefono) });
          } else {
            localStorage.removeItem(claveClienteGuardado(slug));
            setClienteGuardado(null);
          }
        } catch {
          // localStorage lleno/bloqueado: no bloquea la confirmación.
        }
        // Conservar el profesional resuelto para el resumen de éxito.
        if (booking.empleadoId === EMP_ANY && empleadoFinal) {
          setSlotsPorHora((prev) => ({ ...prev, [booking.hora]: empleadoFinal }));
        }
        setPushStatus('idle');
        setStep(5);
        // El checkbox "avisarme" ahora sí cumple: si quedó marcado, se intenta
        // activar el aviso de una vez (sin otro toque). Si el permiso falla,
        // queda el botón manual en la pantalla de éxito.
        if (data.cita_id && booking.avisarme !== false && !avisosLimitadosIOS) {
          setTimeout(() => activarRecordatorio(data.cita_id, booking.clienteTelefono), 400);
        }
        return;
      }
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.message) {
        setError(data.message);
        if (data.error === 'max_per_day') {
          setStep(4);
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
        return;
      }
      setError("Hubo un problema al agendar. Intenta de nuevo.");
    } catch (err) {
      setError("Hubo un problema al agendar");
    } finally {
      enviandoRef.current = false;
      setLoading(false);
    }
  };

  const descargarMiICS = () => {
    descargarICS({
      slug,
      servicio: recursoServAtado?.name || servicioNombre,
      profesional: empleadoElegido?.name || recursoEmpAtado?.name || '',
      fecha: booking.fecha,
      hora: booking.hora,
      duracionMin: servicioElegido?.duration_minutes || recursoServAtado?.duration_minutes || 60,
      direccion: negocio?.direccion || '',
      timezone: negocio?.timezone || 'America/Bogota',
      notas: booking.clienteNotas || '',
      reminderDias: negocio?.reminder_days_before || 1,
      reminderHoras: negocio?.reminder_hours_before || 24,
    });
  };

  const reiniciarAgendamiento = () => {
    // Al volver al inicio se conservan nombre/teléfono (cliente recurrente);
    // solo se reinicia servicio/profesional/espacio/fecha/hora.
    setBooking((prev) => ({ servicioId: '', empleadoId: '', recursoId: '', cupos: 1, participantes: [], fecha: '', hora: '', clienteNombre: prev.clienteNombre, clienteTelefono: prev.clienteTelefono, clienteNotas: '', website: '' }));
    setSlots([]);
    setSlotsPorHora({});
    setLibresPorHora({});
    setPrimerHueco(null);
    setError('');
    setCitaId('');
    setPushStatus('idle');
    setPushError('');
    setStep(1);
    setView('agendar');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Activar recordatorio push post-agendamiento: pide permiso al navegador,
  // obtiene el token FCM y lo guarda en la reserva vía el endpoint del backend.
  // Se ejecuta DESPUÉS de que la cita ya está confirmada (201), separando la
  // UX de reserva de la de permisos. Si falla o el usuario niega, la cita
  // simplemente queda sin recordatorio push (sin efecto adverso).
  // Acepta el id/teléfono explícitos para el auto-intento justo al confirmar
  // (el estado citaId aún no se actualizó en ese momento).
  const activarRecordatorio = async (citaIdParam, telefonoParam) => {
    const id = citaIdParam || citaId;
    if (pushStatus !== 'idle' || !id) return;
    if (!messaging || typeof Notification === 'undefined') {
      setPushStatus('error');
      setPushError('Este navegador no soporta notificaciones. Tu cita quedó guardada y puedes añadirla al calendario.');
      return;
    }
    setPushStatus('loading');
    setPushError('');
    try {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      if (Notification.permission !== 'granted') {
        setPushStatus('error');
        setPushError('🔕 Sin permiso no hay avisos: actívalo en los ajustes del navegador para este sitio e intenta de nuevo.');
        return;
      }
      const token = await getToken(messaging, { vapidKey: undefined });
      if (!token) {
        setPushStatus('error');
        setPushError('⚠️ No se pudo obtener el token en este navegador.');
        return;
      }
      const res = await fetch(
        `${API_URL}/api/v1/b/${slug}/citas/${id}/client-push-token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // El teléfono verifica que quien registra es el dueño de la cita.
          body: JSON.stringify({ token, phone: ((telefonoParam ?? booking.clienteTelefono) || '').replace(/\D/g, '') }),
        }
      );
      if (res.ok) {
        setPushStatus('success');
      } else {
        setPushStatus('error');
        setPushError('⚠️ No se pudo activar. Revisa tu conexión e intenta de nuevo.');
      }
    } catch {
      setPushStatus('error');
      setPushError('⚠️ Error de red. Intenta de nuevo.');
    }
  };

  // iPhone sin app instalada: Apple no despierta avisos web en Safari.
  // Se detecta para explicar en palabras (no prometer lo imposible).
  const esIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const appInstalada = typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator?.standalone === true
  );
  const avisosLimitadosIOS = esIOS && !appInstalada;

  const slotsManana = slots.filter(h => parseInt(h.split(':')[0], 10) < 12);
  const slotsTarde = slots.filter(h => {
    const hNum = parseInt(h.split(':')[0], 10);
    return hNum >= 12 && hNum < 17;
  });
  const slotsNoche = slots.filter(h => parseInt(h.split(':')[0], 10) >= 17);

  if (!negocio && !error) return <div className="p-8 text-center font-medium text-gray-500">Cargando negocio...</div>;

  // Error fatal: el negocio no existe o el enlace está mal. Pantalla dedicada
  // sin navegación inferior para no confundir (antes se mostraba el nav vacío).
  if (!negocio && error) {
    return (
      <div className="min-h-screen bg-gray-100 font-sans antialiased">
        <div className="max-w-md mx-auto bg-gray-50 min-h-screen shadow-sm border-x border-gray-200 flex flex-col">
          <header className="p-4 bg-white border-b border-gray-100 text-center sticky top-0 z-40">
            <h1 className="text-lg font-bold text-gray-900">TurnoBot</h1>
            <p className="text-xs text-gray-400">Reserva tu cita en segundos</p>
          </header>
          <main className="p-4 flex-1 flex flex-col justify-center">
            <div className="p-6 bg-white border border-red-200 rounded-2xl text-center shadow-sm">
              <div className="text-4xl mb-3">🔍</div>
              <h2 className="text-base font-bold text-gray-900 mb-2">No encontramos este negocio</h2>
              <p className="text-xs text-red-600 font-medium mb-5">{error}</p>
              <div className="space-y-2">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full py-3 bg-black text-white font-bold rounded-xl text-xs active:scale-95 transition-transform"
                >
                  Reintentar
                </button>
                <a
                  href="/register"
                  className="block w-full py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs text-center active:scale-95 transition-transform"
                >
                  Crear mi negocio gratis
                </a>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className={`${negocio?.marca?.color ? 'tema-marca ' : ''}min-h-screen bg-gray-100 font-sans antialiased`} style={negocio?.marca?.color ? { '--marca': negocio.marca.color, '--sobre-marca': textoSobreMarca(negocio.marca.color) } : undefined}>
    <div className="max-w-md mx-auto bg-gray-50 min-h-screen pb-24 shadow-sm border-x border-gray-200">
      <header className="px-4 py-2.5 bg-white border-b border-gray-100 sticky top-0 z-40 flex items-center gap-3">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0"
          style={negocio?.marca?.color
            ? { backgroundColor: negocio.marca.color, color: textoSobreMarca(negocio.marca.color) }
            : { backgroundColor: '#111', color: '#fff' }}
        >
          {inicialMarca(negocio?.name)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-bold text-gray-900 leading-tight truncate">{negocio?.name || 'TurnoBot'}</h1>
          {negocio?.marca?.eslogan && (
            <p className="text-[10px] text-gray-400 font-medium truncate">{negocio.marca.eslogan}</p>
          )}
        </div>
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
              <MisCitas slug={slug} API_URL={API_URL} whatsapp={negocio?.whatsapp} timezone={negocio?.timezone} />
            )}

            {view === 'info' && (
              <div className="space-y-4">
                <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-sm">
                  <h2 className="text-base font-bold text-gray-800">{negocio.name}</h2>
                  <div className="space-y-3 text-xs text-gray-600">
                    {negocio.direccion ? <p className="flex items-center gap-2"><span aria-hidden="true">🏠</span> <span>{negocio.direccion}</span></p> : null}
                    {negocio.horario ? <p className="flex items-center gap-2">🕒 <span>{negocio.horario}</span></p> : null}
                    {negocio.telefono ? <p className="flex items-center gap-2">📞 <span>{formatearTelefono(negocio.telefono)}</span></p> : null}
                    
                    {(!negocio.direccion && !negocio.horario && !negocio.telefono) && (
                      <p className="text-gray-400 italic">Información del local no configurada.</p>
                    )}
                  </div>

                  {/* Descripción / propósito */}
                  {negocio.marca?.descripcion && (
                    <div className="pt-3 border-t border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Nuestra historia</p>
                      <p className="text-xs text-gray-600 leading-relaxed">{negocio.marca.descripcion}</p>
                    </div>
                  )}

                  {/* Redes sociales */}
                  {(negocio.marca?.instagram || negocio.marca?.facebook || negocio.marca?.tiktok) && (
                    <div className="pt-3 border-t border-gray-100">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Síguenos</p>
                      <div className="flex gap-2 flex-wrap">
                        {negocio.marca.instagram && (
                          <a
                            href={enlaceRed('instagram', negocio.marca.instagram)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-pink-600 bg-pink-50 hover:bg-pink-100 px-3 py-1.5 rounded-lg transition-colors border border-pink-200"
                          >
                            📷 Instagram
                          </a>
                        )}
                        {negocio.marca.facebook && (
                          <a
                            href={enlaceRed('facebook', negocio.marca.facebook)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors border border-blue-200"
                          >
                            👍 Facebook
                          </a>
                        )}
                        {negocio.marca.tiktok && (
                          <a
                            href={enlaceRed('tiktok', negocio.marca.tiktok)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-800 bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-lg transition-colors border border-gray-200"
                          >
                            🎵 TikTok
                          </a>
                        )}
                      </div>
                    </div>
                  )}

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
                  <button onClick={() => setStep(step - 1)} className="min-h-[44px] px-2 text-xs font-bold text-gray-500 mb-2 flex items-center gap-1 active:opacity-70">
                    ← Volver
                  </button>
                )}

                {/* Barra de progreso (orientación: el usuario sabe dónde va) */}
                {step < 5 && (
                  <ol aria-label="Progreso de la reserva" className="flex items-center gap-1 mb-1">
                    {pasos.map((p) => {
                      const alcanzado = step >= p.n;
                      const actual = step === p.n;
                      return (
                        <li key={p.n} className="flex-1">
                          <div
                            aria-current={actual ? 'step' : undefined}
                            title={`Paso ${p.n}: ${p.etiqueta}`}
                            className={`h-1.5 rounded-full ${alcanzado ? 'bg-black' : 'bg-gray-200'}`}
                          />
                          <p className={`mt-1 text-[10px] font-bold text-center leading-none ${actual ? 'text-black' : alcanzado ? 'text-gray-600' : 'text-gray-400'}`}>
                            {p.n}. {p.etiqueta}
                          </p>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {/* PASO 1 */}
                {/* Con espacios: primero se elige el camino (servicio o espacio).
                    Sin espacios: directo a servicios como siempre. */}
                {step >= 1 && hayRecursos && !modo && (
                  <div id="step-1" className="scroll-mt-24">
                    <h2 className="font-bold text-gray-800 mb-1 text-sm">1. ¿Qué quieres reservar?</h2>
                    <p className="text-[11px] text-gray-500 font-medium mb-3">
                      Tenemos atención por servicio y espacios para usar.
                    </p>
                    <div className="grid gap-3">
                      <button
                        type="button"
                        onClick={() => elegirModo('servicio')}
                        className="min-h-[76px] p-4 rounded-2xl border-2 border-gray-200 bg-white text-left flex items-center gap-3 active:scale-[0.98] hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                      >
                        <span className="text-3xl" aria-hidden="true">📋</span>
                        <span className="flex-1">
                          <span className="font-bold text-sm block">Reservar un servicio</span>
                          <span className="text-xs text-gray-500 font-medium block">Corte, consulta, clase… con profesional</span>
                        </span>
                        <span aria-hidden="true" className="text-gray-300 font-black">›</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => elegirModo('espacio')}
                        className="min-h-[76px] p-4 rounded-2xl border-2 border-gray-200 bg-white text-left flex items-center gap-3 active:scale-[0.98] hover:border-gray-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black"
                      >
                        <span className="text-3xl" aria-hidden="true">📍</span>
                        <span className="flex-1">
                          <span className="font-bold text-sm block">Reservar un espacio</span>
                          <span className="text-xs text-gray-500 font-medium block">Cancha, box, sala… directo, sin servicio</span>
                        </span>
                        <span aria-hidden="true" className="text-gray-300 font-black">›</span>
                      </button>
                    </div>
                  </div>
                )}
                {step >= 1 && (!hayRecursos || modo === 'servicio') && (
                  <div id="step-1" className={`scroll-mt-24 ${step !== 1 ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <h2 className="font-bold text-gray-800 text-sm">1. ¿Qué te quieres hacer?</h2>
                      {hayRecursos && modo === 'servicio' && (
                        <button type="button" onClick={() => elegirModo(null)} className="min-h-[44px] px-2 text-[11px] font-bold text-gray-400 underline">
                          Cambiar
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 font-medium mb-3">
                      Elige un servicio. El precio se paga en el local, aquí solo apartas tu turno.
                    </p>
                    {(!negocio.servicios || negocio.servicios.length === 0) ? (
                      <div className="p-6 text-center bg-white border border-gray-200 rounded-2xl">
                        <p className="text-sm font-bold text-gray-700">Aún no hay servicios publicados</p>
                        <p className="text-[11px] text-gray-500 font-medium mt-1">Escríbenos y te ayudamos a elegir por WhatsApp.</p>
                      </div>
                    ) : (
                    <>
                    {(negocio.servicios?.length || 0) > 4 && (
                      <label className="block mb-3">
                        <span className="sr-only">Buscar servicio</span>
                        <input
                          type="search"
                          placeholder="🔍 Buscar (ej. corte, uñas, color…)"
                          aria-label="Buscar servicio"
                          value={busquedaServicio}
                          onChange={(e) => setBusquedaServicio(e.target.value)}
                          className="w-full p-3 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black shadow-2xs"
                        />
                      </label>
                    )}
                    <div role="radiogroup" aria-label="Servicios disponibles" className="grid gap-3">
                      {negocio.servicios
                        ?.filter((s) => !busquedaServicio.trim() || (s.name || '').toLowerCase().includes(busquedaServicio.trim().toLowerCase()))
                        .map(s => {
                        const isActive = booking.servicioId === s.id;
                        return (
                          <button
                            key={s.id}
                            role="radio"
                            aria-checked={isActive}
                            aria-label={`${s.name}, ${duracionAmable(s.duration_minutes)}, ${formatDinero(s.price)}`}
                            onClick={() => {
                              // Cambiar de servicio conserva profesional/fecha/
                              // hora cuando siguen siendo válidos (no se
                              // resetea todo): solo se ajusta lo incompatible.
                              setBooking((prev) => {
                                const next = { ...prev, servicioId: s.id };
                                const empOk = !prev.empleadoId || prev.empleadoId === EMP_ANY || empleadosParaServicio(negocio, s.id).includes(prev.empleadoId);
                                if (!empOk) {
                                  next.empleadoId = '';
                                  next.fecha = '';
                                  next.hora = '';
                                }
                                return next;
                              });
                              setSlots([]);
                              setSlotsPorHora({});
                              setPrimerHueco(null);
                              setStep(1);
                            }}
                            className={`min-h-[68px] p-4 rounded-2xl border-2 text-left flex items-center gap-3 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${
                              isActive ? 'border-black bg-black text-white shadow-md' : 'border-gray-200 bg-white hover:border-gray-400 active:bg-gray-100'
                            }`}
                          >
                            <span aria-hidden="true" className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 ${
                              isActive ? 'border-white' : 'border-gray-300'
                            }`}
                            >
                              {isActive && <span className="w-3 h-3 bg-white rounded-full"></span>}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="font-bold text-sm block leading-snug">{s.name}</span>
                              <span className={`text-xs font-medium block mt-0.5 ${isActive ? 'text-gray-200' : 'text-gray-500'}`}>
                                ⏱️ {duracionAmable(s.duration_minutes)}
                              </span>
                            </span>
                            <span className="text-right shrink-0">
                              <span className="font-black text-base block leading-none">{formatDinero(s.price)}</span>
                              <span className={`text-[10px] font-semibold block mt-1 ${isActive ? 'text-gray-300' : 'text-gray-400'}`}>en el local</span>
                            </span>
                          </button>
                        );
                      })}
                      {negocio.servicios?.filter((s) => !busquedaServicio.trim() || (s.name || '').toLowerCase().includes(busquedaServicio.trim().toLowerCase())).length === 0 && (
                        <div className="p-4 text-center bg-gray-50 border border-gray-200 rounded-2xl">
                          <p className="text-gray-500 font-semibold text-xs">Sin resultados para “{busquedaServicio}”. Borra el texto para ver todo.</p>
                        </div>
                      )}
                    </div>
                    {/* Retroalimentación: confirma en palabras lo elegido */}
                    {servicioElegido && (
                      <p aria-live="polite" className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold">
                        ✅ Elegiste: <strong>{servicioElegido.name}</strong> — {duracionAmable(servicioElegido.duration_minutes)} — {formatDinero(servicioElegido.price)} en el local.
                      </p>
                    )}
                    {negocio.whatsapp && (
                      <a
                        href={`https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent('Hola, ¿qué servicio me recomiendan?')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block mt-3 text-center text-[11px] font-bold text-gray-500 underline"
                      >
                        ¿No sabes cuál elegir? Pregúntanos por WhatsApp
                      </a>
                    )}
                    </>
                    )}
                  </div>
                )}

                {/* PASO 2 (espacio y/o profesional según el modo) */}
                {(((modo === 'servicio' || !hayRecursos) && booking.servicioId) || modo === 'espacio') && (
                  <div id="step-2" className={`scroll-mt-24 ${step > 2 ? 'opacity-70 mt-6' : 'mt-6'}`}>
                    {/* Espacio (solo camino Espacio: en modo servicio no se muestra
                        para no mezclar; el espacio se reserva por su propio camino) */}
                    {modo === 'espacio' && (
                      <div className={modo === 'espacio' ? '' : 'mb-5'}>
                        <div className="flex items-center justify-between mb-1">
                          <h2 className="font-bold text-gray-800 text-sm">{modo === 'espacio' ? '1. ¿Qué espacio?' : '¿Dónde?'}</h2>
                          <button type="button" onClick={() => elegirModo(null)} className="min-h-[44px] px-2 text-[11px] font-bold text-gray-400 underline">
                            Cambiar
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-500 font-medium mb-3">
                          Si tu plan necesita un espacio concreto (cancha, box), elige cuál. Si no, sigue abajo.
                        </p>
                        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Espacios disponibles">
                          {negocio.recursos.map((r) => {
                            const isActive = booking.recursoId === r.id;
                            // Clase predefinida: muestra qué se dicta, quién,
                            // cuánto dura y cuánto cuesta (se hereda al reservar).
                            const servAtado = r.servicio_id ? negocio.servicios?.find(s => s.id === r.servicio_id) : null;
                            const empAtado = r.emp_id ? negocio.empleados?.find(e => e.id === r.emp_id) : null;
                            return (
                              <button
                                key={r.id}
                                role="radio"
                                aria-checked={isActive}
                                onClick={() => {
                                  const fechaActual = booking.fecha;
                                  // Al elegir espacio, el profesional pasa a
                                  // "el local asigna" (puedes cambiarlo abajo).
                                  setBooking((prev) => ({ ...prev, recursoId: isActive ? '' : r.id, cupos: 1, empleadoId: isActive ? prev.empleadoId : '' }));
                                  setStep(2);
                                  if (fechaActual && !isActive) {
                                    setTimeout(() => fetchHorariosRef.current?.(fechaActual), 0);
                                  }
                                }}
                                className={`p-3.5 border rounded-2xl font-bold text-sm flex items-center gap-3 active:scale-95 transition-all shadow-2xs ${
                                  isActive ? 'border-black bg-black text-white' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                                }`}
                              >
                                <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border text-base ${
                                  isActive ? 'bg-gray-800 border-gray-700' : 'bg-emerald-50 border-emerald-200'
                                }`} aria-hidden="true">
                                  {r.tipo === 'cancha' ? '⚽' : r.tipo === 'box' ? '🔧' : r.tipo === 'consultorio' ? '🩺' : r.tipo === 'sala' ? '🎶' : r.tipo === 'camilla' ? '💆' : r.tipo === 'clase' ? '🧘' : '📍'}
                                </span>
                                <span className="leading-tight text-left min-w-0">
                                  <span className="block truncate">{r.name}</span>
                                  {servAtado ? (
                                    <>
                                      <span className="block text-[11px] font-bold opacity-90 truncate">{servAtado.name}{empAtado ? ` · con ${empAtado.name}` : ''}</span>
                                      <span className="block text-[11px] font-semibold opacity-70">⏱️ {duracionAmable(servAtado.duration_minutes)} · {formatDinero(servAtado.price)}</span>
                                    </>
                                  ) : (
                                    <span className="block text-[11px] font-semibold opacity-70 capitalize">{r.tipo}{empAtado ? ` · con ${empAtado.name}` : ''}</span>
                                  )}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {recursoElegido && (
                          <p aria-live="polite" className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-semibold">
                            ✅ Espacio: <strong>{recursoElegido.name}</strong>
                            {recursoServAtado ? ` — ${recursoServAtado.name}${recursoEmpAtado ? ` con ${recursoEmpAtado.name}` : ''} (${duracionAmable(recursoServAtado.duration_minutes)}, ${formatDinero(recursoServAtado.price)})` : ''}
                            {(recursoElegido.capacidad || 1) > 1
                              ? ` (para ${recursoElegido.capacidad} personas — dime cuántos van).`
                              : modo === 'espacio' ? '. Sigue a elegir el día 👇.' : '. Abajo elige quién te atiende o deja “El local asigna”.'}
                          </p>
                        )}
                        {/* ¿Cuántos van? (solo espacios grupales) */}
                        {recursoElegido && (recursoElegido.capacidad || 1) > 1 && (
                          <label className="block mt-3">
                            <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">¿Cuántos van?</span>
                            <span className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Número de personas">
                              {Array.from({ length: Math.min(recursoElegido.capacidad, 20) }, (_, i) => i + 1).map((n) => (
                                <button
                                  key={n}
                                  type="button"
                                  role="radio"
                                  aria-checked={Number(booking.cupos) === n}
                                  onClick={() => {
                                    const fechaActual = booking.fecha;
                                    setBooking((prev) => ({ ...prev, cupos: n }));
                                    if (fechaActual) {
                                      setTimeout(() => fetchHorariosRef.current?.(fechaActual), 0);
                                    }
                                  }}
                                  className={`min-w-[44px] min-h-[44px] px-3 rounded-xl font-black text-sm active:scale-95 transition-all ${
                                    Number(booking.cupos) === n ? 'bg-black text-white shadow-md' : 'bg-white border border-gray-200 text-gray-700'
                                  }`}
                                >
                                  {n}
                                </button>
                              ))}
                            </span>
                          </label>
                        )}
                      </div>
                    )}
                    {/* Profesional (solo camino servicio; en modo espacio no aplica) */}
                    {modo !== 'espacio' && (
                    <>
                    <h2 className="font-bold text-gray-800 mb-1 text-sm mt-6">2. ¿Quién te atiende?</h2>
                    <p className="text-[11px] text-gray-500 font-medium mb-3">
                      Elige a tu profesional o toca “Cualquiera disponible” para lo más rápido.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {/* Cualquiera disponible: une la disponibilidad de todos */}
                      {empleadosElegibles.length > 1 && (
                        <button
                          key={EMP_ANY}
                          onClick={() => {
                            // Cambiar de profesional conserva fecha/hora si
                            // siguen libres (se revalida con un refetch).
                            const fechaActual = booking.fecha;
                            setBooking((prev) => ({ ...prev, empleadoId: EMP_ANY }));
                            setStep(2);
                            if (fechaActual) {
                              setTimeout(() => fetchHorariosRef.current?.(fechaActual), 0);
                            }
                          }}
                          className={`p-3.5 border rounded-2xl font-bold text-sm flex items-center gap-3 active:scale-95 transition-all shadow-2xs col-span-2 ${
                            booking.empleadoId === EMP_ANY ? 'border-black bg-black text-white' : 'bg-white border-dashed border-gray-300 text-gray-800 active:bg-gray-100'
                          }`}
                        >
                          <span className={`w-9 h-9 rounded-full flex items-center justify-center font-black shrink-0 border ${
                            booking.empleadoId === EMP_ANY ? 'bg-gray-800 text-white border-gray-700' : 'bg-amber-100 text-amber-800 border-amber-200'
                          }`}>
                            ⚡
                          </span>
                          <span className="leading-tight text-left">Cualquiera disponible
                            <span className="block text-[11px] font-semibold opacity-70">Lo más rápido</span>
                          </span>
                        </button>
                      )}
                      {empleadosElegibles.map(e => {
                        const isActive = booking.empleadoId === e.id;
                        return (
                          <button
                            key={e.id}
                            onClick={() => {
                              const fechaActual = booking.fecha;
                              setBooking((prev) => ({ ...prev, empleadoId: e.id }));
                              setStep(2);
                              if (fechaActual) {
                                setTimeout(() => fetchHorariosRef.current?.(fechaActual), 0);
                              }
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

                      {/* Nadie ofrece el servicio seleccionado */}
                      {empleadosElegibles.length === 0 && (
                        <div className="col-span-2 p-4 text-center bg-gray-50 border border-gray-200 rounded-2xl">
                          <p className="text-gray-500 font-semibold text-xs">No hay profesionales disponibles para este servicio en este momento.</p>
                        </div>
                      )}
                    </div>
                    </>
                    )}
                  </div>
                )}

                {/* PASO 3 (Calendario + primer hueco + semana) */}
                {step >= 2 && listoParaCalendario && (
                  <div id="step-3" className={`scroll-mt-24 ${step > 3 ? 'opacity-70 mt-6' : 'mt-6'}`}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">{modoEspacio ? '2. ¿Qué día quieres ir?' : '3. ¿Qué día quieres ir?'}</h2>
                    {modoEspacio && (
                      <p className="text-[11px] text-gray-500 font-medium mb-3 -mt-1">⏱️ Los turnos son de 1 hora. El pago se coordina con el local.</p>
                    )}
                    <button
                      type="button"
                      onClick={buscarPrimerHueco}
                      disabled={buscandoHueco}
                      className="w-full mb-3 py-3 bg-amber-100 text-amber-900 font-bold rounded-xl text-xs border border-amber-200 active:scale-95 transition-transform disabled:opacity-50"
                    >
                      {buscandoHueco ? '⏳ Buscando el primer hueco…' : '🔎 Buscar primer hueco disponible'}
                    </button>
                    {primerHueco && (
                      <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-800 font-semibold text-center">
                        Primer hueco: {formatearFechaLarga(primerHueco.fecha)} a las {primerHueco.hora}
                        {esModoAny ? ` con ${primerHueco.empName}` : ''} — ya lo seleccionamos abajo 👇
                      </div>
                    )}
                    {/* Vista semanal comparativa: conteo por día (lunes-domingo) */}
                    {semana.length > 0 && (
                      <div className="mb-3 bg-white border border-gray-200 rounded-2xl p-3 shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">Semana</p>
                          {cargandoSemana && <p className="text-[11px] text-gray-400 font-semibold">actualizando…</p>}
                        </div>
                        <div className="grid grid-cols-7 gap-1">
                          {semana.map((d) => {
                            const pasado = d.total < 0;
                            const sinCupo = !pasado && d.total === 0;
                            const esElegido = booking.fecha === d.fecha;
                            const dd = Number(d.fecha.slice(8, 10));
                            return (
                              <button
                                key={d.fecha}
                                type="button"
                                disabled={pasado}
                                onClick={() => fetchHorarios(d.fecha)}
                                title={pasado ? d.fecha : `${d.total} libres el ${d.fecha}`}
                                className={`min-h-[52px] py-2 px-0.5 rounded-lg text-center transition-all active:scale-95 disabled:opacity-20 ${
                                  esElegido ? 'bg-black text-white shadow-md' : sinCupo ? 'bg-gray-50 text-gray-300' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                                }`}
                              >
                                <span className="block text-[10px] font-bold uppercase">{DIAS_SEMANA_ABREV[new Date(d.fecha + 'T12:00:00').getDay()]}</span>
                                <span className="block text-sm font-black">{dd}</span>
                                <span className="block text-[10px] font-bold">{pasado ? '·' : `${d.total}`}</span>
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[10px] text-gray-400 font-medium text-center">Número = espacios libres {booking.recursoId ? '(tu espacio)' : esModoAny ? '(todos los profesionales)' : '(tu profesional)'}. Toca un día para ver horas.</p>
                      </div>
                    )}
                    <CalendarioGrid fechaSeleccionada={booking.fecha} onSeleccionar={fetchHorarios} timezone={negocio?.timezone} ventanaDias={negocio?.booking_window_days} />
                    {loading && <p className="text-center text-xs font-semibold text-gray-500 py-4">Buscando espacios libres...</p>}
                  </div>
                )}
                {step >= 2 && !listoParaCalendario && (
                  <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl text-center">
                    <p className="text-xs text-amber-800 font-semibold">
                      {modoEspacio
                        ? '👆 Elige un espacio arriba para ver el calendario.'
                        : booking.servicioId
                          ? '👆 Elige un profesional (o “Cualquiera disponible”) para ver el calendario.'
                          : '👆 Elige primero qué quieres reservar.'}
                    </p>
                    {hayRecursos && modo && (
                      <button type="button" onClick={() => elegirModo(null)} className="mt-2 text-[11px] font-bold text-gray-500 underline">
                        Cambiar entre servicio y espacio
                      </button>
                    )}
                  </div>
                )}

                {/* PASO 4 (Horarios) */}
                {step >= 3 && booking.fecha && slots.length >= 0 && (
                  <div id="step-4" className={`scroll-mt-24 ${step > 4 ? 'opacity-70 mt-6' : 'mt-6'}`}>
                    <h2 className="font-bold text-gray-800 mb-3 text-sm">{modoEspacio ? '3. Elige la hora' : '4. Horarios para el ' + formatearFechaLarga(booking.fecha)}</h2>
                    {recursoElegido && (
                      <p className="mb-3 text-[11px] text-gray-500 font-semibold">📍 Disponibilidad de <strong>{recursoElegido.name}</strong>.</p>
                    )}
                    {esModoAny && !booking.recursoId && slots.length > 0 && (
                      <p className="mb-3 text-[11px] text-gray-500 font-semibold">⚡ Te asignaremos al primer profesional libre en la hora que elijas.</p>
                    )}
                    {slots.length === 0 ? (
                      <div className="p-6 text-center bg-white border border-gray-200 rounded-2xl space-y-3">
                        <p className="text-red-500 font-semibold text-sm">No hay espacios disponibles este día.</p>
                        <button
                          type="button"
                          onClick={buscarPrimerHueco}
                          disabled={buscandoHueco}
                          className="w-full py-3 bg-black text-white font-bold rounded-xl text-xs active:scale-95 transition-transform disabled:opacity-50"
                        >
                          {buscandoHueco ? 'Buscando…' : '🔎 Buscar primer hueco'}
                        </button>
                        <p className="text-[11px] text-gray-400 font-medium">…o prueba otro día en la semana de arriba 👆</p>
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
                                  onClick={() => { setBooking((prev) => ({ ...prev, hora })); setStep(4); }}
                                  className={`min-h-[48px] py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black active:bg-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                                  }`}
                                >
                                  <span className="block">{hora}</span>
                                  {booking.recursoId && libresPorHora[hora] != null && libresPorHora[hora] <= 5 && (
                                    <span className={`block text-[10px] font-bold mt-0.5 ${booking.hora === hora ? 'text-gray-300' : 'text-amber-600'}`}>
                                      ¡Quedan {libresPorHora[hora]}!
                                    </span>
                                  )}
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
                                  onClick={() => { setBooking((prev) => ({ ...prev, hora })); setStep(4); }}
                                  className={`min-h-[48px] py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black active:bg-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                                  }`}
                                >
                                  <span className="block">{hora}</span>
                                  {booking.recursoId && libresPorHora[hora] != null && libresPorHora[hora] <= 5 && (
                                    <span className={`block text-[10px] font-bold mt-0.5 ${booking.hora === hora ? 'text-gray-300' : 'text-amber-600'}`}>
                                      ¡Quedan {libresPorHora[hora]}!
                                    </span>
                                  )}
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
                                  onClick={() => { setBooking((prev) => ({ ...prev, hora })); setStep(4); }}
                                  className={`min-h-[48px] py-3 border rounded-xl font-bold text-xs transition-colors active:scale-95 shadow-2xs ${
                                    booking.hora === hora ? 'bg-black text-white border-black active:bg-black' : 'bg-white border-gray-200 text-gray-800 active:bg-gray-100'
                                  }`}
                                >
                                  <span className="block">{hora}</span>
                                  {booking.recursoId && libresPorHora[hora] != null && libresPorHora[hora] <= 5 && (
                                    <span className={`block text-[10px] font-bold mt-0.5 ${booking.hora === hora ? 'text-gray-300' : 'text-amber-600'}`}>
                                      ¡Quedan {libresPorHora[hora]}!
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {esModoAny && booking.hora && empleadoElegido && (
                      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-semibold text-center">
                        👤 Te atenderá <strong>{empleadoElegido.name}</strong> (primer disponible a las {booking.hora})
                      </div>
                    )}
                  </div>
                )}

                {/* PASO 5 (Confirmar) */}
                {step >= 4 && booking.hora && step < 5 && (
                  <div id="step-5" className="mt-6 border-t border-gray-200 pt-6 pb-6 scroll-mt-24">
                    <form onSubmit={confirmarCita} className="space-y-4">
                      <h2 className="font-bold text-gray-800 text-sm">{modoEspacio ? '4. Tus datos para confirmar' : '5. Tus datos para confirmar'}</h2>

                      <div className="bg-white border border-gray-200 rounded-2xl p-4 text-xs text-gray-700 space-y-1.5 shadow-2xs">
                        <p>📋 {modoEspacio ? 'Reserva' : 'Servicio'}: <strong>{recursoServAtado?.name || servicioNombre}</strong>{(servicioElegido || recursoServAtado) ? ` (${formatDinero((servicioElegido || recursoServAtado).price)})` : ''}</p>
                        <p>👤 Profesional: <strong>{esModoAny ? `${empleadoElegido?.name || 'Por asignar'} (primer disponible)` : (empleadoElegido || recursoEmpAtado)?.name || (booking.recursoId ? 'El local asigna' : 'Por asignar')}</strong></p>
                        {recursoElegido && (
                          <p>📍 Espacio: <strong>{recursoElegido.name}{Number(booking.cupos) > 1 ? ` (${booking.cupos} personas)` : ''}</strong></p>
                        )}
                        <p>📅 Fecha: <strong>{formatearFechaLarga(booking.fecha)}</strong> a las <strong>{booking.hora}</strong></p>
                        {negocio?.direccion && (
                          <p>🏠 Dirección: <strong>{negocio.direccion}</strong></p>
                        )}
                      </div>

                      {/* Cliente recurrente: un toque para reusar datos guardados */}
                      {clienteGuardado && (!booking.clienteNombre || !booking.clienteTelefono) && (
                        <button
                          type="button"
                          onClick={() => setBooking((prev) => ({
                            ...prev,
                            clienteNombre: prev.clienteNombre || clienteGuardado.nombre || '',
                            clienteTelefono: prev.clienteTelefono || clienteGuardado.telefono || '',
                          }))}
                          className="w-full py-3 bg-emerald-50 text-emerald-800 font-bold rounded-xl text-xs border border-emerald-200 active:scale-95 transition-transform"
                        >
                          👋 Hola de nuevo{clienteGuardado.nombre ? `, ${clienteGuardado.nombre.split(' ')[0]}` : ''} — usar mis datos anteriores
                        </button>
                      )}

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
                      {/* Acompañantes (opcional): quiénes van además de ti */}
                      {booking.recursoId && Number(booking.cupos) > 1 && (
                        <div className="space-y-2">
                          <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                            ¿Quiénes van? (opcional, hasta {Math.min(Number(booking.cupos), 10)} nombres)
                          </p>
                          {Array.from({ length: Math.min(Number(booking.cupos), 10) }, (_, i) => (
                            <input
                              key={i}
                              type="text"
                              placeholder={`Acompañante ${i + 1}`}
                              aria-label={`Nombre del acompañante ${i + 1}`}
                              autoComplete="off"
                              maxLength={100}
                              value={(booking.participantes || [])[i] || ''}
                              onChange={(e) => setBooking((prev) => {
                                const arr = [...(prev.participantes || [])];
                                arr[i] = e.target.value;
                                return { ...prev, participantes: arr };
                              })}
                              className="w-full p-3.5 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black"
                            />
                          ))}
                        </div>
                      )}
                      <textarea
                        placeholder="¿Algo que debamos saber? (opcional, máx 500 caracteres)"
                        aria-label="Descripción de lo que necesitas (opcional)"
                        rows={2}
                        maxLength={500}
                        value={booking.clienteNotas}
                        onChange={e => setBooking({ ...booking, clienteNotas: e.target.value })}
                        className="w-full p-4 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:border-black resize-none"
                      />
                      <label className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-100 rounded-xl cursor-pointer active:scale-[0.99] transition-transform">
                        <input
                          type="checkbox"
                          checked={booking.avisarme !== false}
                          onChange={(e) => setBooking({ ...booking, avisarme: e.target.checked })}
                          className="w-5 h-5 accent-black shrink-0"
                        />
                        <span className="text-xs font-semibold text-gray-700">
                          🔔 Avísame antes de mi cita en este dispositivo
                          <span className="block text-[11px] font-medium text-gray-500 mt-0.5">
                            Al confirmar te pediremos permiso una sola vez.
                          </span>
                        </span>
                      </label>
                      <label className="flex items-center gap-3 px-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={recordarDatos}
                          onChange={(e) => setRecordarDatos(e.target.checked)}
                          className="w-4 h-4 accent-black shrink-0"
                        />
                        <span className="text-[11px] font-medium text-gray-500">
                          Recordar mis datos en este dispositivo para la próxima
                        </span>
                      </label>
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

                {/* PANTALLA ÉXITO (PASO 5) — autónoma: la cita ya quedó en
                    Firestore + Calendar con el 201. WhatsApp es opcional. */}
                {step === 5 && (
                  <div id="step-success" className="text-center p-6 bg-white border border-gray-200 rounded-2xl shadow-sm space-y-4 mt-4 scroll-mt-24">
                    <div className="text-4xl">✅</div>
                    <h2 className="text-xl font-bold text-gray-900">¡Cita confirmada!</h2>
                    <p className="text-sm text-gray-500">
                      Tu turno ha sido guardado exitosamente. Te esperamos el {formatearFechaLarga(booking.fecha)} a las {booking.hora}.
                    </p>

                    <div className="text-left bg-gray-50 rounded-xl p-4 space-y-2 text-sm text-gray-700 border border-gray-100">
                      <p>📋 <strong>{modoEspacio ? 'Reserva' : 'Servicio'}:</strong> {servicioNombre}</p>
                      <p>👤 <strong>Profesional:</strong> {empleadoElegido?.name || (booking.recursoId ? 'El local asigna' : '')}</p>
                      {recursoElegido && <p>📍 <strong>Espacio:</strong> {recursoElegido.name}{Number(booking.cupos) > 1 ? ` (${booking.cupos} personas)` : ''}</p>}
                      {(booking.participantes || []).filter(Boolean).length > 0 && (
                        <p>🧑‍🤝‍🧑 <strong>Van:</strong> {booking.participantes.filter(Boolean).join(', ')}</p>
                      )}
                      <p>📅 <strong>Fecha:</strong> {formatearFechaLarga(booking.fecha)}</p>
                      <p>🕐 <strong>Hora:</strong> {booking.hora}</p>
                      {booking.clienteNotas && <p>📝 <strong>Notas:</strong> {booking.clienteNotas}</p>}
                    </div>

                    <p className="mt-4 text-xs text-gray-500 font-medium">
                      💡 Llega <strong>5 minutos antes</strong> de tu cita.
                    </p>

                    <div className="space-y-3 pt-2">
                      <a
                        href={generarEnlaceGoogleCalendar({
                          servicio: recursoServAtado?.name || servicioNombre,
                          profesional: empleadoElegido?.name || recursoEmpAtado?.name || '',
                          fecha: booking.fecha,
                          hora: booking.hora,
                          duracionMin: servicioElegido?.duration_minutes || recursoServAtado?.duration_minutes || 60,
                          direccion: negocio?.direccion || '',
                          timezone: negocio?.timezone || 'America/Bogota',
                          notas: booking.clienteNotas || ''
                        })}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-center gap-2 w-full py-3.5 bg-white text-gray-700 font-bold rounded-xl text-sm border border-gray-200 shadow-sm active:scale-95 transition-transform"
                      >
                        <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
                          <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l3.6 2.8c2.2-2 3.8-5 3.8-8.8z" />
                          <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.4 1.2-4.1 1.2-3.1 0-5.8-2.1-6.8-5l-3.7 2.9C3.5 21.3 7.5 24 12 24z" />
                          <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4L1.5 6.6C.5 8.9 0 10.4 0 12s.5 3.1 1.5 4.5l3.7-2.1z" />
                          <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.7 1.5 6.6l3.7 2.9c1-2.9 3.7-4.8 6.8-4.8z" />
                        </svg>
                        Calendario de Google
                      </a>
                      <button
                        type="button"
                        onClick={descargarMiICS}
                        className="block w-full py-3.5 bg-gray-50 text-gray-600 font-bold rounded-xl text-center text-sm border border-gray-200 active:scale-95 transition-transform"
                      >
                        📅 Otros calendarios (.ics)
                      </button>

                      {/* Aviso push: el auto-intento corre al confirmar si quedó
                          marcado; este botón es el reintento manual. En iPhone
                          sin app instalada se explica el límite de Apple. */}
                      {avisosLimitadosIOS ? (
                        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-left">
                          <p className="text-xs font-bold text-amber-800">📲 ¿Usas iPhone? Instala la app para avisos</p>
                          <p className="text-[11px] text-amber-700 font-medium mt-1">
                            Safari no permite avisos web. Toca Compartir → “Añadir a pantalla de inicio”, abre TurnoBot desde ahí y activa el recordatorio. Mientras tanto tu cita quedó guardada y la tienes en el calendario de arriba.
                          </p>
                        </div>
                      ) : (
                        <>
                          {citaId && pushStatus === 'idle' && messaging && typeof Notification !== 'undefined' && (
                            <button
                              type="button"
                              onClick={() => activarRecordatorio()}
                              className="block w-full min-h-[48px] py-3.5 bg-blue-50 text-blue-700 font-bold rounded-xl text-center text-sm border border-blue-200 active:scale-95 transition-transform"
                            >
                              🔔 Activar recordatorio en este teléfono
                            </button>
                          )}
                          {pushStatus === 'loading' && (
                            <p role="status" className="text-xs text-blue-600 font-semibold py-2">⏳ Activando recordatorio…</p>
                          )}
                          {pushStatus === 'success' && (
                            <p role="status" className="text-xs text-green-600 font-semibold py-2">✅ Recordatorio activado. Te avisaremos antes de tu cita en este dispositivo.</p>
                          )}
                          {pushStatus === 'error' && (
                            <div className="py-2 space-y-2">
                              <p role="alert" className="text-xs text-red-600 font-semibold">{pushError || '⚠️ No se pudo activar el recordatorio.'}</p>
                              <button
                                type="button"
                                onClick={() => { setPushStatus('idle'); setPushError(''); setTimeout(() => activarRecordatorio(), 100); }}
                                className="min-h-[44px] px-4 text-xs text-blue-600 font-bold underline"
                              >
                                Intentar de nuevo
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {/* WhatsApp ahora es opcional para dudas, no obligatorio */}
                      {negocio.whatsapp && (
                        <a
                          href={`https://wa.me/${negocio.whatsapp}?text=${encodeURIComponent(`Hola, acabo de agendar una cita para el ${formatearFechaLarga(booking.fecha)} a las ${booking.hora}.`)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block w-full py-3.5 bg-green-50 text-green-700 font-bold rounded-xl text-center text-sm border border-green-200 active:scale-95 transition-transform"
                        >
                          💬 Tengo una duda (Escribir al local)
                        </a>
                      )}
                    </div>

                    <button onClick={reiniciarAgendamiento} className="text-xs text-gray-500 font-semibold underline pt-4 block w-full">
                      Volver al inicio
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* BOTTOM NAVIGATION BAR (centrada en desktop al ancho del contenido) */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200 px-6 py-2 flex justify-around items-center z-50 shadow-lg">
        <button
          onClick={() => { setView('agendar'); setStep(1); }}
          aria-current={view === 'agendar' ? 'page' : undefined}
          className={`min-h-[52px] px-4 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${view === 'agendar' ? 'text-black' : 'text-gray-400'}`}
        >
          <IconoCalendario />
          <span>Agendar</span>
        </button>
        <button
          onClick={() => setView('citas')}
          aria-current={view === 'citas' ? 'page' : undefined}
          className={`min-h-[52px] px-4 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${view === 'citas' ? 'text-black' : 'text-gray-400'}`}
        >
          <IconoLista />
          <span>Mis Citas</span>
        </button>
        <button
          onClick={() => setView('info')}
          aria-current={view === 'info' ? 'page' : undefined}
          className={`min-h-[52px] px-4 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold transition-colors ${view === 'info' ? 'text-black' : 'text-gray-400'}`}
        >
          <IconoPin />
          <span>Info Local</span>
        </button>
      </nav>
    </div>
    </div>
  );
}
