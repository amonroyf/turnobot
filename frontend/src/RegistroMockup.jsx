// Mockup fiel a RegisterShop.jsx: onboarding en 2 pasos (Google → datos).
export default function RegistroMockup({ paso = 2 }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm max-w-[340px] w-full">
      <p className="text-[10px] font-black tracking-widest text-gray-400 uppercase text-center">TurnoBot</p>
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center mt-1">Paso {paso} de 2</p>
      <p className="text-base font-black text-gray-900 text-center mt-1">{paso === 1 ? 'Crea tu cuenta' : 'Configura tu agenda'}</p>
      <p className="text-xs text-gray-500 text-center mt-1 mb-4">{paso === 1 ? 'Entra con Google en 1 clic.' : 'Datos básicos para reservar.'}</p>
      {paso === 1 ? (
        <>
          <div className="w-full py-3 border border-gray-300 rounded-xl text-center text-xs font-bold text-gray-700 shadow-sm">🔵 Continuar con Google</div>
          <p className="text-[10px] text-gray-400 text-center font-medium mt-2">Sin contraseñas · acceso rápido</p>
        </>
      ) : (
        <div className="space-y-2.5">
          <div className="p-2.5 bg-green-50 border border-green-200 text-green-700 text-[10px] rounded-xl text-center font-bold">Cuenta conectada ✓</div>
          <label className="block">
            <span className="text-[10px] font-bold text-gray-700">¿Cómo se llama tu negocio?</span>
            <span className="block mt-1 p-2.5 border border-gray-300 rounded-xl text-xs font-medium text-gray-900">Barbería El Corte ✂️</span>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-gray-700">WhatsApp de avisos</span>
            <span className="block mt-1 p-2.5 border border-gray-300 rounded-xl text-xs font-medium text-gray-900">300 123 4567</span>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-gray-700">Tu enlace</span>
            <span className="block mt-1 p-2.5 border border-gray-300 rounded-xl text-[11px] font-mono text-gray-700">…/shop/barberia-el-corte</span>
          </label>
          <div className="w-full py-3 bg-black text-white rounded-xl text-center text-xs font-bold min-h-[48px] flex items-center justify-center">Activar mi agenda →</div>
        </div>
      )}
    </div>
  );
}
