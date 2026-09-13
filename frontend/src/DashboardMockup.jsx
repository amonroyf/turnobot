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
          <p className="text-sm font-black text-gray-900">Barbería VIP</p>
          <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Modo Administrador</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-4">
          {['📅 Agenda', '👥 Clientes', '⚙️ Ajustes'].map((tab, i) => (
            <div key={i} className={`flex-1 text-center py-1.5 rounded-lg text-[10px] font-bold ${
              i === 0 ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
            }`}>
              {tab}
            </div>
          ))}
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

        {/* Appointment cards */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">HOY</p>
          {[
            { name: 'Carlos Pérez', service: 'Corte + Barba', time: '10:00', price: '$35.000', status: 'Confirmada' },
            { name: 'María López', service: 'Corte clásico', time: '11:30', price: '$25.000', status: 'Confirmada' },
            { name: 'Andrés Ruiz', service: 'Cejas', time: '14:00', price: '$15.000', status: 'Pendiente' },
          ].map((a, i) => (
            <div key={i} className="bg-white border border-gray-200 rounded-xl p-2.5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-gray-200 rounded-full flex items-center justify-center text-[10px] font-bold text-gray-600">
                  {a.name.charAt(0)}
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-900">{a.name}</p>
                  <p className="text-[8px] text-gray-500">✂️ {a.service} · ⏰ {a.time}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-gray-900">{a.price}</p>
                <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full ${
                  a.status === 'Confirmada' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {a.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
