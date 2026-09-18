import { useEffect, useRef, useState } from 'react';
import PhoneMockup from './PhoneMockup.jsx';
import DashboardMockup from './DashboardMockup.jsx';

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
    <svg viewBox="0 0 120 120" className="w-full h-full" fill="none">
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
    <svg viewBox="0 0 120 120" className="w-full h-full" fill="none">
      {/* Person 1 */}
      <circle cx="35" cy="40" r="12" fill="#16a34a" opacity="0.2"/>
      <circle cx="35" cy="35" r="8" fill="#16a34a"/>
      <rect x="25" y="48" width="20" height="25" rx="8" fill="#16a34a"/>
      <text x="35" y="55" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">J</text>

      {/* Person 2 */}
      <circle cx="60" cy="35" r="14" fill="#16a34a" opacity="0.3"/>
      <circle cx="60" cy="29" r="9" fill="#16a34a"/>
      <rect x="49" y="43" width="22" height="27" rx="9" fill="#16a34a"/>
      <text x="60" y="50" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">C</text>

      {/* Person 3 */}
      <circle cx="85" cy="40" r="12" fill="#16a34a" opacity="0.2"/>
      <circle cx="85" cy="35" r="8" fill="#16a34a"/>
      <rect x="75" y="48" width="20" height="25" rx="8" fill="#16a34a"/>
      <text x="85" y="55" textAnchor="middle" fill="white" fontSize="7" fontWeight="bold">M</text>

      {/* Connection lines */}
      <line x1="45" y1="55" x2="50" y2="55" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="3,2"/>
      <line x1="70" y1="55" x2="75" y2="55" stroke="#16a34a" strokeWidth="1.5" strokeDasharray="3,2"/>

      {/* Stats */}
      <rect x="15" y="85" width="90" height="25" rx="8" fill="#f0fdf4" stroke="#16a34a" strokeWidth="1"/>
      <text x="60" y="101" textAnchor="middle" fill="#16a34a" fontSize="9" fontWeight="bold">47 Clientes · 156 Visitas</text>
    </svg>
  );
}

function ChartSVG() {
  return (
    <svg viewBox="0 0 120 100" className="w-full h-full" fill="none">
      <rect x="5" y="5" width="110" height="90" rx="8" fill="#f0fdf4" stroke="#16a34a" strokeWidth="1"/>
      {/* Bars */}
      {[40, 65, 55, 80, 70, 90, 75].map((h, i) => (
        <g key={i}>
          <rect x={15 + i * 14} y={85 - h} width="10" height={h} rx="3" fill={i === 5 ? '#16a34a' : '#bbf7d0'}/>
          <text x={20 + i * 14} y={82 - h} textAnchor="middle" fill="#16a34a" fontSize="6" fontWeight="bold">
            {Math.round(h * 0.35)}
          </text>
        </g>
      ))}
      {/* Labels */}
      {['L', 'M', 'Mi', 'J', 'V', 'S', 'D'].map((d, i) => (
        <text key={i} x={20 + i * 14} y={95} textAnchor="middle" fill="#9ca3af" fontSize="7">{d}</text>
      ))}
    </svg>
  );
}

const features = [
  { icon: '📅', title: 'Calendario sin choques', desc: 'Se sincroniza con Google Calendar. Adiós a los turnos cruzados y a los huecos en la agenda.', svg: CalendarSVG },
  { icon: '💰', title: 'Tus servicios con precio claro', desc: 'Muestra qué haces, cuánto dura y cuánto cuesta. El cliente reserva sabiendo qué va a pagar en tu local.' },
  { icon: '👥', title: 'Todo tu equipo en un enlace', desc: 'Cada persona tiene su agenda y sus servicios, todo en un solo enlace para compartir.', svg: PeopleSVG },
  { icon: '📓', title: 'Tus clientes guardados', desc: 'TurnoBot guarda nombre y teléfono de quien reserva. Descarga la lista en Excel cuando quieras.' },
  { icon: '📊', title: 'Tu negocio desde el celular', desc: 'Mira cuántas citas tienes hoy y cuánto vas a recibir, estés donde estés.', svg: ChartSVG },
  { icon: '🔔', title: 'Avisos al instante', desc: 'Te llega un aviso al celular cada vez que un cliente confirma, cancela o no llega.' },
];

const steps = [
  { num: '1', title: 'Crea tu negocio', desc: 'Registra tu local en 2 minutos. Nombre, dirección y horarios.' },
  { num: '2', title: 'Agrega servicios', desc: 'Servicios personalizados con precios y duración.' },
  { num: '3', title: 'Configura tu equipo', desc: 'Cada profesional con sus horarios y especialidades.' },
  { num: '4', title: 'Comparte tu enlace', desc: 'Un link único para que tus clientes reserven 24/7.' },
];

