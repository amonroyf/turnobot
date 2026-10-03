// Tabla compartida de países (Fase A multi-país LatAm + ES/US).
// Cada negocio guarda `pais` (ISO) y de aquí se derivan prefijo telefónico,
// moneda y locale. Colombia es el default donde falte el dato.
export const PAISES = [
  { iso: 'CO', bandera: '🇨🇴', nombre: 'Colombia', prefijo: '57', moneda: 'COP', locale: 'es-CO', ejemplo: '300 123 4567', minDigitos: 10 },
  { iso: 'MX', bandera: '🇲🇽', nombre: 'México', prefijo: '52', moneda: 'MXN', locale: 'es-MX', ejemplo: '55 1234 5678', minDigitos: 10 },
  { iso: 'PE', bandera: '🇵🇪', nombre: 'Perú', prefijo: '51', moneda: 'PEN', locale: 'es-PE', ejemplo: '999 888 777', minDigitos: 9 },
  { iso: 'CL', bandera: '🇨🇱', nombre: 'Chile', prefijo: '56', moneda: 'CLP', locale: 'es-CL', ejemplo: '9 1234 5678', minDigitos: 9 },
  { iso: 'AR', bandera: '🇦🇷', nombre: 'Argentina', prefijo: '54', moneda: 'ARS', locale: 'es-AR', ejemplo: '11 1234 5678', minDigitos: 10 },
  { iso: 'EC', bandera: '🇪🇨', nombre: 'Ecuador', prefijo: '593', moneda: 'USD', locale: 'es-EC', ejemplo: '99 123 4567', minDigitos: 9 },
  { iso: 'UY', bandera: '🇺🇾', nombre: 'Uruguay', prefijo: '598', moneda: 'UYU', locale: 'es-UY', ejemplo: '99 123 456', minDigitos: 8 },
  { iso: 'PY', bandera: '🇵🇾', nombre: 'Paraguay', prefijo: '595', moneda: 'PYG', locale: 'es-PY', ejemplo: '981 123456', minDigitos: 9 },
  { iso: 'BO', bandera: '🇧🇴', nombre: 'Bolivia', prefijo: '591', moneda: 'BOB', locale: 'es-BO', ejemplo: '70123456', minDigitos: 8 },
  { iso: 'CR', bandera: '🇨🇷', nombre: 'Costa Rica', prefijo: '506', moneda: 'CRC', locale: 'es-CR', ejemplo: '8888 8888', minDigitos: 8 },
  { iso: 'PA', bandera: '🇵🇦', nombre: 'Panamá', prefijo: '507', moneda: 'PAB', locale: 'es-PA', ejemplo: '6123 4567', minDigitos: 8 },
  { iso: 'DO', bandera: '🇩🇴', nombre: 'Rep. Dominicana', prefijo: '1', moneda: 'DOP', locale: 'es-DO', ejemplo: '809 123 4567', minDigitos: 10 },
  { iso: 'GT', bandera: '🇬🇹', nombre: 'Guatemala', prefijo: '502', moneda: 'GTQ', locale: 'es-GT', ejemplo: '5123 4567', minDigitos: 8 },
  { iso: 'ES', bandera: '🇪🇸', nombre: 'España', prefijo: '34', moneda: 'EUR', locale: 'es-ES', ejemplo: '612 345 678', minDigitos: 9 },
  { iso: 'US', bandera: '🇺🇸', nombre: 'EE. UU.', prefijo: '1', moneda: 'USD', locale: 'en-US', ejemplo: '(555) 123-4567', minDigitos: 10 },
];

const POR_ISO = Object.fromEntries(PAISES.map((p) => [p.iso, p]));

export const PAIS_DEFAULT = 'CO';

export function paisPorISO(iso) {
  return POR_ISO[(iso || '').toUpperCase()] || POR_ISO[PAIS_DEFAULT];
}

export function prefijoPorPais(iso) {
  return paisPorISO(iso).prefijo;
}

// formatoMoneda: 20000 + 'MX' -> "$20,000.00"; 20000 + 'CO' -> "$ 20.000".
// Fase A: sin centavos en el modelo (precios enteros), se muestra sin
// decimales en todas las monedas.
export function formatoMoneda(valor, paisISO) {
  const p = paisPorISO(paisISO);
  const n = Number(valor || 0);
  try {
    return new Intl.NumberFormat(p.locale, {
      style: 'currency',
      currency: p.moneda,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${n.toLocaleString('es-CO')}`;
  }
}

// digitosConPrefijo: pega el prefijo si el número viene local.
// ("3001234567", "CO") -> "573001234567".
export function digitosConPrefijo(digitos, paisISO) {
  const d = (digitos || '').replace(/\D/g, '');
  const pref = prefijoPorPais(paisISO);
  return d.startsWith(pref) ? d : pref + d;
}
