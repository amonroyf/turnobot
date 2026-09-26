import { useEffect, useRef, useState } from 'react';
import PhoneMockup from './PhoneMockup.jsx';
import DashboardMockup from './DashboardMockup.jsx';
import EmployeeMockup from './EmployeeMockup.jsx';

// Hook para animaciones fade-in on scroll
function useInView(ref, options = {}) {
  const [isInView, setIsInView] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsInView(true);
        observer.disconnect();
      }
    }, { threshold: 0.1, ...options });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return isInView;
}

function FadeIn({ children, delay = 0, className = '' }) {
  const ref = useRef();
  const isInView = useInView(ref);
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ${isInView ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// SVG Illustrations
function CalendarSVG() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" aria-hidden="true">
      <rect x="10" y="20" width="100" height="85" rx="12" fill="#f0fdf4" stroke="#16a34a" strokeWidth="2"/>
      <rect x="10" y="20" width="100" height="25" rx="12" fill="#16a34a"/>
      <rect x="10" y="33" width="100" height="12" fill="#16a34a"/>
      <circle cx="35" cy="15" r="4" fill="#16a34a"/>
      <circle cx="85" cy="15" r="4" fill="#16a34a"/>
      <text x="60" y="38" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">SEPTIEMBRE</text>
      {[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map((d, i) => (
        <g key={d}>
          <rect x={15 + (i % 5) * 20} y={55 + Math.floor(i / 5) * 18} width="16" height="14" rx="4"
            fill={d === 15 ? '#16a34a' : d <= 13 ? '#f0fdf4' : '#fafafa'}
            stroke={d === 15 ? '#16a34a' : '#e5e7eb'} strokeWidth="1"/>
          <text x={23 + (i % 5) * 20} y={65 + Math.floor(i / 5) * 18}
            textAnchor="middle" fill={d === 15 ? 'white' : d <= 13 ? '#374151' : '#d1d5db'}
            fontSize="8" fontWeight={d === 15 ? 'bold' : 'normal'}>{d}</text>
        </g>
      ))}
    </svg>
  );
}

function PeopleSVG() {
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full" fill="none" aria-hidden="true">
      <circle cx="35" cy="40" r="12" fill="#16a34a" opacity="0.2"/>
      <circle cx="35" cy="35" r="8" fill="#16a34a"/>
      <rect x="25" y="48" width="20" height="25" rx="8" fill="#16a34a"/>
      <text x="35" y="55" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">J</text>
      <circle cx="60" cy="35" r="14" fill="#16a34a" opacity="0.3"/>
      <circle cx="60" cy="29" r="9" fill="#16a34a"/>
      <rect x="49" y="43" width="22" height="27" rx="9" fill="#16a34a"/>
      <text x="60" y="50" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">C</text>
      <circle cx="85" cy="40" r="12" fill="#16a34a" opacity="0.2"/>
      <circle cx="85" cy="35" r="8" fill="#16a34a"/>
      <rect x="75" y="48" width="20" height="25" rx="8" fill="#16a34a"/>
      <text x="85" y="55" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">M</text>
      <line x1="45" y1="55" x2="50" y2="55" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="3,2"/>
      <line x1="70" y1="55" x2="75" y2="55" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="3,2"/>
      <rect x="15" y="85" width="90" height="25" rx="8" fill="#f0fdf4" stroke="#16a34a" strokeWidth="1"/>
      <text x="60" y="101" textAnchor="middle" fill="#16a34a" fontSize="9" fontWeight="bold">47 Clientes · 156 Visitas</text>
    </svg>
  );
}

function ChartSVG() {
  return (
    <svg viewBox="0 0 120 100" className="w-full h-full" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="110" height="90" rx="8" fill="#f0fdf4" stroke="#16a34a" strokeWidth="1"/>
      {[40, 65, 55, 80, 70, 90, 75].map((h, i) => (
        <g key={i}>
          <rect x={15 + i * 14} y={85 - h} width="10" height={h} rx="3" fill={i === 5 ? '#16a34a' : '#bbf7d0'}/>
          <text x={20 + i * 14} y={82 - h} textAnchor="middle" fill="#16a34a" fontSize="6" fontWeight="bold">
            {Math.round(h * 0.35)}
          </text>
        </g>
      ))}
      {['L', 'M', 'Mi', 'J', 'V', 'S', 'D'].map((d, i) => (
        <text key={i} x={20 + i * 14} y={95} textAnchor="middle" fill="#9ca3af" fontSize="7">{d}</text>
      ))}
    </svg>
  );
}

