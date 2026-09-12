import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary.jsx';

// Lazy loading para code splitting — reduce el bundle inicial
const BookingApp = lazy(() => import('./BookingApp.jsx'));
const AdminDashboard = lazy(() => import('./AdminDashboard.jsx'));
const RegisterShop = lazy(() => import('./RegisterShop.jsx'));
const SuperAdmin = lazy(() => import('./SuperAdmin.jsx'));

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

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            {/* Ruta para clientes: extrae dinámicamente el slug del local */}
            <Route path="/shop/:slug" element={<BookingApp />} />

            {/* Ruta privada para los dueños de negocios */}
            <Route path="/admin" element={<AdminDashboard />} />

            {/* Registro de primer dueño */}
            <Route path="/register" element={<RegisterShop />} />

            {/* Panel de administración SaaS (solo super admin) */}
            <Route path="/super-admin" element={<SuperAdmin />} />

            {/* Redirección por defecto */}
            <Route path="*" element={<Navigate to="/register" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
