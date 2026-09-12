// Utilidades de fecha/hora y teléfono para mostrar datos legibles.
// Todas las fechas de negocio viajan como 'YYYY-MM-DD' (sin hora) para no
// depender de la zona horaria del dispositivo.

const ZONA_DEFAULT = 'America/Bogota';

// fechaHoyEnZona devuelve hoy ('YYYY-MM-DD') en la zona del negocio.
export function fechaHoyEnZona(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || ZONA_DEFAULT,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }
}

// sumarDias suma n días a una fecha 'YYYY-MM-DD'.
export function sumarDias(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

// formatearFechaLarga: '2026-09-13' -> 'Sábado 13 de septiembre'.
export function formatearFechaLarga(yyyymmdd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd || '');
  if (!m) return yyyymmdd || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const s = new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// diaKeyEnZona: ms epoch -> 'YYYY-MM-DD' en la zona del negocio.
export function diaKeyEnZona(ms, timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || ZONA_DEFAULT,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

// horaEnZona: ms epoch -> 'HH:MM' (24h) en la zona del negocio.
export function horaEnZona(ms, timezone) {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      timeZone: timezone || ZONA_DEFAULT,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(ms));
  } catch {
    return '';
  }
}

// formatearTelefono: '+573001234567' -> '300 123 4567' (solo visual;
// para enlaces wa.me se sigue usando el valor crudo con dígitos).
export function formatearTelefono(tel) {
  const d = (tel || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) {
    return `${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  }
  if (d.length === 10) {
    return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  }
  return tel || '';
}