// CTA único en toda la landing: un solo texto, un solo destino.
function CTAPrincipal({ secundario = false, texto = 'Crear mi página gratis' }) {
  if (secundario) {
    return (
      <a href="#demo" className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all border border-white/10 min-h-[56px]">
        Ver cómo se ve
      </a>
    );
  }
  return (
    <a href="/register" className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all active:scale-95 shadow-lg shadow-green-500/25 min-h-[56px]">
      {texto}
    </a>
  );
}

const features = [
  { icon: '📅', title: 'Calendario sin choques', desc: 'Se sincroniza con Google Calendar. Adiós a los turnos cruzados y a los huecos en la agenda.', svg: CalendarSVG },
  { icon: '💰', title: 'Servicios y espacios con precio claro', desc: 'Servicios 1 a 1 con duración y precio. Y espacios por cupos con barra de ocupación (ej: 12/30) y lista por persona.', svg: null },
  { icon: '📝', title: 'Registro manual sin fricción', desc: 'Te llaman o te escriben por WhatsApp y lo anotas con “Nueva cita”: mismo flujo que el cliente, sin pedirle que se registre.', svg: null },
  { icon: '👥', title: 'Portal autónomo para tu equipo', desc: 'Cada persona entra con PIN: ve solo su agenda, cambia su horario y su clave, mueve citas y escribe al cliente por WhatsApp.', svg: PeopleSVG },
  { icon: '🔐', title: 'Reserva con Google + autogestión', desc: 'El cliente confirma con su cuenta de Google y luego ve, cancela o mueve solo sus citas. Nadie toca citas ajenas.', svg: null },
  { icon: '🔔', title: 'Avisos, recordatorios y tu marca', desc: 'Aviso al instante cuando confirman, cancelan o no llegan, más recordatorios automáticos. Todo con tu color y tu nombre.', svg: ChartSVG },
];

const steps = [
  { num: '1', title: 'Crea tu negocio', desc: 'Nombre, dirección y horarios. Tu enlace queda listo para compartir.' },
  { num: '2', title: 'Agrega servicios y espacios', desc: 'Servicios con precio y duración. Espacios con cupos e info libre.' },
  { num: '3', title: 'Configura tu equipo', desc: 'Cada persona con sus horarios, servicios y PIN de acceso.' },
  { num: '4', title: 'Comparte tu enlace', desc: 'Un link único. Tus clientes reservan solos, 24/7.' },
];

function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-green-500/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-green-500/5 rounded-full blur-3xl"></div>
      </div>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <FadeIn>
              <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold px-4 py-2 rounded-full mb-6 uppercase tracking-wider">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                Tu agenda online 24/7
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight mb-6">
                Recibe reservas <span className="text-green-400">sin contestar mensajes</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="text-lg text-gray-400 max-w-lg mb-6 leading-relaxed">
                Comparte tu enlace y el cliente reserva solo día y hora. Si te llaman o te escriben, lo registras en 30 segundos. <span className="text-white font-semibold">Todo queda ordenado en tu celular.</span>
              </p>
              <ul className="max-w-lg mb-8 space-y-2 text-sm text-gray-300">
                <li className="flex gap-2"><span className="text-green-400 font-bold">✓</span> Sin cruces: se conecta con tu Google Calendar.</li>
                <li className="flex gap-2"><span className="text-green-400 font-bold">✓</span> Botón Nueva cita para llamadas y WhatsApp.</li>
                <li className="flex gap-2"><span className="text-green-400 font-bold">✓</span> Sirve para citas 1 a 1 y para grupos por cupos.</li>
              </ul>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="flex flex-col sm:flex-row gap-4">
                <CTAPrincipal />
                <CTAPrincipal secundario />
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-gray-500">
                <span>✓ Sin tarjeta de crédito</span>
                <span>✓ Listo en 10 minutos</span>
                <span>✓ Cancela cuando quieras</span>
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={200} className="hidden lg:block">
            <PhoneMockup />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

