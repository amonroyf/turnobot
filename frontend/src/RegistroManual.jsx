// Registro manual de citas (dueño/empleado anotan un cliente sin cita previa).
// Replica el flujo del cliente (Servicio → Profesional/Espacio → Día → Hora →
// Datos) con las mismas reglas, pero con sesión del panel (origen=panel, sin
// UID) y cierre con botón de WhatsApp manual al cliente.
// Props: slug, API_URL, negocio, getHeaders (async -> {Authorization}),
//        empFijo (empleado: agenda bloqueada a sí mismo), compacto opcional.
import { useState, useEffect, useRef } from 'react';
import { formatearFechaLarga } from './fecha.js';

const formatDinero = (n) => '$' + Number(n || 0).toLocaleString('es-CO');
const duracionAmable = (m) => {
  const n = Number(m) || 60;
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const r = n % 60;
  return r === 0 ? `${h} h` : `${h} h ${r} min`;
};
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const sumarDiasStr = (base, n) => {
  const [y, m, d] = base.split('-').map(Number);
  const f = new Date(y, m - 1, d + n);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
};

export default function RegistroManual({ slug, API_URL, negocio, getHeaders, empFijo, onRegistrada }) {
  const hayRecursos = (negocio?.recursos || []).length > 0;
  const [modo, setModo] = useState(hayRecursos ? null : 'servicio');
  const [servicioId, setServicioId] = useState('');
  const [empleadoId, setEmpleadoId] = useState(empFijo || '');
  const [recursoId, setRecursoId] = useState('');
  const [cupos, setCupos] = useState(1);
  const [fecha, setFecha] = useState('');
  const [slots, setSlots] = useState([]);
  const [hora, setHora] = useState('');
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState(null);
  const enviandoRef = useRef(false);

  const modoEspacio = modo === 'espacio';
  const servicioElegido = negocio?.servicios?.find(s => s.id === servicioId);
  const recursoElegido = negocio?.recursos?.find(r => r.id === recursoId);
  const empleadoElegido = negocio?.empleados?.find(e => e.id === (empFijo || empleadoId));
  const empleadosElegibles = (negocio?.empleados || []).filter(
    (e) => !servicioId || !e.servicios_ids || e.servicios_ids.includes(servicioId)
  );
  // Ley de Hick: con muchos servicios, filtrar acelera la decisión.
  const [busquedaServicio, setBusquedaServicio] = useState('');
  const serviciosFiltrados = (negocio?.servicios || []).filter((s) =>
    !busquedaServicio.trim() ||
    s.name.toLowerCase().includes(busquedaServicio.trim().toLowerCase())
  );

  useEffect(() => {
    if (empFijo) setEmpleadoId(empFijo);
  }, [empFijo]);

  const listoParaDias = modoEspacio ? !!recursoId : (!!servicioId && !!(empFijo || empleadoId));

  // Orientación: pasos 1 Qué → 2 Quién/Dónde → 3 Cuándo → 4 Cliente.
  const pasoActual = !listoParaDias ? (modoEspacio ? (!recursoId ? 1 : 2) : (!servicioId ? 1 : 2)) : (!hora ? 3 : 4);
  // Reconocimiento > recuerdo: resumen vivo de lo elegido.
  const textoResumen = [
    servicioElegido?.name || recursoElegido?.name || null,
    empleadoElegido && !modoEspacio ? `con ${empleadoElegido.name}` : null,
    recursoElegido ? `en ${recursoElegido.name}` : null,
    fecha ? `${formatearFechaLarga(fecha)}${hora ? ` a las ${hora}` : ''}` : null,
  ].filter(Boolean).join(' · ');

  const fetchSlots = async (f) => {
    setSlots([]);
    setHora('');
    if (!f || !listoParaDias) return;
    setLoading(true);
    setError('');
    try {
      let url;
      if (modoEspacio) {
        const serv = recursoElegido?.servicio_id || '';
        url = `${API_URL}/api/v1/b/${slug}/slots?recurso_id=${recursoId}&servicio_id=${serv}&fecha=${f}&cupos=${cupos}`;
      } else {
        url = `${API_URL}/api/v1/b/${slug}/slots?emp_id=${empFijo || empleadoId}&servicio_id=${servicioId}&fecha=${f}`;
      }
      const res = await fetch(url);
      const data = await res.json().catch(() => null);
      setSlots(Array.isArray(data) ? data : (data?.slots || []));
    } catch {
      setError('No pudimos cargar horarios.');
      setSlots([]);
    }
    setLoading(false);
  };

  const elegirFecha = (f) => {
    setFecha(f);
    fetchSlots(f);
  };

  const confirmar = async (e) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    if (!nombre.trim() || !telefono.replace(/\D/g, '')) {
      setError('Nombre y WhatsApp del cliente son obligatorios.');
      return;
    }
    enviandoRef.current = true;
    setLoading(true);
    setError('');
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getHeaders?.()) };
      const payload = {
        servicioId: modoEspacio ? (recursoElegido?.servicio_id || '') : servicioId,
        empleadoId: modoEspacio ? (recursoElegido?.emp_id || '') : (empFijo || empleadoId),
        recursoId: recursoId || '',
        cupos: recursoId ? Math.max(1, Number(cupos) || 1) : 1,
        fecha, hora,
        clienteNombre: nombre.trim(),
        clienteTelefono: telefono.replace(/\D/g, ''),
        clienteNotas: notas.trim(),
        origen: 'panel',
      };
      const res = await fetch(`${API_URL}/api/v1/b/${slug}/book`, {
        method: 'POST', headers, body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.message || 'No se pudo registrar. Intenta de nuevo.');
        return;
      }
      const resumen = {
        servicio: servicioElegido?.name || recursoElegido?.name || '',
        profesional: empleadoElegido?.name || '',
        espacio: recursoElegido?.name || '',
        fecha, hora, nombre: nombre.trim(), telefono: telefono.replace(/\D/g, ''),
      };
      setExito(resumen);
      onRegistrada?.(resumen);
    } catch {
      setError('No se pudo registrar. Intenta de nuevo.');
    } finally {
      enviandoRef.current = false;
      setLoading(false);
    }
  };

  const otra = () => {
    setExito(null);
    setServicioId('');
    if (!empFijo) setEmpleadoId('');
    setRecursoId('');
    setCupos(1);
    setFecha('');
    setSlots([]);
    setHora('');
    setNombre('');
    setTelefono('');
    setNotas('');
    setError('');
    if (!hayRecursos) setModo('servicio');
  };

  if (exito) {
    const tel = (exito.telefono || '').replace(/\D/g, '');
    const msg = `Hola ${exito.nombre}, tu cita en ${negocio?.name || ''}: ${exito.servicio}${exito.profesional ? ` con ${exito.profesional}` : ''}${exito.espacio ? ` en ${exito.espacio}` : ''}, ${formatearFechaLarga(exito.fecha)} a las ${exito.hora}. ¡Te esperamos!`;
    return (
      <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-3">
        <p className="text-2xl">✅</p>
        <p className="text-sm font-bold text-emerald-900">Cita registrada: {exito.servicio} · {exito.fecha} {exito.hora}</p>
        <p className="text-xs text-emerald-800 font-medium">{exito.nombre} · {exito.telefono}</p>
        <div className="flex gap-2">
          {tel && (
            <a
              href={`https://wa.me/${tel}?text=${encodeURIComponent(msg)}`}
              target="_blank"
              rel="noreferrer"
              className="flex-1 min-h-[48px] py-3 bg-green-600 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 active:scale-95 transition-transform"
            >
              📲 Avisar por WhatsApp
            </a>
          )}
          <button
            type="button"
            onClick={otra}
            className="flex-1 min-h-[48px] py-3 bg-white border border-emerald-300 text-emerald-800 font-bold rounded-xl text-sm active:scale-95 transition-transform"
          >
            Registrar otra
          </button>
        </div>
      </div>
    );
  }

  const inputCls = 'w-full min-h-[48px] p-3 border border-gray-200 rounded-xl text-sm bg-white focus:border-black focus:outline-none';
  const btnHora = (h) => `min-h-[44px] px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-all ${hora === h ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'}`;

  return (
    <form onSubmit={confirmar} className="space-y-4">
      {/* Orientación: en qué paso va */}
      <ol className="flex items-center gap-1" aria-label="Progreso del registro">
        {['Qué', 'Quién', 'Cuándo', 'Cliente'].map((label, i) => {
          const n = i + 1;
          const activo = pasoActual === n;
          const listo = pasoActual > n;
          return (
            <li key={label} className="flex-1 flex items-center gap-1 last:flex-none" aria-current={activo ? 'step' : undefined}>
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${listo ? 'bg-emerald-600 text-white' : activo ? 'bg-black text-white' : 'bg-gray-100 text-gray-400'}`}>
                {listo ? '✓' : n}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wide ${activo ? 'text-gray-900' : 'text-gray-400'} hidden sm:inline`}>{label}</span>
              {n < 4 && <span className="flex-1 h-px bg-gray-200 mx-1" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
      {/* Reconocimiento: resumen vivo antes de confirmar */}
      {textoResumen && (
        <p aria-live="polite" className="text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
          📝 Vas a registrar: <strong>{textoResumen}</strong>
        </p>
      )}
      {/* Modo */}
      {hayRecursos && !empFijo && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Tipo de registro">
          {[{ id: 'servicio', label: '💈 Servicio' }, { id: 'espacio', label: '🏟️ Espacio' }].map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={modo === m.id}
              onClick={() => { setModo(m.id); setServicioId(''); setEmpleadoId(empFijo || ''); setRecursoId(''); setFecha(''); setSlots([]); setHora(''); }}
              className={`min-h-[48px] py-3 rounded-xl text-sm font-bold active:scale-95 transition-all ${modo === m.id ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* Servicio (con buscador si hay muchos: ley de Hick) */}
      {!modoEspacio && (negocio?.servicios || []).length > 6 && (
        <input
          type="search"
          placeholder="🔍 Buscar servicio…"
          value={busquedaServicio}
          onChange={(e) => setBusquedaServicio(e.target.value)}
          aria-label="Buscar servicio"
          className="w-full min-h-[44px] p-3 border border-gray-200 rounded-xl text-sm bg-white focus:border-black focus:outline-none"
        />
      )}
      {!modoEspacio && (
        <label className="block">
          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">1. Servicio</span>
          <select value={servicioId} onChange={(e) => { setServicioId(e.target.value); setFecha(''); setSlots([]); setHora(''); }} required className={inputCls} aria-label="Servicio">
            <option value="">Elige…</option>
            {serviciosFiltrados.map((s) => (
              <option key={s.id} value={s.id}>{s.name} · {duracionAmable(s.duration_minutes)} · {formatDinero(s.price)}</option>
            ))}
          </select>
        </label>
      )}

      {/* Profesional (fijo si es empleado) */}
      {!modoEspacio && !empFijo && (
        <label className="block">
          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">2. Profesional</span>
          <select value={empleadoId} onChange={(e) => { setEmpleadoId(e.target.value); setFecha(''); setSlots([]); setHora(''); }} required className={inputCls} aria-label="Profesional">
            <option value="">Elige…</option>
            {empleadosElegibles.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        </label>
      )}
      {!modoEspacio && empFijo && empleadoElegido && (
        <p className="text-xs font-bold text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">👤 En tu agenda ({empleadoElegido.name})</p>
      )}

      {/* Espacio */}
      {modoEspacio && (
        <label className="block">
          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">2. Espacio</span>
          <select value={recursoId} onChange={(e) => { setRecursoId(e.target.value); setCupos(1); setFecha(''); setSlots([]); setHora(''); }} required className={inputCls} aria-label="Espacio">
            <option value="">Elige…</option>
            {(negocio?.recursos || []).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.tipo})</option>)}
          </select>
        </label>
      )}
      {modoEspacio && recursoElegido && (recursoElegido.capacidad || 1) > 1 && (
        <label className="block">
          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">¿Cuántos van? (máx {recursoElegido.capacidad})</span>
          <span className="flex gap-2 flex-wrap">
            {Array.from({ length: Math.min(recursoElegido.capacidad, 20) }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setCupos(n)}
                aria-pressed={cupos === n}
                className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-all ${cupos === n ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                {n}
              </button>
            ))}
          </span>
        </label>
      )}

      {/* Día: atajos Hoy/Mañana (1 toque) + calendario para el resto */}
      {listoParaDias && (
        <div>
          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">3. Día y hora</span>
          <div className="flex gap-2 mb-2" role="group" aria-label="Atajos de día">
            {[{ id: 'hoy', label: 'Hoy', valor: hoyLocal() }, { id: 'manana', label: 'Mañana', valor: sumarDiasStr(hoyLocal(), 1) }].map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => elegirFecha(a.valor)}
                aria-pressed={fecha === a.valor}
                className={`flex-1 min-h-[44px] py-2 rounded-xl text-sm font-bold active:scale-95 transition-all ${fecha === a.valor ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'}`}
              >
                {a.label}
              </button>
            ))}
            <input
              type="date"
              value={fecha}
              min={hoyLocal()}
              max={sumarDiasStr(hoyLocal(), 30)}
              onChange={(e) => { if (e.target.value) elegirFecha(e.target.value); }}
              aria-label="Elegir otro día"
              className="flex-1 min-h-[44px] p-2 border border-gray-200 rounded-xl text-sm bg-white text-gray-600 focus:border-black focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Hora */}
      {!!fecha && (
        loading && slots.length === 0 ? (
          <p className="text-xs text-gray-400 font-medium text-center py-3">Buscando huecos…</p>
        ) : slots.length === 0 ? (
          <p className="text-xs text-gray-500 font-medium text-center py-3 bg-gray-50 rounded-xl">Sin huecos ese día. Prueba otro.</p>
        ) : (
          <div>
            <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Hora</span>
            <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label="Horas libres">
              {slots.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={hora === h} onClick={() => setHora(h)} className={btnHora(h)}>
                  {h}
                </button>
              ))}
            </div>
          </div>
        )
      )}

      {/* Cliente */}
      {!!hora && (
        <>
          <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider">4. Cliente</span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Nombre del cliente</span>
              <input type="text" required placeholder="Ej. María López" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} aria-label="Nombre del cliente" className={inputCls} />
            </label>
            <label className="block">
              <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">WhatsApp</span>
              <input type="tel" required inputMode="tel" placeholder="Ej. 300 123 4567" value={telefono} onChange={(e) => setTelefono(e.target.value)} aria-label="WhatsApp del cliente" className={inputCls} />
            </label>
          </div>
          <label className="block">
            <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">Notas (opcional)</span>
            <input type="text" placeholder="Ej. Llega en moto" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} aria-label="Notas (opcional)" className={inputCls} />
          </label>
        </>
      )}

      {error && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl text-center font-medium">
          {error}
        </div>
      )}

      {!!hora && (
        <button type="submit" disabled={loading} className="w-full min-h-[52px] py-4 bg-black text-white font-bold rounded-xl text-sm active:scale-95 transition-transform disabled:opacity-50">
          {loading ? 'Registrando…' : 'Registrar cita'}
        </button>
      )}
    </form>
  );
}
