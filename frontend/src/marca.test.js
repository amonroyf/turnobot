import { describe, it, expect } from 'vitest';
import {
  textoSobreMarca,
  inicialMarca,
  fondoMarca,
  enlaceRed,
  colorMarca,
  temaMarcaProps,
} from './marca.js';

describe('textoSobreMarca (contraste)', () => {
  it('fondo claro -> texto oscuro', () => {
    expect(textoSobreMarca('#FFFFFF')).toBe('#111827');
    expect(textoSobreMarca('#FBBF24')).toBe('#111827');
  });
  it('fondo oscuro -> texto blanco', () => {
    expect(textoSobreMarca('#000000')).toBe('#ffffff');
    expect(textoSobreMarca('#047857')).toBe('#ffffff');
  });
  it('inválido -> blanco seguro', () => {
    expect(textoSobreMarca('')).toBe('#ffffff');
    expect(textoSobreMarca('rojo')).toBe('#ffffff');
  });
});

describe('inicialMarca', () => {
  it('primera letra en mayúscula', () => {
    expect(inicialMarca('pequería perrunos')).toBe('P');
  });
  it('vacío -> T', () => {
    expect(inicialMarca('')).toBe('T');
    expect(inicialMarca(null)).toBe('T');
  });
});

describe('fondoMarca', () => {
  it('degradado con el color', () => {
    expect(fondoMarca('#047857')).toContain('#047857');
  });
  it('sin color -> undefined', () => {
    expect(fondoMarca('')).toBeUndefined();
  });
});

describe('colorMarca / temaMarcaProps', () => {
  it('extrae y recorta', () => {
    expect(colorMarca({ marca: { color: '  #123456 ' } })).toBe('#123456');
    expect(colorMarca({})).toBe('');
  });
  it('props vacías sin marca', () => {
    expect(temaMarcaProps({})).toEqual({});
  });
  it('props con marca y contraste', () => {
    const p = temaMarcaProps({ marca: { color: '#000000' } });
    expect(p.className).toBe('tema-marca');
    expect(p.style['--sobre-marca']).toBe('#ffffff');
  });
});

describe('enlaceRed', () => {
  it('usuario -> URL base', () => {
    expect(enlaceRed('instagram', 'alejandromonroyf')).toBe('https://instagram.com/alejandromonroyf');
    expect(enlaceRed('instagram', '@juan')).toBe('https://instagram.com/juan');
  });
  it('URL completa se respeta', () => {
    expect(enlaceRed('facebook', 'https://fb.com/x')).toBe('https://fb.com/x');
  });
  it('vacío -> vacío', () => {
    expect(enlaceRed('tiktok', '')).toBe('');
  });
});