function DemoSection() {
  return (
    <section id="demo" className="bg-white py-20 sm:py-28 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Demo en vivo</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Mira cómo se ve
            </h2>
            <p className="text-lg text-gray-500">
              Lo que ve tu cliente y lo que ves tú. Sin llamadas ni mensajes de ida y vuelta.
            </p>
          </div>
        </FadeIn>
        <FadeIn delay={200}>
          <h3 className="text-xl font-black text-gray-900 mb-2 text-center">Así reservan tus clientes</h3>
          <p className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6 text-center">Un enlace · pasos guiados · cita confirmada</p>
          <div className="flex flex-col sm:flex-row justify-center items-center gap-8">
            <div className="text-center">
              <PhoneMockup modo="servicio" />
              <p className="text-xs font-bold text-gray-400 mt-4 uppercase tracking-wider">Servicio 1 a 1</p>
            </div>
            <div className="text-center">
              <PhoneMockup modo="espacio" />
              <p className="text-xs font-bold text-gray-400 mt-4 uppercase tracking-wider">Espacio por cupos</p>
            </div>
          </div>
        </FadeIn>
        <FadeIn delay={400}>
          <div className="mt-16 text-center">
            <h3 className="text-xl font-black text-gray-900 mb-2">Así ves tu negocio</h3>
            <p className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">Tu panel de dueño · citas, espacios y clientes</p>
            <DashboardMockup />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function ProblemSection() {
  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">El problema</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Mientras atiendes, nadie responde por ti
            </h2>
            <p className="text-lg text-gray-500">
              Estás ocupado atendiendo y no puedes contestar. El cliente no espera: reserva con el primero que le responde.
            </p>
          </div>
        </FadeIn>
        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { icon: '⏳', stat: '60%', label: 'de los clientes agendan con el primero que responde.', delay: 0 },
            { icon: '💸', stat: '1 cliente', label: 'que se va sin reservar ya es plata perdida del día.', delay: 150 },
            { icon: '🌙', stat: '24/7', label: 'tus clientes quieren reservar incluso a las 11 PM.', delay: 300 },
          ].map((item, i) => (
            <FadeIn key={i} delay={item.delay}>
              <div className="bg-white border border-gray-100 rounded-3xl p-8 text-center hover:shadow-lg transition-shadow h-full">
                <div className="text-4xl mb-4" aria-hidden="true">{item.icon}</div>
                <p className="text-3xl font-black text-gray-900 mb-2">{item.stat}</p>
                <p className="text-sm text-gray-500 font-medium">{item.label}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

// NUEVO: por tipo de negocio, según los 2 modos reales del código:
// - Modo servicio: servicio + profesional (cita 1 a 1)
// - Modo espacio: recurso por cupos (cancha, box, sala, camilla, clase, consultorio)
function TiposNegocioSection() {
  const modos = [
    {
      icon: '📋',
      tag: 'Modo 1 · Cita con profesional',
      title: 'Servicios 1 a 1',
      desc: 'El cliente elige servicio → profesional → día → hora → confirma. Ideal cuando atiende una persona a la vez.',
      ejemplos: ['Barbería · corte con José', 'Estética · limpieza 60 min', 'Consultorio · cita con doctora', 'Veterinaria · control', 'Taller · revisión'],
      pie: 'Precio y duración visibles. Se sincroniza con Google Calendar.',
    },
    {
      icon: '📍',
      tag: 'Modo 2 · Cupo en espacio',
      title: 'Espacios por cupos',
      desc: 'El cliente elige espacio → día → hora → confirma. Sin elegir profesional. Ideal para grupos y canchas.',
      ejemplos: ['Clase 🧘 · Crossfit 18:00 ¡Quedan 3!', 'Cancha ⚽ · Fútbol 12/30', 'Box 🔧 · Funcional 15/25', 'Sala 🎶 · Ensayo 1/6', 'Camilla 💆 · Spa'],
      pie: 'Una sola tarjeta por horario con barra de ocupación y lista por persona.',
    },
  ];
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-12">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Para qué negocios sirve</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Si se reserva, cabe en TurnoBot
            </h2>
            <p className="text-lg text-gray-500">
              Tienes 2 formas de reservar. Se activan solas según lo que crees: si creas espacios, aparece el modo espacio.
            </p>
          </div>
        </FadeIn>
        <div className="grid md:grid-cols-2 gap-6">
          {modos.map((m, i) => (
            <FadeIn key={i} delay={i * 150}>
              <div className="bg-gray-50 border border-gray-100 rounded-3xl p-8 h-full flex flex-col relative overflow-hidden">
                {i === 0 && (
                  <div className="absolute top-0 right-0 bg-gray-900 text-white text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider">Ideal profesionales</div>
                )}
                {i === 1 && (
                  <div className="absolute top-0 right-0 bg-green-500 text-white text-[10px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-wider">Ideal instructores</div>
                )}
                <div className="text-4xl mb-4" aria-hidden="true">{m.icon}</div>
                <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-2">{m.tag}</p>
                <h3 className="text-xl font-black text-gray-900 mb-3">{m.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed mb-5">{m.desc}</p>
                <ul className="space-y-2 mb-5">
                  {m.ejemplos.map((e) => (
                    <li key={e} className="text-sm text-gray-700 bg-white border border-gray-200 rounded-xl px-3 py-2 font-medium">{e}</li>
                  ))}
                </ul>
                <p className="text-xs text-gray-500 font-medium mt-auto pt-4 border-t border-gray-200">{m.pie}</p>
              </div>
            </FadeIn>
          ))}
        </div>
        <FadeIn delay={200}>
          <p className="text-center text-sm text-gray-500 mt-8">
            ¿Tienes ambos? Ej: salón con servicios + sala de clases. Se combinan en el mismo enlace.
          </p>
        </FadeIn>
      </div>
    </section>
  );
}

// NUEVO: explicación por rol (por app). Jerarquía: cliente → dueño → equipo.
function PorRolSection() {
  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Cómo funciona por rol</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Tres vistas, cero enredos
            </h2>
            <p className="text-lg text-gray-500">
              Cada persona ve solo lo que necesita. Tú mantienes el control.
            </p>
          </div>
        </FadeIn>

        <div className="space-y-6">
          {/* 1. Cliente */}
          <FadeIn>
            <div className="grid lg:grid-cols-2 gap-8 items-center bg-white border border-gray-100 rounded-3xl p-8 sm:p-12">
              <div>
                <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-3">📱 Para tus clientes</p>
                <h3 className="text-xl font-black text-gray-900 mb-4">Reservan solos en 1 minuto</h3>
                <ul className="space-y-3 text-sm text-gray-600 leading-relaxed">
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Abren tu enlace y eligen: servicio o espacio.</li>
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Eligen profesional, día y hora disponible. Ven precio y duración antes de confirmar.</li>
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Confirman con su cuenta de Google. Sin crear contraseñas nuevas.</li>
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Gestionan solos: ven, cancelan o mueven su cita. El horario se libera al instante.</li>
                </ul>
              </div>
              <div className="bg-white border border-gray-200 rounded-2xl p-6">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Lo que ve tu cliente</p>
                <ol className="space-y-2 text-sm font-medium text-gray-700">
                  <li className="flex gap-3 items-center"><span className="w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-black flex items-center justify-center">1</span> Elige servicio o espacio</li>
                  <li className="flex gap-3 items-center"><span className="w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-black flex items-center justify-center">2</span> Elige profesional <span className="text-xs font-normal text-gray-400">(solo en servicios)</span></li>
                  <li className="flex gap-3 items-center"><span className="w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-black flex items-center justify-center">3</span> Elige día y hora</li>
                  <li className="flex gap-3 items-center"><span className="w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-black flex items-center justify-center">4</span> Confirma con Google</li>
                </ol>
              </div>
            </div>
          </FadeIn>

          {/* 2. Dueño */}
          <FadeIn delay={150}>
            <div className="grid lg:grid-cols-2 gap-8 items-center bg-gray-900 text-white rounded-3xl p-8 sm:p-12">
              <div>
                <p className="text-xs font-black text-green-400 uppercase tracking-widest mb-3">🧑‍💼 Para ti (dueño)</p>
                <h3 className="text-xl font-black mb-4">Tu negocio desde el celular</h3>
                <ul className="space-y-3 text-sm text-gray-300 leading-relaxed">
                  <li className="flex gap-3"><span className="text-green-400 font-bold">✓</span> Agenda sin choques, sincronizada con Google Calendar.</li>
                  <li className="flex gap-3"><span className="text-green-400 font-bold">✓</span> Botón “Nueva cita”: anotas por llamada o WhatsApp sin pedirle nada al cliente.</li>
                  <li className="flex gap-3"><span className="text-green-400 font-bold">✓</span> Espacios por cupos en una sola tarjeta con ocupación y lista por persona.</li>
                  <li className="flex gap-3"><span className="text-green-400 font-bold">✓</span> Clientes guardados con nombre y teléfono, descargables en Excel.</li>
                  <li className="flex gap-3"><span className="text-green-400 font-bold">✓</span> Tu marca: color, nombre y encabezado propios en tu enlace.</li>
                </ul>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Tu control diario</p>
                <div className="grid grid-cols-3 gap-2 text-center mb-4">
                  {[['Hoy', '4'], ['Mañana', '2'], ['Clientes', '47']].map(([l, v]) => (
                    <div key={l} className="bg-white/10 rounded-xl p-3">
                      <p className="text-[11px] text-gray-400">{l}</p>
                      <p className="text-xl font-black">{v}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">Avisos al instante cuando confirman, cancelan o no llegan. Marcas “No llegó” y el horario queda registrado.</p>
              </div>
            </div>
          </FadeIn>

          {/* 3. Equipo */}
          <FadeIn delay={300}>
            <div className="grid lg:grid-cols-2 gap-8 items-center bg-white border border-gray-100 rounded-3xl p-8 sm:p-12">
              <div>
                <p className="text-xs font-black text-green-600 uppercase tracking-widest mb-3">👥 Para tu equipo</p>
                <h3 className="text-xl font-black text-gray-900 mb-4">Autónomos, sin ver lo ajeno</h3>
                <ul className="space-y-3 text-sm text-gray-600 leading-relaxed">
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Entran con PIN. Ven solo su agenda, no la de otros.</li>
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Cambian su horario y su clave sin pedirte ayuda.</li>
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Mueven citas, ven el teléfono del cliente y abren WhatsApp.</li>
                  <li className="flex gap-3"><span className="text-green-500 font-bold">✓</span> Ven sus números: citas activas y no-llegadas.</li>
                </ul>
              </div>
              <EmployeeMockup />
            </div>
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

function FeaturesSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Todo lo que necesitas</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Un sistema completo. No una app genérica.
            </h2>
          </div>
        </FadeIn>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <FadeIn key={i} delay={i * 100}>
              <div className="bg-gray-50 border border-gray-100 rounded-3xl p-6 hover:shadow-lg hover:border-green-200 transition-all group h-full">
                {f.svg ? (
                  <div className="w-20 h-20 mb-4 group-hover:scale-110 transition-transform">
                    <f.svg />
                  </div>
                ) : (
                  <div className="text-4xl mb-4 group-hover:scale-110 transition-transform" aria-hidden="true">{f.icon}</div>
                )}
                <h3 className="text-xl font-bold text-gray-900 mb-2">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function HowItWorksSection() {
  return (
    <section id="como-funciona" className="bg-gray-50 py-20 sm:py-28 scroll-mt-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Cómo funciona</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              En 10 minutos tu negocio está online
            </h2>
          </div>
        </FadeIn>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((s, i) => (
            <FadeIn key={i} delay={i * 150}>
              <div className="text-center relative h-full">
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-green-200" aria-hidden="true"></div>
                )}
                <div className="w-16 h-16 bg-green-500 text-white rounded-2xl flex items-center justify-center text-xl font-black mx-auto mb-4 relative z-10 shadow-lg shadow-green-500/25">
                  {s.num}
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
        <FadeIn delay={300}>
          <div className="text-center mt-12">
            <CTAPrincipal />
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function FAQSection() {
  const faqs = [
    {
      question: '¿Mis clientes necesitan crear una cuenta?',
      answer: 'No. Abren tu enlace, confirman con su cuenta de Google y listo. Sin contraseñas nuevas ni apps por descargar.',
    },
    {
      question: '¿El cliente puede cambiar o cancelar su cita?',
      answer: 'Sí. Ve solo sus citas y puede cancelarlas o moverlas. El horario queda libre de inmediato. Tú también puedes cancelar o marcar “No llegó” desde tu agenda.',
    },
    {
      question: '¿Puedo anotar citas por llamada o WhatsApp?',
      answer: 'Sí. Con “Nueva cita” agendas por el cliente con el mismo flujo (servicio o espacio → profesional → día → hora → datos). Ideal cuando te llaman y no quieres perder la reserva.',
    },
    {
      question: '¿Cómo funcionan los espacios por cupos?',
      answer: 'Creas el espacio con su capacidad e info libre. Las reservas del mismo horario se agrupan en una sola tarjeta con ocupación y lista por persona. Sin 30 tarjetas separadas.',
    },
    {
      question: '¿Mi equipo ve toda la agenda?',
      answer: 'No. Cada persona entra con PIN y ve solo su agenda. Puede cambiar su horario y su clave, mover sus citas y contactar al cliente. Tú ves todo.',
    },
    {
      question: '¿Qué negocios pueden usar TurnoBot?',
      answer: 'Cualquier negocio que trabaje con citas o cupos: servicios 1 a 1, clases grupales, espacios por capacidad y equipos con varios profesionales.',
    },
  ];

  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Preguntas frecuentes</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Todo claro antes de empezar
            </h2>
          </div>
        </FadeIn>
        <div className="grid md:grid-cols-2 gap-4">
          {faqs.map((faq, i) => (
            <FadeIn key={faq.question} delay={i * 75}>
              <details className="group h-full bg-gray-50 border border-gray-100 rounded-2xl p-5">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-sm font-bold text-gray-900">
                  {faq.question}
                  <span className="text-xl text-green-600 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="text-sm text-gray-500 leading-relaxed mt-3">{faq.answer}</p>
              </details>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="bg-gradient-to-br from-gray-900 to-black rounded-[2.5rem] p-10 sm:p-16 text-center text-white shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-green-500/10 rounded-full blur-3xl opacity-50 transform translate-y-1/2" aria-hidden="true"></div>
            <div className="relative z-10">
              <h2 className="text-3xl sm:text-4xl font-black mb-6">
                Tu negocio merece verse así de profesional.
              </h2>
              <p className="text-lg text-gray-400 mb-10 max-w-xl mx-auto">
                Crea tu página, configura tus servicios o clases y comparte tu enlace por WhatsApp en menos de 10 minutos.
              </p>
              <CTAPrincipal texto="Crear mi página ahora →" />
              <div className="mt-8 max-w-sm mx-auto bg-white/5 border border-white/10 rounded-2xl p-5 flex items-center gap-4 text-left">
                <img src="/alejandro-monroy.png" alt="Alejandro Monroy, creador de TurnoBot" className="w-14 h-14 rounded-full object-cover border-2 border-green-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-black text-white">Alejandro Monroy</p>
                  <p className="text-xs text-gray-400">Creador de TurnoBot · te ayudo a montarlo</p>
                  <a href="https://wa.me/573229124517?text=Hola%20Alejandro%2C%20tengo%20una%20pregunta%20sobre%20TurnoBot" target="_blank" rel="noreferrer" className="text-xs font-bold text-green-400 hover:text-green-300 mt-1 inline-block">
                    💬 +57 322 912 4517 · Lun–Sáb 9am–6pm
                  </a>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-4">Sin tarjeta · Sin contrato · Cancela cuando quieras</p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-black text-gray-500 py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-6">
          <div>
            <p className="text-white font-black text-lg">TurnoBot ✨</p>
            <p className="text-xs mt-1">Agendamiento en línea para negocios de servicios</p>
            <a href="https://wa.me/573229124517?text=Hola%20Alejandro%2C%20tengo%20una%20pregunta%20sobre%20TurnoBot" target="_blank" rel="noreferrer" className="text-xs mt-2 inline-block text-green-400 hover:text-green-300 font-bold">
              💬 Alejandro Monroy · +57 322 912 4517
            </a>
          </div>
          <div className="flex gap-6 text-sm">
            <a href="/" className="hover:text-white transition-colors">Inicio</a>
            <a href="/admin" className="hover:text-white transition-colors">Entrar a mi panel</a>
            <a href="/register" className="hover:text-white transition-colors">Crear mi página</a>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-8 pt-8 text-center text-xs text-gray-600">
          © 2026 TurnoBot. Hecho con ❤️ en Colombia 🇨🇴
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white font-sans antialiased">
      <HeroSection />
      <DemoSection />
      <ProblemSection />
      <TiposNegocioSection />
      <PorRolSection />
      <FeaturesSection />
      <HowItWorksSection />
      <FAQSection />
      <CTASection />
      <Footer />
    </div>
  );
}
