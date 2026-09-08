import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import BookingApp from './BookingApp.jsx';
import AdminDashboard from './AdminDashboard.jsx';
import RegisterShop from './RegisterShop.jsx';



export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Ruta para clientes: extrae dinámicamente el slug del local */}
        <Route path="/shop/:slug" element={<BookingApp />} />

        {/* Ruta privada para los dueños de negocios */}
        <Route path="/admin" element={<AdminDashboard />} />

        {/* Registro de primer dueño */}
        <Route path="/register" element={<RegisterShop />} />

        {/* Redirección por defecto */}
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
