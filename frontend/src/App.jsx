import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary.jsx';

// Lazy loading para code splitting — reduce el bundle inicial
const LandingPage = lazy(() => import('./LandingPage.jsx'));
const BookingApp = lazy(() => import('./BookingApp.jsx'));
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'));
const RegisterShop = lazy(() => import('./RegisterShop.jsx'));
const SuperAdmin = lazy(() => import('./SuperAdmin.jsx'));
const EmployeeDashboard = lazy(() => import('./EmployeeDashboard.jsx'));

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="inline-block w-8 h-8 border-4 border-gray-200 border-t-black rounded-full animate-spin mb-4"></div>
        <p className="text-sm text-gray-500 font-medium">Cargando...</p>
      </div>
    </div>
  );
}

// SEO: título + descripción por ruta (Colombia). Las rutas privadas
// (admin/empleado) se marcan noindex para no salir en Google.
function TitulosPorRuta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const base = 'TurnoBot Colombia';
    let titulo = `${base} — Agenda online para citas y cupos`;
    let descripcion = 'Tu página de reservas online para servicios 1 a 1 y espacios por cupos. Tus clientes reservan solos 24/7.';
    let robots = 'index, follow';
    if (pathname === '/register') {
      titulo = `${base} — Crea tu página de reservas gratis`;
      descripcion = 'Crea tu página de reservas en 10 minutos. Servicios, espacios por cupos, equipo con PIN y panel desde el celular.';
    } else if (pathname.startsWith('/shop/')) {
      titulo = `${base} — Reserva tu cita en línea`;
      descripcion = 'Elige servicio o espacio, día y hora, y confirma con Google. Sin llamadas ni filas.';
    } else if (pathname.startsWith('/admin') || pathname.startsWith('/employee/') || pathname.startsWith('/super-admin')) {
      titulo = `${base} — Panel privado`;
      robots = 'noindex, nofollow';
    }
    document.title = titulo;
    let meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', descripcion);
    let metaRobots = document.querySelector('meta[name="robots"]');
    if (metaRobots) metaRobots.setAttribute('content', robots);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <TitulosPorRuta />
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            {/* Landing page pública */}
            <Route path="/" element={<LandingPage />} />

            {/* Ruta para clientes: extrae dinámicamente el slug del local */}
            <Route path="/shop/:slug" element={<BookingApp />} />

            {/* Ruta privada para los dueños de negocios */}
            <Route path="/admin" element={<AdminDashboard />} />

            {/* Portal del empleado (login con PIN) */}
            <Route path="/employee/:slug" element={<EmployeeDashboard />} />

            {/* Registro de primer dueño */}
            <Route path="/register" element={<RegisterShop />} />

            {/* Panel de administración SaaS (solo super admin) */}
            <Route path="/super-admin" element={<SuperAdmin />} />

            {/* Redirección por defecto */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
