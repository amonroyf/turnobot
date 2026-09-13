export default function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[280px] sm:w-[300px]">
      {/* Phone frame */}
      <div className="relative bg-gray-900 rounded-[3rem] p-3 shadow-2xl shadow-black/30 z-10">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-gray-900 rounded-b-2xl z-20"></div>

        {/* Screen */}
        <div className="bg-white rounded-[2.2rem] overflow-hidden">
          {/* Status bar */}
          <div className="bg-gray-900 text-white text-[10px] px-6 py-1.5 flex justify-between items-center">
            <span>9:41</span>
            <div className="flex gap-1 items-center">
              <span className="text-[8px]">📶</span>
              <span className="text-[8px]">🔋</span>
            </div>
          </div>

          {/* App content */}
          <div className="p-4 space-y-3">
            {/* Header */}
            <div className="text-center mb-2">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">TurnoBot</p>
              <p className="text-sm font-bold text-gray-900">Barbería VIP</p>
            </div>

            {/* Service card */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xs font-bold text-gray-900">✂️ Corte clásico</p>
                  <p className="text-[10px] text-gray-500">30 min</p>
                </div>
                <span className="text-xs font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-lg">$25.000</span>
              </div>
            </div>

            {/* Barber selection */}
            <div className="bg-green-50 border border-green-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-green-700 mb-1">👤 Profesional</p>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold">J</div>
                <span className="text-xs font-bold text-gray-900">José</span>
                <span className="text-[8px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full ml-auto">✓ Seleccionado</span>
              </div>
            </div>

            {/* Date */}
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
              <p className="text-[10px] font-bold text-gray-700 mb-2">📅 Viernes, Sep 15</p>
              <div className="grid grid-cols-3 gap-1.5">
                {['10:00', '10:30', '11:00', '11:30', '14:00', '14:30'].map((h, i) => (
                  <div key={i} className={`text-center text-[10px] py-1.5 rounded-lg font-bold ${
                    i === 2 ? 'bg-green-500 text-white' : 'bg-white border border-gray-200 text-gray-600'
                  }`}>
                    {h}
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="bg-green-500 text-white text-center py-2.5 rounded-xl text-xs font-bold">
              Confirmar Reserva ✓
            </div>
          </div>
        </div>
      </div>

      {/* Floating notification (FIX DEFINITIVO) */}
      <div className="absolute top-12 -right-4 sm:-right-10 z-[100] bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 max-w-[180px] animate-bounce">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm">📱</div>
          <div>
            <p className="text-[10px] font-bold text-gray-900">Nueva reserva</p>
            <p className="text-[8px] text-gray-500">Juan - Corte - Viernes 11am</p>
          </div>
        </div>
      </div>
    </div>
  );
}
