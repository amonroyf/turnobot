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
  { icon: '📅', title: 'Calendario Inteligente', desc: 'Horarios reales por barbero. Sin doble reserva. Sin confusiones.', svg: CalendarSVG },
  { icon: '💰', title: 'Servicios y Precios', desc: 'Tus clientes ven todo antes de reservar. Transparencia total.' },
  { icon: '👤', title: 'Equipo Organizado', desc: 'Cada barbero con su horario, servicios y especialidad.', svg: PeopleSVG },
  { icon: '👥', title: 'CRM Automático', desc: 'Registro de visitas, gasto y fidelidad de cada cliente.' },
  { icon: '📊', title: 'Panel de Control', desc: 'Agenda, clientes, servicios y estadísticas en un solo lugar.', svg: ChartSVG },
  { icon: '📱', title: 'Notificaciones', desc: 'Alerta al momento de cada reserva. Sin perderte nada.' },
];

const steps = [
  { num: '1', title: 'Crea tu negocio', desc: 'Registra tu barbería en 2 minutos. Nombre, dirección y horarios.' },
  { num: '2', title: 'Agrega servicios', desc: 'Corte, barba, Cejas... con precios y duración.' },
  { num: '3', title: 'Configura tu equipo', desc: 'Cada barbero con sus horarios y especialidades.' },
  { num: '4', title: 'Comparte tu enlace', desc: 'Un link único para que tus clientes reserven 24/7.' },
];

const testimonials = [
  { name: 'Carlos M.', role: 'Barbería en Bogotá', text: 'Antes perdía 4 clientes al día por no contestar WhatsApp. Ahora reservan solos. Transformó mi negocio.' },
  { name: 'María F.', role: 'Salón en Medellín', text: 'Mis clientas aman poder elegir el horario sin llamarme. Yo solo llego y trabajo.' },
  { name: 'Andrés L.', role: 'Barbería en Cali', text: 'En 10 minutos lo configuré. No sabía nada de tecnología. Si sabes usar WhatsApp, sabes usar TurnoBot.' },
];

const pricingFeatures = [
  'Reservas ilimitadas', 'Sin comisión por reserva', 'Calendario inteligente',
  'CRM automático', 'Panel de administración', 'Link de reservas único',
  'Soporte por WhatsApp', 'Sin contrato — cancela cuando quieras',
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
                Agendamiento en línea para barberías
              </div>
            </FadeIn>
            <FadeIn delay={100}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight mb-6">
                Tu barbería <span className="text-green-400">nunca cierra</span>
              </h1>
            </FadeIn>
            <FadeIn delay={200}>
              <p className="text-lg text-gray-400 max-w-lg mb-8 leading-relaxed">
                Tus clientes reservan solos, 24/7, sin WhatsApp. 
                Tú solo llegas y trabajas. <span className="text-white font-semibold">Sin comisión. Sin contrato.</span>
              </p>
            </FadeIn>
            <FadeIn delay={300}>
              <div className="flex flex-col sm:flex-row gap-4">
                <a href="/register" className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all active:scale-95 shadow-lg shadow-green-500/25">
                  🚀 Empezar Gratis
                </a>
                <a href="#demo" className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/15 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all border border-white/10">
                  ▶ Ver demo
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={400}>
              <div className="mt-8 flex items-center gap-6 text-sm text-gray-500">
                <span>✓ Gratis</span>
                <span>✓ Sin tarjeta</span>
                <span>✓ 10 min setup</span>
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
              Un link. Cuatro pasos. Reserva confirmada. Sin WhatsApp. Sin llamadas.
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
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">El problema</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              ¿Cuántas citas pierdes al día?
            </h2>
            <p className="text-lg text-gray-500">
              El 60% de los clientes elige al primero que responde. 
              Si no contestas WhatsApp en minutos, se van con la competencia.
            </p>
          </div>
        </FadeIn>

        <div className="grid sm:grid-cols-3 gap-6">
          {[
            { icon: '😤', stat: '60%', label: 'de clientes eligen al primero que responde', delay: 0 },
            { icon: '💸', stat: '$25.000', label: 'pierdes por cada cliente perdido', delay: 150 },
            { icon: '⏰', stat: '24/7', label: 'reservan cuando tú duermes', delay: 300 },
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
              En 10 minutos tu barbería está online
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
            <p className="text-sm font-bold text-green-600 uppercase tracking-wider mb-4">Precio</p>
            <h2 className="text-3xl sm:text-4xl font-black text-gray-900 mb-6">
              Menos que un café al día
            </h2>
          </div>
        </FadeIn>

        <FadeIn delay={200}>
          <div className="bg-gray-50 border-2 border-green-500 rounded-3xl p-8 sm:p-12 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-green-500 text-white text-xs font-bold px-4 py-1.5 rounded-bl-2xl uppercase tracking-wider">
              Plan Activo
            </div>
            <div className="text-center mb-8">
              <p className="text-5xl font-black text-gray-900 mb-2">$9.900<span className="text-lg font-bold text-gray-400">/mes</span></p>
              <p className="text-sm text-gray-500">Menos de $330 al día — menos que un café ☕</p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              {pricingFeatures.map((f, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-gray-600">
                  <span className="text-green-500 font-bold text-lg">✓</span>{f}
                </div>
              ))}
            </div>
            <div className="text-center">
              <a href="/register" className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all active:scale-95 shadow-lg shadow-green-500/25 w-full sm:w-auto">
                🚀 Empezar Ahora — Gratis
              </a>
              <p className="text-xs text-gray-400 mt-4">Sin tarjeta de crédito. Configuración en 10 minutos.</p>
            </div>
          </div>
        </FadeIn>
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
            ¿Listo para dejar de perder clientes?
          </h2>
          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto">
            Únete a las barberías que ya reservan solas. Configuración gratuita en 10 minutos.
          </p>
          <a href="/register" className="inline-flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-bold px-8 py-4 rounded-2xl text-base transition-all active:scale-95 shadow-lg shadow-green-500/25">
            🚀 Crear Mi Barbería Gratis
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
            <p className="text-white font-black text-lg">TurnoBot 🗓️</p>
            <p className="text-xs mt-1">Agendamiento en línea para barberías</p>
          </div>
          <div className="flex gap-6 text-sm">
            <a href="/" className="hover:text-white transition-colors">Inicio</a>
            <a href="/admin" className="hover:text-white transition-colors">Admin</a>
            <a href="/register" className="hover:text-white transition-colors">Crear negocio</a>
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
      <TestimonialsSection />
      <CTASection />
      <Footer />
    </div>
  );
}
