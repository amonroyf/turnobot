// Marca del negocio: identidad visual + propósito sin subir fotos.
// Conceptos: sistema de diseño por tokens (--marca), contraste automático
// (texto legible sobre cualquier color) y degradados CSS como portada.

// Colores curados por rubro (dueño fácil: elige, no diseña). '' = clásico B/N.
export const COLORES_MARCA = [
  { id: 'clasico', nombre: 'Clásico', color: '' },
  { id: 'barberia', nombre: 'Barbería', color: '#B45309' },
  { id: 'spa', nombre: 'Spa', color: '#047857' },
  { id: 'clinica', nombre: 'Clínica', color: '#1D4ED8' },
  { id: 'unas', nombre: 'Uñas', color: '#DB2777' },
  { id: 'cancha', nombre: 'Deporte', color: '#16A34A' },
  { id: 'tinta', nombre: 'Tinta', color: '#7C3AED' },
  { id: 'cafe', nombre: 'Café', color: '#92400E' },
];

export const colorMarca = (negocio) => (negocio?.marca?.color || '').trim();

// Texto legible sobre el color (luminancia): negro en claros, blanco en oscuros.
export function textoSobreMarca(color) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(color || '');
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111827' : '#ffffff';
}

// Inicial del negocio para el avatar (como el fallback de Vagaro).
export function inicialMarca(nombre) {
  const l = (nombre || 'T').trim().charAt(0).toUpperCase();
  return l || 'T';
}

// Fondo de portada: degradado del color (sin imágenes).
export function fondoMarca(color) {
  if (!color) return undefined;
  return `linear-gradient(135deg, ${color} 0%, ${color}CC 60%, ${color}99 100%)`;
}

// Props CSS para tematizar un contenedor con el color de marca.
// Uso: <div {...temaMarcaProps(negocio)}>...</div>
export function temaMarcaProps(negocio) {
  const color = colorMarca(negocio);
  if (!color) return {};
  return {
    className: 'tema-marca',
    style: { '--marca': color, '--sobre-marca': textoSobreMarca(color) },
  };
}

// Enlace de red social: acepta @usuario o URL completa.
export function enlaceRed(red, valor) {
  const v = (valor || '').trim().replace(/^@/, '');
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (v.includes('/') || v.includes('.')) return `https://${v}`;
  const base = { instagram: 'https://instagram.com/', facebook: 'https://facebook.com/', tiktok: 'https://tiktok.com/@' }[red] || 'https://';
  return base + v;
}
