// Modal genérico de horario semanal (días + turnos), compartido por el dueño
// (Admin) y el profesional (portal del empleado). La persistencia la inyecta
// cada vista con `onGuardar` (dueño: SDK; empleado: endpoint con su token).
import { useState } from 'react';
import { useDialogo } from './ConfirmDialog.jsx';

export const DIAS_SEMANA = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];

export const defaultHorario = {
  lunes:     { activo: true,  turnos: [{ inicio: '09:00', fin: '13:00' }, { inicio: '14:00', fin: '18:00' }] },
  martes:    { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  miercoles: { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  jueves:    { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  viernes:   { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  sabado:    { activo: true,  turnos: [{ inicio: '09:00', fin: '14:00' }] },
  domingo:   { activo: false, turnos: [] },
};

// Resumen en palabras del horario semanal ("Lun–Vie 9:00–18:00, Sáb 9:00–14:00").
// Es lo que se verifica antes de guardar.
export function resumenSemana(horario) {
  const cortos = { lunes: 'Lun', martes: 'Mar', miercoles: 'Mié', jueves: 'Jue', viernes: 'Vie', sabado: 'Sáb', domingo: 'Dom' };
  const partes = [];
  for (const d of DIAS_SEMANA) {
    const data = horario?.[d];
    if (!data?.activo || !Array.isArray(data.turnos) || data.turnos.length === 0) continue;
    const turnos = data.turnos
      .filter((t) => t.inicio && t.fin && t.inicio < t.fin)
      .map((t) => `${t.inicio}–${t.fin}`)
      .join(' y ');
    if (turnos) partes.push(`${cortos[d]} ${turnos}`);
  }
  if (partes.length === 0) return 'Cerrado toda la semana (nadie podrá reservar).';
  return 'Atiende: ' + partes.join(', ') + '.';
}

// Horario inicial construido desde la jornada del local (open/close globales,
// iguales todos los días): se usa para PRECARGAR el horario del local al
// configurar un espacio, en vez de defaults inventados (9-18) que encogían
// la disponibilidad en silencio si el dueño guardaba sin editar.
export function horarioDesdeJornada(jornada) {
  const turnosBase = jornada?.open_time && jornada?.close_time
    ? [{ inicio: jornada.open_time, fin: jornada.close_time }]
    : [];
  const dia = () => ({ activo: turnosBase.length > 0, turnos: turnosBase.map((t) => ({ ...t })) });
  return {
    lunes: dia(), martes: dia(), miercoles: dia(), jueves: dia(),
    viernes: dia(), sabado: dia(), domingo: dia(),
  };
}

export function HorarioModal({ titulo, nombre, bajada, horarioInicial, onGuardar, exito, onClose }) {
  const { avisar } = useDialogo();
  const [horario, setHorario] = useState(() => {
    const base = horarioInicial || {};
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
      await onGuardar(horario);
      await avisar(exito, 'exito');
      onClose();
    } catch (err) {
      await avisar('No se pudo guardar el horario. Intenta de nuevo.', 'error');
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
        <h3 className="text-lg font-bold mb-1 text-gray-900">{titulo}</h3>
        <p className="text-sm text-gray-500 mb-1">{nombre}</p>
        <p className="text-[11px] text-gray-400 font-medium mb-2">{bajada}</p>
        {/* Resumen en palabras: qué ve el cliente según esto */}
        <p aria-live="polite" className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-3">
          📅 {resumenSemana(horario)}
        </p>
        <button
          type="button"
          onClick={() => {
            const lun = horario.lunes?.turnos?.length > 0
              ? horario.lunes
              : { activo: true, turnos: [{ inicio: '09:00', fin: '18:00' }] };
            const copia = { ...horario };
            for (const d of ['martes', 'miercoles', 'jueves', 'viernes', 'sabado']) {
              copia[d] = { activo: true, turnos: lun.turnos.map((t) => ({ ...t })) };
            }
            setHorario(copia);
          }}
          className="mb-4 w-full min-h-[44px] py-2.5 bg-gray-100 text-gray-700 font-bold rounded-xl text-xs active:scale-95 transition-transform"
        >
          📋 Copiar el lunes a martes–sábado
        </button>

        {errorValidacion && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl font-medium">
            {errorValidacion}
          </div>
        )}

        <div className="space-y-4">
          {DIAS_SEMANA.map((dia) => (
            <div key={dia} className="border-b border-gray-100 pb-3">
              <label className="flex justify-between items-center mb-2 cursor-pointer min-h-[44px]">
                <span className="capitalize font-semibold text-gray-800">{dia}</span>
                <input
                  type="checkbox"
                  checked={horario[dia]?.activo ?? false}
                  onChange={() => toggleDia(dia)}
                  aria-label={`¿Atiende el ${dia}?`}
                  className="w-6 h-6 accent-black shrink-0"
                />
              </label>
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
                        <button onClick={() => eliminarTurno(dia, idx)} aria-label={`Quitar turno ${t.inicio} a ${t.fin} del ${dia}`} className="min-h-[44px] min-w-[44px] text-red-400 hover:text-red-600 font-bold px-2 py-1 active:scale-95">✕</button>
                      )}
                    </div>
                  ))}
                  <button onClick={() => agregarTurno(dia)} disabled={(horario[dia].turnos || []).length >= 4} className="min-h-[44px] text-xs text-blue-600 font-bold active:scale-95 pt-1 disabled:opacity-30">
                    + Añadir otro turno el mismo día
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="min-h-[48px] px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm active:scale-95 transition-transform">
            Cancelar
          </button>
          <button
            onClick={guardarHorario}
            disabled={guardando || errorValidacion != null}
            className="min-h-[48px] px-5 py-2.5 bg-black text-white rounded-xl font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform shadow-md"
          >
            {guardando ? 'Guardando...' : 'Guardar horario'}
          </button>
        </div>
      </div>
    </div>
  );
}
