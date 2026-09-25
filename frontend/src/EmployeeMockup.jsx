export default function EmployeeMockup() {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Portal del empleado</p>
      <p className="text-sm font-black text-gray-900 mb-3">Hola, José 👋</p>

      {/* Tabs reales: Mi agenda / Mis números / Mi turno */}
      <div className="flex gap-1.5 mb-3">
        {['Mi agenda', 'Mis números', 'Mi turno'].map((t, i) => (
          <span key={t} className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full ${i === 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>{t}</span>
        ))}
      </div>

      {/* PIN */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 mb-3 flex items-center gap-2">
        <span className="text-xs">🔑</span>
        <span className="text-[11px] font-bold text-gray-700 tracking-[0.3em]">••••</span>
        <span className="text-[9px] text-green-600 font-bold ml-auto">✓ PIN ok</span>
      </div>

      {/* Cita con acciones reales: mover + WhatsApp */}
      <div className="border border-gray-200 rounded-xl p-2.5">
        <div className="flex justify-between items-center mb-1">
          <p className="text-[11px] font-bold text-gray-900">10:00 · Corte · Carlos</p>
          <span className="text-[9px] font-black text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">$35.000</span>
        </div>
        <p className="text-[10px] text-gray-500 font-medium mb-2">📞 300 123 4567</p>
        <div className="flex gap-1.5">
          <span className="flex-1 text-center text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 rounded-lg py-1.5">📲 WhatsApp</span>
          <span className="flex-1 text-center text-[10px] font-bold text-gray-700 bg-gray-100 rounded-lg py-1.5">↔ Mover 10→11</span>
        </div>
      </div>

      <p className="text-[10px] text-gray-400 font-medium mt-3 text-center">Solo ve su agenda · cambia horario y clave solo</p>
    </div>
  );
}
