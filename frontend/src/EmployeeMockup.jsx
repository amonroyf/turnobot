export default function EmployeeMockup({ vista = 'agenda' }) {
  // vista: 'login' | 'agenda' | 'numeros' | 'turno' — refleja EmployeeDashboard.jsx
  if (vista === 'login') {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm max-w-[320px]">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Portal del empleado</p>
        <p className="text-sm font-black text-gray-900 mb-1">Entra con tu PIN 🔑</p>
        <p className="text-[11px] text-gray-500 font-medium mb-3">El dueño te da tu clave de 4 a 6 números.</p>
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-3">
          <p className="text-[10px] font-bold text-gray-500 mb-1.5">Soy…</p>
          <p className="text-xs font-bold bg-white border border-green-500 rounded-lg px-2.5 py-2">👤 José ✓</p>
          <p className="text-xs font-bold bg-white border border-gray-200 rounded-lg px-2.5 py-2 mt-1.5 text-gray-500">👤 Ana</p>
        </div>
        <div className="flex gap-1.5 justify-center mb-3" aria-hidden="true">
          {[1, 2, 3, 4].map((n) => <span key={n} className="w-10 h-11 rounded-lg bg-gray-900 text-white flex items-center justify-center text-sm font-black">•</span>)}
        </div>
        <div className="bg-gray-900 text-white text-center py-2.5 rounded-xl text-xs font-bold min-h-[44px] flex items-center justify-center">Entrar a mi agenda →</div>
      </div>
    );
  }
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Portal del empleado</p>
      <p className="text-sm font-black text-gray-900 mb-3">Hola, José 👋</p>

      {/* Tabs reales: Mi agenda / Mis números / Mi turno */}
      <div className="flex gap-1.5 mb-3" role="tablist" aria-label="Portal empleado">
        {['Mi agenda', 'Mis números', 'Mi turno'].map((t) => {
          const activa = (vista === 'agenda' && t === 'Mi agenda') || (vista === 'numeros' && t === 'Mis números') || (vista === 'turno' && t === 'Mi turno');
          return <span key={t} role="tab" aria-selected={activa} className={`text-[10px] font-bold px-2.5 py-1.5 rounded-full min-h-[32px] flex items-center ${activa ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'}`}>{t}</span>;
        })}
      </div>

      {vista === 'numeros' ? (
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {[['Hoy', '4'], ['No-llegadas', '1'], ['Cobrado', '$120k']].map(([l, v]) => (
            <div key={l} className="bg-gray-50 border border-gray-200 rounded-xl p-2.5">
              <p className="text-[9px] text-gray-400 font-bold">{l}</p>
              <p className="text-sm font-black text-gray-900">{v}</p>
            </div>
          ))}
        </div>
      ) : vista === 'turno' ? (
        <div className="space-y-2">
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-700">🕒 Lun–Vie · 9:00–18:00 <span className="text-green-600 ml-1">· editar</span></div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-700">🔑 Cambiar mi clave <span className="text-green-600 ml-1">· solo yo</span></div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-[11px] font-bold text-gray-700">📅 Google Calendar: <span className="text-green-600">conectado ✓</span></div>
        </div>
      ) : (
        <>
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-2.5 mb-3 flex items-center gap-2">
            <span className="text-xs" aria-hidden="true">🔑</span>
            <span className="text-[11px] font-bold text-gray-700 tracking-[0.3em]">••••</span>
            <span className="text-[9px] text-green-600 font-bold ml-auto">✓ PIN ok</span>
          </div>
          <div className="border border-gray-200 rounded-xl p-2.5">
            <div className="flex justify-between items-center mb-1">
              <p className="text-[11px] font-bold text-gray-900">10:00 · Corte · Carlos</p>
              <span className="text-[9px] font-black text-gray-900 bg-gray-100 px-1.5 py-0.5 rounded">$35.000</span>
            </div>
            <p className="text-[10px] text-gray-500 font-medium mb-2">📞 300 123 4567</p>
            <div className="flex gap-1.5">
              <span className="flex-1 text-center text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 rounded-lg py-2 min-h-[40px] flex items-center justify-center">📲 WhatsApp</span>
              <span className="flex-1 text-center text-[10px] font-bold text-gray-700 bg-gray-100 rounded-lg py-2 min-h-[40px] flex items-center justify-center">↔ Mover 10→11</span>
            </div>
            <p className="text-[9px] text-gray-400 font-medium mt-2">＋ Nueva cita · para llamadas y WhatsApp</p>
          </div>
        </>
      )}

      <p className="text-[10px] text-gray-400 font-medium mt-3 text-center">Solo ve su agenda · cambia horario y clave solo</p>
    </div>
  );
}
