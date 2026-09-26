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

// Preset del toggle "Horario propio" al crear un espacio nuevo: SOLO los
// viernes de 14:00 a 16:00. Los demás días quedan cerrados. Función (no
// constante) porque el modal muta el objeto al editarlo.
export function horarioViernes14a16() {
  return {
    lunes:     { activo: false, turnos: [] },
    martes:    { activo: false, turnos: [] },
    miercoles: { activo: false, turnos: [] },
    jueves:    { activo: false, turnos: [] },
    viernes:   { activo: true, turnos: [{ inicio: '14:00', fin: '16:00' }] },
    sabado:    { activo: false, turnos: [] },
    domingo:   { activo: false, turnos: [] },
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
    <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl p-6 max-w-lg w-full max-h-[90vh] flex flex-col shadow-2xl">
        
        <div className="shrink-0 mb-4">
          <h3 className="text-xl font-black text-gray-900">{titulo}</h3>
          <p className="text-sm font-bold text-gray-500 mb-1">{nombre}</p>
          <p className="text-xs text-gray-400 font-medium mb-3">{bajada}</p>
          
          <div aria-live="polite" className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start gap-2">
            <span className="text-emerald-500 text-base leading-none mt-0.5">ℹ️</span>
            <span>{resumenSemana(horario)}</span>
          </div>
        </div>

        {errorValidacion && (
          <div className="shrink-0 mb-4 p-3 bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl font-bold flex items-center gap-2">
            <span>⚠️</span> {errorValidacion}
          </div>
        )}

        <div className="flex-1 overflow-y-auto pr-2 space-y-1 scrollbar-thin">
          
          <button
            type="button"
            onClick={() => {
              const diaBase = DIAS_SEMANA.find(d => horario[d]?.activo) || 'lunes';
              const refData = horario[diaBase]?.turnos?.length > 0 
                ? horario[diaBase] 
                : { activo: true, turnos: [{ inicio: '09:00', fin: '18:00' }] };
              
              const copia = { ...horario };
              for (const d of DIAS_SEMANA) {
                if (d !== diaBase && copia[d].activo) {
                  copia[d] = { activo: true, turnos: refData.turnos.map((t) => ({ ...t })) };
                }
              }
              setHorario(copia);
            }}
            className="w-full mb-2 min-h-[40px] py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold rounded-xl text-xs active:scale-95 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
            Copiar el primer día a los demás días activos
          </button>

          {DIAS_SEMANA.map((dia) => {
            const activo = horario[dia]?.activo ?? false;
            return (
              <div key={dia} className="py-3 border-b border-gray-100 last:border-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={activo}
                      onClick={() => toggleDia(dia)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${activo ? 'bg-black' : 'bg-gray-200'}`}
                    >
                      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${activo ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    
                    <span className={`capitalize text-sm w-24 ${activo ? 'font-bold text-gray-900' : 'font-medium text-gray-400'}`}>
                      {dia}
                    </span>
                  </div>
                  
                  {!activo && (
                    <span className="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                      Cerrado
                    </span>
                  )}
                </div>

                {activo && (
                  <div className="pl-14 space-y-2 mt-1">
                    {(horario[dia].turnos || []).map((t, idx) => (
                      <div key={idx} className="flex gap-2 items-center">
                        <div className={`flex items-center bg-gray-50 border rounded-xl overflow-hidden focus-within:border-black focus-within:ring-1 focus-within:ring-black transition-all ${t.inicio >= t.fin ? 'border-red-400 bg-red-50' : 'border-gray-200'}`}>
                          <input
                            type="time" value={t.inicio}
                            onChange={(e) => handleTurnoChange(dia, idx, 'inicio', e.target.value)}
                            className="p-2.5 text-sm font-semibold text-gray-700 bg-transparent focus:outline-none w-28 text-center"
                          />
                          <span className="text-gray-400 font-medium px-1">-</span>
                          <input
                            type="time" value={t.fin}
                            onChange={(e) => handleTurnoChange(dia, idx, 'fin', e.target.value)}
                            className="p-2.5 text-sm font-semibold text-gray-700 bg-transparent focus:outline-none w-28 text-center"
                          />
                        </div>

                        {(horario[dia].turnos || []).length > 1 && (
                          <button 
                            onClick={() => eliminarTurno(dia, idx)} 
                            title={`Quitar turno del ${dia}`} 
                            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors active:scale-95"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                          </button>
                        )}
                      </div>
                    ))}
                    
                    <button 
                      onClick={() => agregarTurno(dia)} 
                      disabled={(horario[dia].turnos || []).length >= 4} 
                      className="text-[11px] text-gray-500 hover:text-black font-bold flex items-center gap-1 mt-2 active:scale-95 transition-colors disabled:opacity-30 disabled:hover:text-gray-500"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"></path></svg>
                      Añadir otro turno este día
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="shrink-0 flex gap-3 pt-5 mt-2 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 min-h-[52px] py-3 bg-gray-100 text-gray-700 rounded-xl font-bold text-sm active:scale-95 transition-transform">
            Cancelar
          </button>
          <button
            onClick={guardarHorario}
            disabled={guardando || errorValidacion != null}
            className="flex-1 min-h-[52px] py-3 bg-black text-white rounded-xl font-bold text-sm disabled:opacity-50 active:scale-95 transition-transform shadow-lg"
          >
            {guardando ? 'Guardando...' : 'Guardar horario'}
          </button>
        </div>
      </div>
    </div>
  );
}
