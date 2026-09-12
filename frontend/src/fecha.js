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

// fechaHoraAUtc convierte 'YYYY-MM-DD' + 'HH:MM' en la zona del negocio a
// un Date UTC (para el .ics). Itera 2 veces para clavar el offset con DST.
export function fechaHoraAUtc(yyyymmdd, hhmm, timezone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(yyyymmdd || '');
  const h = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m || !h) return null;
  const tz = timezone || 'America/Bogota';
  const target = Date.UTC(+m[1], +m[2] - 1, +m[3], +h[1], +h[2]);
  let utc = target;
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    for (let i = 0; i < 2; i++) {
      const p = Object.fromEntries(dtf.formatToParts(new Date(utc)).map((x) => [x.type, x.value]));
      const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
      utc += target - asUTC;
    }
  } catch {
    // sin soporte de zona: se asume hora local del dispositivo
  }
  return new Date(utc);
}

const fICal = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
const escICal = (s) => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// descargarICS genera un .ics con la cita (recordatorios configurables,
// default 1 día y 2 horas antes) para "Añadir al calendario" sin backend.
export function descargarICS({ slug, servicio, profesional, fecha, hora, duracionMin, direccion, timezone, notas, reminderDias, reminderHoras }) {
  const inicio = fechaHoraAUtc(fecha, hora, timezone);
  if (!inicio) return;
  const fin = new Date(inicio.getTime() + (duracionMin || 60) * 60000);
  const uid = `${slug}-${fecha}-${hora.replace(':', '')}@turnobot`;
  const desc = [`${servicio} con ${profesional}`, notas ? `Notas: ${notas}` : '']
    .filter(Boolean).join('\\n');
  const alarmDesc = escICal('Recordatorio de cita');
  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Turnobot//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fICal(new Date())}`,
    `DTSTART:${fICal(inicio)}`,
    `DTEND:${fICal(fin)}`,
    `SUMMARY:${escICal(`${servicio} - ${profesional}`)}`,
    `DESCRIPTION:${escICal(desc)}`,
  ];
  if (direccion) {
    icsLines.push(`LOCATION:${escICal(direccion)}`);
  }
  const dias = Number(reminderDias) > 0 ? Number(reminderDias) : 1;
  const horas = Number(reminderHoras) > 0 ? Number(reminderHoras) : 2;
  icsLines.push(
    'BEGIN:VALARM',
    `TRIGGER:-P${dias}D`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${alarmDesc}`,
    'END:VALARM',
    'BEGIN:VALARM',
    `TRIGGER:-PT${horas}H`,
    'ACTION:DISPLAY',
    `DESCRIPTION:${alarmDesc}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  const ics = icsLines.join('\r\n');
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar; charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `cita-${fecha}-${hora.replace(':', '')}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
