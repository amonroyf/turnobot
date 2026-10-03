import { describe, it, expect } from 'vitest';
import { PAISES, paisPorISO, formatoMoneda, digitosConPrefijo, PAIS_DEFAULT } from './paises.js';

describe('paises', () => {
  it('tabla con ISO únicos y default CO', () => {
    expect(PAIS_DEFAULT).toBe('CO');
    const isos = PAISES.map((p) => p.iso);
    expect(new Set(isos).size).toBe(isos.length);
    expect(isos.length).toBeGreaterThan(5);
  });
  it('paisPorISO con fallback', () => {
    expect(paisPorISO('MX').moneda).toBe('MXN');
    expect(paisPorISO('mx').prefijo).toBe('52');
    expect(paisPorISO('XX').iso).toBe('CO');
    expect(paisPorISO('').iso).toBe('CO');
  });
  it('formatoMoneda por país', () => {
    expect(formatoMoneda(20000, 'CO')).toContain('20.000');
    const mx = formatoMoneda(20000, 'MX');
    expect(mx).toContain('20,000');
    expect(formatoMoneda(0, 'XX')).toContain('0');
  });
  it('digitosConPrefijo no duplica', () => {
    expect(digitosConPrefijo('3001234567', 'CO')).toBe('573001234567');
    expect(digitosConPrefijo('573001234567', 'CO')).toBe('573001234567');
    expect(digitosConPrefijo('5512345678', 'MX')).toBe('525512345678');
  });
});
