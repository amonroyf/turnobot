import { describe, it, expect } from 'vitest';
import { horarioDesdeJornada, horarioViernes14a16, resumenSemana } from './HorarioModal.jsx';

describe('horarioDesdeJornada', () => {
  it('precarga la jornada del local en los 7 días', () => {
    const h = horarioDesdeJornada({ open_time: '08:00', close_time: '20:00' });
    expect(Object.keys(h)).toHaveLength(7);
    expect(h.viernes).toEqual({ activo: true, turnos: [{ inicio: '08:00', fin: '20:00' }] });
    expect(h.lunes.turnos).toHaveLength(1);
  });

  it('sin jornada configurada deja días inactivos sin turnos', () => {
    const h = horarioDesdeJornada({});
    expect(h.sabado).toEqual({ activo: false, turnos: [] });
  });
});

describe('escenario: clase solo los viernes de 14:00 a 16:00', () => {
  // Lo que construye el dueño: activa el toggle "Horario propio", el modal
  // se abre precargado con la jornada, y deja SOLO el viernes 14:00-16:00.
  const soloViernes = horarioDesdeJornada({ open_time: '14:00', close_time: '16:00' });
  for (const d of ['lunes', 'martes', 'miercoles', 'jueves', 'sabado', 'domingo']) {
    soloViernes[d] = { activo: false, turnos: [] };
  }

  it('el resumen describe exactamente el viernes', () => {
    expect(resumenSemana(soloViernes)).toBe('Atiende: Vie 14:00–16:00.');
  });

  it('el viernes quedó activo con un único turno correcto', () => {
    expect(soloViernes.viernes).toEqual({
      activo: true,
      turnos: [{ inicio: '14:00', fin: '16:00' }],
    });
  });

  it('los otros 6 días quedaron cerrados', () => {
    for (const d of ['lunes', 'martes', 'miercoles', 'jueves', 'sabado', 'domingo']) {
      expect(soloViernes[d].activo).toBe(false);
      expect(soloViernes[d].turnos).toHaveLength(0);
    }
  });

  it('una semana entera cerrada avisa que nadie podrá reservar', () => {
    expect(resumenSemana(horarioDesdeJornada({}))).toContain('Cerrado toda la semana');
  });

  it('el toggle precarga el preset: solo viernes 14:00-16:00', () => {
    const preset = horarioViernes14a16();
    expect(resumenSemana(preset)).toBe('Atiende: Vie 14:00–16:00.');
    expect(preset.viernes.activo).toBe(true);
    for (const d of ['lunes', 'martes', 'miercoles', 'jueves', 'sabado', 'domingo']) {
      expect(preset[d].activo).toBe(false);
    }
  });

  it('cada llamado devuelve un objeto nuevo (el modal puede mutarlo sin contaminar el preset)', () => {
    const a = horarioViernes14a16();
    const b = horarioViernes14a16();
    expect(a).not.toBe(b);
    expect(a.viernes).not.toBe(b.viernes);
    a.viernes.turnos[0].inicio = '15:00';
    expect(b.viernes.turnos[0].inicio).toBe('14:00');
  });
});
