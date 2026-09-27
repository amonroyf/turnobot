// Mockup fiel a RegistroManual.jsx: el dueño anota por llamada/WhatsApp.
export default function NuevaCitaMockup() {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-lg max-w-[340px] w-full">
      <p className="text-sm font-black text-gray-900">＋ Nueva cita</p>
      <p className="text-[11px] text-gray-500 font-medium mb-3">Te llamaron o escribieron · lo anotas en 30 seg</p>
      <div className="flex gap-1.5 mb-3">
        <span className="flex-1 text-center text-[10px] font-bold bg-gray-900 text-white rounded-lg py-2">📋 Servicio</span>
        <span className="flex-1 text-center text-[10px] font-bold bg-gray-100 text-gray-500 rounded-lg py-2">📍 Espacio</span>
      </div>
      <div className="space-y-1.5 text-[11px] font-bold">
        <p className="bg-green-50 border border-green-200 rounded-lg px-2.5 py-2">📋 Corte + Barba · $35.000 ✓</p>
        <p className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600">👤 José ✓ · 📅 Hoy · 🕐 14:30 ✓</p>
        <p className="bg-white border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600">👩 María · 📞 300 123 4567</p>
      </div>
      <div className="bg-black text-white text-center py-2.5 rounded-xl text-xs font-bold mt-3 min-h-[44px] flex items-center justify-center">Guardar cita ✓</div>
      <p className="text-[9px] text-gray-400 text-center font-medium mt-2">Mismo flujo del cliente · cierra con WhatsApp manual</p>
    </div>
  );
}