const testimonials = [
  { name: 'Carlos M.', role: 'Centro de Estética en Bogotá', text: 'Antes perdía 4 clientes al día por no contestar WhatsApp. Ahora reservan solos. Transformó mi negocio.' },
  { name: 'María F.', role: 'Consultorio Odontológico en Medellín', text: 'Mis pacientes aman poder elegir el horario sin llamarme. Yo solo llego y atiendo.' },
  { name: 'Andrés L.', role: 'Auto Detailing en Cali', text: 'En 10 minutos lo configuré. No sabía nada de tecnología. Si sabes usar WhatsApp, sabes usar TurnoBot.' },
];

function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-green-500/10 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-green-500/5 rounded-full blur-3xl"></div>
      </div>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left: Text */}
          <div>
            <FadeIn>
              <div className="inline-flex items-center gap-2 bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-bold px-4 py-2 rounded-full mb-6 uppercase tracking-wider">
                <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
                La agenda que trabaja por ti 24/7
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight mb-6">
                Deja de perder clientes por no contestar <span className="text-green-400">WhatsApp</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="text-lg text-gray-400 max-w-lg mb-8 leading-relaxed">
                Tus clientes reservan solos, tú solo llegas y atiendes. Comparte tu enlace de TurnoBot en Instagram o WhatsApp y olvídate de cuadrar horarios manualmente. <span className="text-white font-semibold">Cero comisiones por reserva.</span>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="flex flex-col sm:flex-row gap-4">
                <a href="/register" className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all active:scale-95 shadow-lg shadow-green-500/25 min-h-[56px]">
                  Probar gratis 30 días
                </a>
                <a href="#demo" className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all border border-white/10 min-h-[56px]">
                  Ver cómo se ve
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-8 flex items-center gap-6 text-sm text-gray-500">
                <span>✓ 30 días de prueba</span>
                <span>✓ Sin tarjeta de crédito</span>
                <span>✓ Listo en 10 minutos</span>
              </div>
            </FadeIn>
          </div>

          {/* Right: Phone Mockup */}
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
    <section id="demo" className="bg-white py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Demo en vivo</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Así reservan tus clientes
            </h2>
            <p className="text-lg text-gray-500">
              Un enlace. Cinco pasos guiados. Cita confirmada. Sin llamadas ni mensajes de ida y vuelta.
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={200}>
          <div className="flex justify-center">
            <PhoneMockup />
          </div>
        </FadeIn>

        <FadeIn delay={400}>
          <div className="mt-16">
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
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">El Problema</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              ¿Cuánta plata pierdes al día por estar ocupado?
            </h2>
            <p className="text-lg text-gray-500">
              Mientras cortas el cabello o atiendes un paciente, no puedes responder el celular. El cliente se aburre, no espera y se va con la competencia.
            </p>
          </div>
        </FadeIn>

        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { icon: '⏳', stat: '60%', label: 'de los clientes agendan con el primero que responde.', delay: 0 },
            { icon: '💸', stat: '$25.000', label: 'pierdes por cada cliente que se va sin reservar.', delay: 150 },
            { icon: '🌙', stat: '24/7', label: 'tus clientes quieren reservar incluso a las 11 PM.', delay: 300 },
          ].map((item, i) => (
            <FadeIn key={i} delay={item.delay}>
              <div className="bg-white border border-gray-100 rounded-3xl p-8 text-center hover:shadow-lg transition-shadow">
                <div className="text-4xl mb-4">{item.icon}</div>
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
                  <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">{f.icon}</div>
                )}
                <h3 className="text-base font-bold text-gray-900 mb-2">{f.title}</h3>
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
    <section id="como-funciona" className="bg-gray-50 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Cómo funciona</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              En 10 minutos tu local está online
            </h2>
          </div>
        </FadeIn>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {steps.map((s, i) => (
            <FadeIn key={i} delay={i * 150}>
              <div className="text-center relative">
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-8 left-[60%] w-[80%] h-0.5 bg-green-200"></div>
                )}
                <div className="w-16 h-16 bg-green-500 text-white rounded-2xl flex items-center justify-center text-2xl font-black mx-auto mb-4 relative z-10 shadow-lg shadow-green-500/25">
                  {s.num}
                </div>
                <h3 className="text-base font-bold text-gray-900 mb-2">{s.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{s.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section className="bg-white py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Precio Simple</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Todo incluido. Sin sorpresas.
            </h2>
          </div>
        </FadeIn>

        <FadeIn delay={200}>
          <div className="bg-gray-50 border-2 border-green-500 rounded-3xl p-8 sm:p-12 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-green-500 text-white text-xs font-bold px-4 py-1.5 rounded-bl-2xl uppercase tracking-wider">
              30 DÍAS DE PRUEBA
            </div>
            <div className="text-center mb-8">
              <h3 className="text-2xl font-black text-gray-900 mb-2">Plan Ilimitado</h3>
              <p className="text-sm text-gray-500 mb-6">La herramienta definitiva para organizar tu local.</p>
              <p className="text-5xl font-black text-gray-900 mb-2">$49.900<span className="text-lg font-bold text-gray-400">/mes</span></p>
              <p className="text-xs text-gray-500 font-medium">Equivale a menos de un tinto al día ($1.660 COP). <strong>No cobramos comisiones.</strong></p>
            </div>
              <div className="grid sm:grid-cols-2 gap-4 mb-10 max-w-2xl mx-auto">
              <div className="flex items-center gap-3 text-sm text-gray-600"><span className="text-green-500 font-bold text-lg">✓</span> Personas ilimitadas en tu equipo</div>
              <div className="flex items-center gap-3 text-sm text-gray-600"><span className="text-green-500 font-bold text-lg">✓</span> Citas ilimitadas</div>
              <div className="flex items-center gap-3 text-sm text-gray-600"><span className="text-green-500 font-bold text-lg">✓</span> Lista de clientes descargable en Excel</div>
              <div className="flex items-center gap-3 text-sm text-gray-600"><span className="text-green-500 font-bold text-lg">✓</span> Tu enlace para reservar, 24/7</div>
              <div className="flex items-center gap-3 text-sm text-gray-600"><span className="text-green-500 font-bold text-lg">✓</span> Sincronización con Google Calendar</div>
              <div className="flex items-center gap-3 text-sm text-gray-600"><span className="text-green-500 font-bold text-lg">✓</span> Avisos al instante y control de no llegadas</div>
            </div>
            <div className="text-center">
              <a href="/register" className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-10 py-4 rounded-2xl text-base transition-all active:scale-95 shadow-lg shadow-green-500/25 min-h-[56px]">
                Probar gratis 30 días
              </a>
              <p className="text-xs text-gray-500 mt-4">Sin tarjeta de crédito. Cancela en cualquier momento.</p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function FAQSection() {
  const faqs = [
    {
      question: '¿Qué incluye el mes de prueba?',
      answer: 'Acceso al Plan Ilimitado durante 30 días: profesionales, citas, CRM, enlace público, Google Calendar y métricas.',
    },
    {
      question: '¿Mis clientes necesitan crear una cuenta?',
      answer: 'No. Tus clientes reservan desde tu enlace público ingresando únicamente sus datos de contacto.',
    },
    {
      question: '¿TurnoBot cobra comisión por cada reserva?',
      answer: 'No. Pagas la suscripción mensual de $49.900 COP y no cobramos comisión por las citas que recibes.',
    },
    {
      question: '¿Puedo administrar varios profesionales?',
      answer: 'Sí. Cada profesional puede tener sus propios horarios, servicios y disponibilidad.',
    },
    {
      question: '¿El cliente puede cambiar o cancelar su cita?',
      answer: 'Sí. El cliente ve sus citas con su número de WhatsApp y puede cancelarlas; el horario queda libre de inmediato. Como dueño también puedes cancelar o marcar “No llegó” desde tu agenda.',
    },
    {
      question: '¿Qué negocios pueden usar TurnoBot?',
      answer: 'Cualquier negocio que trabaje con citas: consultorios, salones, clínicas, talleres, veterinarias y más.',
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
            <p className="text-lg text-gray-500">
              Lo esencial para decidir si TurnoBot encaja en tu negocio.
            </p>
          </div>
        </FadeIn>

        <div className="grid md:grid-cols-2 gap-4">
          {faqs.map((faq, i) => (
            <FadeIn key={faq.question} delay={i * 75}>
              <details className="group h-full bg-gray-50 border border-gray-100 rounded-2xl p-5">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-sm font-bold text-gray-900">
                  {faq.question}
                  <span className="text-xl text-green-600 transition-transform group-open:rotate-45">+</span>
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

function TestimonialsSection() {
  return (
    <section className="bg-gray-50 py-20 sm:py-28">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeIn>
          <div className="text-center max-w-3xl mx-auto mb-16">
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Testimonios</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Lo que dicen nuestros usuarios
            </h2>
          </div>
        </FadeIn>

        <div className="grid sm:grid-cols-3 gap-6">
          {testimonials.map((t, i) => (
            <FadeIn key={i} delay={i * 150}>
              <div className="bg-white border border-gray-100 rounded-3xl p-6 hover:shadow-lg transition-shadow h-full">
                <div className="flex gap-1 mb-4">
                  {[...Array(5)].map((_, j) => <span key={j} className="text-yellow-400">★</span>)}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed mb-6 italic">"{t.text}"</p>
                <div>
                  <p className="text-sm font-bold text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.role}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection() {
  return (
    <section className="bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <FadeIn>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-black mb-6">
            ¿Listo para no perder más clientes?
          </h2>
          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto">
            Crea tu página de reservas hoy. Tienes 30 días de prueba sin costo.
          </p>
          <a href="/register" className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all active:scale-95 shadow-lg shadow-green-500/25 min-h-[56px]">
            Probar gratis 30 días
          </a>
          <p className="text-xs text-gray-500 mt-6">Sin tarjeta · Sin contrato · Cancela cuando quieras</p>
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
      <FeaturesSection />
      <HowItWorksSection />
      <PricingSection />
      <FAQSection />
      <TestimonialsSection />
      <CTASection />
      <Footer />
    </div>
  );
}
