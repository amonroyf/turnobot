export default function DashboardMockup() {
  return (
    <div className="relative mx-auto max-w-2xl">
      {/* Browser frame */}
      <div className="bg-gray-900 rounded-t-2xl px-4 py-2 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 bg-red-400 rounded-full"></div>
          <div className="w-3 h-3 bg-yellow-400 rounded-full"></div>
          <div className="w-3 h-3 bg-green-400 rounded-full"></div>
        </div>
        <div className="flex-1 bg-gray-700 rounded-lg px-3 py-1 text-[10px] text-gray-400 ml-2">
          turnobot-web.web.app/admin
        </div>
      </div>

      {/* Dashboard content */}
      <div className="bg-gray-50 border-x border-b border-gray-200 rounded-b-2xl p-4 sm:p-6">
        {/* Header */}
        <div className="text-center mb-4">
          <p className="text-sm font-black text-gray-900">Mi Negocio</p>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Modo Administrador</p>
        </div>

        {/* Tabs reales: bottom nav Agenda / Clientes / Ajustes */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4" role="tablist" aria-label="Panel del dueño">
          {['📅 Agenda', '👥 Clientes', '⚙️ Ajustes'].map((tab, i) => (
            <div key={i} role="tab" aria-selected={i === 0} className={`flex-1 text-center py-1.5 rounded-lg text-[10px] font-bold min-h-[36px] flex items-center justify-center ${
              i === 0 ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}>
              {tab}
            </div>
          ))}
        </div>

        {/* Acciones reales del dueño */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="bg-black text-white text-center text-[10px] font-bold py-2 rounded-xl">＋ Nueva cita</div>
          <div className="bg-blue-600 text-white text-center text-[10px] font-bold py-2 rounded-xl">🔗 Copiar enlace</div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Hoy', value: '4', icon: '📅' },
            { label: 'Mañana', value: '2', icon: '📋' },
            { label: 'Clientes', value: '47', icon: '👥' },
          ].map((s, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-2 text-center">
              <p className="text-[10px] text-gray-400">{s.icon} {s.label}</p>
              <p className="text-lg font-black text-gray-900">{s.value}</p>
            </div>
          ))}
        </div>

        {/* HOY: 1 cita 1-a-1 + 1 grupo espacio (como en la app real) */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">HOY</p>

          {/* Cita individual: timeline + pagado / no-show / cancelar (código real) */}
          <div className="flex gap-2 items-stretch">
            <div className="flex flex-col items-center shrink-0">
              <span className="text-[9px] font-bold text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded-md">10:00</span>
              <div className="w-px flex-1 bg-gray-200" aria-hidden="true" />
            </div>
            <div className="flex-1 bg-white border border-gray-200 rounded-xl p-2.5">
              <div className="flex justify-between items-center gap-2">
                <p className="text-[10px] font-bold text-gray-900">Carlos Pérez</p>
                <span className="text-[9px] font-black bg-green-100 text-green-800 border border-green-200 px-1.5 py-0.5 rounded-lg">✅ Pagó</span>
              </div>
              <p className="text-[8px] text-gray-500 font-medium">📋 Corte · 👤 José · 📞 300 123 4567</p>
              <div className="flex gap-1 mt-1.5">
                <span className="text-[8px] font-bold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-1">📲</span>
                <span className="text-[8px] font-bold text-gray-600 px-1.5 py-1">No llegó</span>
                <span className="text-[8px] font-bold text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-1">✕</span>
              </div>
            </div>
            <div className="text-right self-start"><p className="text-[10px] font-black text-gray-900">$35.000</p></div>
          </div>

          {/* Grupo espacio: UNA tarjeta por horario */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="p-2.5 flex items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-sm">🧘</span>
              <div className="flex-1">
                <p className="text-[10px] font-bold text-gray-900">📍 Clase de Crossfit · 18:00</p>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
                  <div className="h-full w-4/5 bg-amber-500 rounded-full" />
                </div>
                <p className="text-[8px] font-bold text-gray-500 mt-0.5">12/15 · ¡Quedan 3!</p>
              </div>
              <span className="text-[9px] font-black bg-gray-100 text-gray-700 px-2 py-1 rounded-lg">12/15</span>
            </div>
            <div className="border-t border-gray-100 divide-y divide-gray-50">
              <div className="px-3 py-1.5 flex items-center gap-2">
                <p className="text-[9px] font-bold text-gray-800 flex-1">Ana Gómez · 📞 300 123 4567</p>
                <span className="text-[8px] font-bold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">📲</span>
                <span className="text-[8px] font-bold text-gray-500">No llegó</span>
              </div>
              <div className="px-3 py-1.5 flex items-center gap-2">
                <p className="text-[9px] font-bold text-gray-800 flex-1">Luis Ruiz · 📞 310 987 6543</p>
                <span className="text-[8px] font-bold text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">📲</span>
                <span className="text-[8px] font-bold text-red-600">✕</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
