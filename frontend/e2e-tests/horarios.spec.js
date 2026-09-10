import { test, expect } from '@playwright/test';
import { db } from './setup.js';

const API = process.env.API_BASE || 'http://localhost:8080';
const ts = Date.now();
const SLUG = `tienda-horarios-${ts}`;
const EMP_ID = 'emp_test';
const SVC_ID = 'svc_test';

// Fechas dinámicas: próximo lunes y domingo futuros (el backend en modo mock
// filtra los slots pasados con t.After(time.Now()), así que fechas fijas
// quedan obsoletas en cuanto pasa el día).
// Usar formato local en lugar de UTC (toISOString) para evitar desfases de timezone
const fmtFecha = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
function proximoDia(getDay) {
  const d = new Date();
  d.setDate(d.getDate() + 1); // empezar mañana para garantizar futuro
  while (d.getDay() !== getDay) d.setDate(d.getDate() + 1);
  return fmtFecha(d);
}
const LUNES = proximoDia(1);
const DOMINGO = proximoDia(0);

test.describe('Arnés de Pruebas: Motor de Horarios por Empleado', () => {
  test.beforeAll(async () => {
    // 1. Crear el negocio base
    await db.collection('negocios').doc(SLUG).set({
      name: 'Tienda Pruebas Horarios',
      timezone: 'America/Bogota',
      // Horario general de la tienda (el empleado debería sobreescribir esto)
      open_time: '06:00',
      close_time: '22:00',
    });

    // 2. Crear servicio de 60 minutos
    await db.collection('negocios').doc(SLUG).collection('servicios').doc(SVC_ID).set({
      name: 'Corte Prueba',
      duration_minutes: 60,
    });
  });

  test.afterAll(async () => {
    // Limpieza
    await db.collection('negocios').doc(SLUG).collection('servicios').doc(SVC_ID).delete();
    await db.collection('negocios').doc(SLUG).collection('empleados').doc(EMP_ID).delete();
    await db.collection('negocios').doc(SLUG).delete();
  });

  const configurarHorarioEmpleado = async (horarioConfig) => {
    await db.collection('negocios').doc(SLUG).collection('empleados').doc(EMP_ID).set({
      name: 'Empleado Horarios',
      calendar_id: '', // Vacío para forzar modo mock (sin Google Calendar) y probar solo la lógica de franjas
      horario: horarioConfig,
    }, { merge: true });
  };

  const consultarSlots = async (fecha) => {
    const res = await fetch(`${API}/api/v1/b/${SLUG}/slots?emp_id=${EMP_ID}&servicio_id=${SVC_ID}&fecha=${fecha}`);
    expect(res.ok).toBe(true);
    return await res.json();
  };

  test('Requisito 1: Día inactivo (activo: false) no devuelve ningún turno', async () => {
    await configurarHorarioEmpleado({
      domingo: { activo: false, turnos: [] }
    });

    const slots = await consultarSlots(DOMINGO);
    expect(slots).toEqual([]); // No debe haber disponibilidad
  });

  test('Requisito 2: Jornada continua estándar', async () => {
    await configurarHorarioEmpleado({
      lunes: {
        activo: true,
        turnos: [{ inicio: '09:00', fin: '12:00' }]
      }
    });

    const slots = await consultarSlots(LUNES);
    // Para un servicio de 60 min entre 9:00 y 12:00, los slots deben ser exactos
    expect(slots).toEqual(['09:00', '10:00', '11:00']);
  });

  test('Requisito 3: Horario partido (pausa para almuerzo)', async () => {
    await configurarHorarioEmpleado({
      lunes: {
        activo: true,
        turnos: [
          { inicio: '09:00', fin: '11:00' }, // Mañana
          { inicio: '14:00', fin: '16:00' }  // Tarde
        ]
      }
    });

    const slots = await consultarSlots(LUNES);

    // Verificamos que se generen los turnos de la mañana y la tarde
    expect(slots).toContain('09:00');
    expect(slots).toContain('10:00');
    expect(slots).toContain('14:00');
    expect(slots).toContain('15:00');

    // Verificamos que el hueco del almuerzo (11:00 a 14:00) NO esté disponible
    expect(slots).not.toContain('11:00');
    expect(slots).not.toContain('12:00');
    expect(slots).not.toContain('13:00');

    // Total esperado: 2 en la mañana + 2 en la tarde
    expect(slots.length).toBe(4);
  });
});
