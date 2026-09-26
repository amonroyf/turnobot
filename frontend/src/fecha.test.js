import { describe, it, expect } from 'vitest';
import {
  sumarDias,
  formatearFechaLarga,
  formatearTelefono,
  fechaHoraAUtc,
  diaKeyEnZona,
  horaEnZona,
  generarEnlaceGoogleCalendar,
} from './fecha.js';

describe('sumarDias', () => {
  it('suma días dentro del mes', () => {
    expect(sumarDias('2026-09-25', 3)).toBe('2026-09-28');
  });
  it('cruza de mes y de año', () => {
    expect(sumarDias('2026-01-31', 1)).toBe('2026-02-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('resta días', () => {
    expect(sumarDias('2026-09-25', -1)).toBe('2026-09-24');
  });
  it('formato con ceros', () => {
    expect(sumarDias('2026-09-05', 0)).toBe('2026-09-05');
  });
});

describe('formatearFechaLarga', () => {
  it('formatea es-CO con mayúscula inicial', () => {
    expect(formatearFechaLarga('2026-09-26')).toBe('Sábado, 26 de septiembre de 2026');
  });
  it('devuelve vacío o el input si no calza', () => {
    expect(formatearFechaLarga('')).toBe('');
    expect(formatearFechaLarga('ayer')).toBe('ayer');
  });
});

describe('formatearTelefono', () => {
  it('12 dígitos con 57', () => {
    expect(formatearTelefono('+573229124517')).toBe('322 912 4517');
  });
  it('10 dígitos locales', () => {
    expect(formatearTelefono('3001234567')).toBe('300 123 4567');
  });
  it('respeta vacíos y rarezas', () => {
    expect(formatearTelefono('')).toBe('');
    expect(formatearTelefono('123')).toBe('123');
  });
});

describe('fechaHoraAUtc (Bogotá UTC-5 sin DST)', () => {
  it('10:00 Bogotá = 15:00Z', () => {
    const d = fechaHoraAUtc('2026-09-28', '10:00', 'America/Bogota');
    expect(d.toISOString()).toBe('2026-09-28T15:00:00.000Z');
  });
  it('null con input inválido', () => {
    expect(fechaHoraAUtc('ayer', '10:00', 'America/Bogota')).toBeNull();
    expect(fechaHoraAUtc('2026-09-28', 'x', 'America/Bogota')).toBeNull();
  });
});

describe('diaKeyEnZona / horaEnZona', () => {
  it('medianoche UTC es día anterior en Bogotá', () => {
    const ms = Date.UTC(2026, 8, 28, 0, 30); // 00:30Z = 19:30 Bogotá del 27
    expect(diaKeyEnZona(ms, 'America/Bogota')).toBe('2026-09-27');
    expect(horaEnZona(ms, 'America/Bogota')).toBe('19:30');
  });
  it('mediodía local', () => {
    const ms = Date.UTC(2026, 8, 28, 15, 0); // 15:00Z = 10:00 Bogotá
    expect(diaKeyEnZona(ms, 'America/Bogota')).toBe('2026-09-28');
    expect(horaEnZona(ms, 'America/Bogota')).toBe('10:00');
  });
});

describe('generarEnlaceGoogleCalendar', () => {
  it('arma URL con fechas correctas para 90 min', () => {
    const url = generarEnlaceGoogleCalendar({
      servicio: 'Clase de Crossfit', profesional: 'Ana',
      fecha: '2026-09-28', hora: '18:00', duracionMin: 90,
      direccion: 'Calle 1', timezone: 'America/Bogota', notas: '',
    });
    expect(url).toContain('calendar.google.com/calendar/render?action=TEMPLATE');
    // 18:00 Bogotá = 23:00Z, fin 19:30 = 00:30Z del 29
    expect(url).toContain('20260928T230000Z/20260929T003000Z');
  });
});
