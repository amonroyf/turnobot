// Mockup fiel a AdminDashboard.jsx vista "ajustes": catálogo + marca + políticas.
export default function AjustesMockup({ tab = 'marca' }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4 w-full max-w-[520px]">
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-3" role="tablist" aria-label="Ajustes">
        {['servicios', 'espacios', 'equipo', 'marca', 'reglas'].map((t) => (
          <span key={t} role="tab" aria-selected={tab === t} className={`flex-1 text-center py-1.5 rounded-lg text-[9px] font-bold capitalize min-h-[36px] flex items-center justify-center ${tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{t}</span>
        ))}
      </div>
      {tab === 'marca' && (
        <div className="space-y-2">
          <div className="flex gap-1.5">
            {['#16A34A', '#111827', '#7C3AED', '#DB2777'].map((c, i) => (
              <span key={c} className="w-8 h-8 rounded-full border-2" style={{ backgroundColor: c, borderColor: i === 0 ? '#111827' : '#e5e7eb' }} />
            ))}
            <span className="text-[9px] font-bold text-gray-500 self-center ml-1">Tu color · tu nombre · sin fotos</span>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-full bg-green-600 text-white flex items-center justify-center text-sm font-black">B</span>
            <span><span className="block text-xs font-black text-gray-900">Barbería El Corte</span><span className="block text-[10px] text-gray-500">Cortes que se notan ✂️</span></span>
            <span className="ml-auto text-[8px] font-bold text-gray-400 uppercase">Vista previa</span>
          </div>
          <div className="flex gap-1.5">
            {['📷 Instagram', '👍 Facebook', '🎵 TikTok'].map((r) => <span key={r} className="text-[9px] font-bold bg-white border border-gray-200 rounded-lg px-2 py-1.5">{r}</span>)}
          </div>
        </div>
      )}
      {tab === 'reglas' && (
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          {[['Cancela hasta', '24 h antes'], ['Anticipación', '0 min'], ['Ventana', '30 días'], ['Máx / día', '3 por teléfono'], ['Jornada', '09:00–18:00']].map(([l, v]) => (
            <div key={l} className="bg-white border border-gray-200 rounded-xl p-2.5">
              <p className="text-gray-400 font-bold text-[9px] uppercase">{l}</p>
              <p className="font-black text-gray-900 text-xs">{v}</p>
            </div>
          ))}
          <p className="col-span-2 text-[9px] text-gray-400 font-medium text-center">Aplican desde ya · como Fresha / Booksy</p>
        </div>
      )}
      {(tab === 'servicios' || tab === 'espacios' || tab === 'equipo') && (
        <div className="space-y-1.5">
          {(tab === 'servicios' ? ['📋 Corte + Barba · 45 min · $35.000', '📋 Limpieza facial · 60 min · $50.000'] : tab === 'espacios' ? ['🧘 Clase Crossfit · 15 cupos · Lun–Vie', '⚽ Cancha Fútbol · 30 cupos'] : ['👤 José · PIN ✓ · Lun–Vie 9–18', '👤 Ana · PIN ✓ · Sáb 9–14']).map((r) => (
            <div key={r} className="bg-white border border-gray-200 rounded-xl px-3 py-2 flex items-center gap-2">
              <p className="text-[10px] font-bold text-gray-800 flex-1">{r}</p>
              <span className="text-[9px] font-bold text-gray-400">🕒</span>
              <span className="text-[9px] font-bold text-red-500">🗑</span>
            </div>
          ))}
          <div className="bg-black text-white text-center text-[10px] font-bold py-2 rounded-xl">＋ Agregar {tab}</div>
        </div>
      )}
    </div>
  );
}
