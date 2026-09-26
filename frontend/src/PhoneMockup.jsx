export default function PhoneMockup({ modo = 'servicio' }) {
  const esEspacio = modo === 'espacio';
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
            <div className="text-center mb-1">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">TurnoBot</p>
              <p className="text-sm font-bold text-gray-900">Mi Negocio</p>
            </div>

            {/* Progress: 5 pasos reales (servicio) / 4 pasos (espacio) */}
            <div className="flex items-center gap-1" aria-hidden="true">
              {(esEspacio ? [1, 2, 3, 4] : [1, 2, 3, 4, 5]).map((n) => (
                <div key={n} className={`h-1.5 flex-1 rounded-full ${n <= 4 ? 'bg-black' : 'bg-gray-200'}`} />
              ))}
            </div>
            <p className="text-[9px] font-bold text-gray-400 text-center -mt-1">
              {esEspacio ? 'Paso 4 de 4 · Confirmar' : 'Paso 5 de 5 · Confirmar'}
            </p>

            {esEspacio ? (
              <>
                {/* Espacio card */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs font-bold text-gray-900">🧘 Clase de Crossfit</p>
                      <p className="text-[10px] text-gray-500">12/15 · ¡Quedan 3!</p>
                    </div>
                    <span className="text-[9px] font-black text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">3 libres</span>
                  </div>
                  <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full w-4/5 bg-amber-500 rounded-full" />
                  </div>
                </div>

                {/* Date + hours espacio */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-700 mb-2">📅 Viernes · Clase de Crossfit</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['17:00', '18:00', '19:30'].map((h, i) => (
                      <div key={h} className={`text-center text-[10px] py-1.5 rounded-lg font-bold ${
                        i === 1 ? 'bg-green-500 text-white' : 'bg-white border border-gray-200 text-gray-600'
                      }`}>
                        {h}
                        {i === 1 && <span className="block text-[8px] font-bold">¡Quedan 3!</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Service card */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-xs font-bold text-gray-900">📋 Corte + Barba</p>
                      <p className="text-[10px] text-gray-500">unos 45 minutos</p>
                    </div>
                    <span className="text-xs font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-lg">$35.000</span>
                  </div>
                </div>

                {/* Profesional + cualquiera */}
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-green-700 mb-1">👤 Profesional</p>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold">J</div>
                    <span className="text-xs font-bold text-gray-900">José</span>
                    <span className="text-[8px] text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full ml-auto">✓ Seleccionado</span>
                  </div>
                  <p className="text-[9px] text-green-700 font-medium mt-1">o “Cualquiera disponible”</p>
                </div>

                {/* Date */}
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <p className="text-[10px] font-bold text-gray-700 mb-2">📅 Viernes, Sep 15 · 11:00</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {['10:00', '10:30', '11:00'].map((h, i) => (
                      <div key={h} className={`text-center text-[10px] py-1.5 rounded-lg font-bold ${
                        i === 2 ? 'bg-green-500 text-white' : 'bg-white border border-gray-200 text-gray-600'
                      }`}>
                        {h}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Google identity (real: login obligatorio) */}
            <div className="bg-white border border-gray-200 rounded-xl p-2.5 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-500 text-white text-[10px] font-black flex items-center justify-center">G</span>
              <span className="text-[10px] font-bold text-gray-700">Juan · juan@gmail.com</span>
              <span className="text-[8px] text-green-600 font-bold ml-auto">✓ Google</span>
            </div>

            {/* CTA */}
            <div className="bg-green-500 text-white text-center py-2.5 rounded-xl text-xs font-bold">
              Confirmar Reserva ✓
            </div>
            <p className="text-[9px] text-gray-400 text-center font-medium -mt-1">
              {esEspacio ? 'Reserva de Crossfit · 18:00 · se libera si cancelas' : 'Pagas en el local · aquí solo apartas'}
            </p>
          </div>
        </div>
      </div>

      {/* Floating notification */}
      <div className="absolute top-12 -right-4 sm:-right-10 z-[100] bg-white rounded-2xl shadow-2xl border border-gray-100 p-3 max-w-[180px] animate-bounce">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white text-sm">📱</div>
          <div>
            <p className="text-[10px] font-bold text-gray-900">Nueva reserva</p>
            <p className="text-[8px] text-gray-500">{esEspacio ? 'Ana · Crossfit · Vie 6pm' : 'Juan · Corte · Vie 11am'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
