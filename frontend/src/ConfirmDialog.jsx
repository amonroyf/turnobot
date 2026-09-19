import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// Diálogo propio (reemplaza confirm()/alert()/prompt() nativos): misma
// identidad de la app, textos en palabras, accesible (alertdialog + Escape).
//
// Uso:
//   const { confirmar, avisar, pedirTexto } = useDialogo();
//   if (!(await confirmar({ titulo, detalle, confirmarTexto, variante }))) return;
//   await avisar('Guardado', 'exito');
//   const id = await pedirTexto({ titulo, verificacion: slug });

const DialogoContext = createContext(null);

let seq = 0;

export function DialogoProvider({ children }) {
  const [peticion, setPeticion] = useState(null);
  const resolverRef = useRef(null);

  const cerrar = useCallback((valor) => {
    setPeticion(null);
    resolverRef.current?.(valor);
    resolverRef.current = null;
  }, []);

  const confirmar = useCallback((opts = {}) => new Promise((res) => {
    resolverRef.current = res;
    setPeticion({ id: ++seq, modo: 'confirmar', variante: 'info', cancelarTexto: 'Volver', ...opts });
  }), []);

  const avisar = useCallback((mensaje, tipo = 'info') => new Promise((res) => {
    resolverRef.current = res;
    setPeticion({ id: ++seq, modo: 'aviso', mensaje, tipo });
  }), []);

  const pedirTexto = useCallback((opts = {}) => new Promise((res) => {
    resolverRef.current = res;
    setPeticion({ id: ++seq, modo: 'texto', cancelarTexto: 'Cancelar', confirmarTexto: 'Confirmar', ...opts });
  }), []);

  return (
    <DialogoContext.Provider value={{ confirmar, avisar, pedirTexto }}>
      {children}
      {peticion && <Dialogo peticion={peticion} onCerrar={cerrar} />}
    </DialogoContext.Provider>
  );
}

export function useDialogo() {
  const ctx = useContext(DialogoContext);
  // Sin provider (tests, renders sueltos): degradar a nativos, nunca romper.
  if (!ctx) {
    return {
      confirmar: async (o = {}) => window.confirm(o.titulo ? `${o.titulo}\n\n${o.detalle || ''}` : '¿Continuar?'),
      avisar: async (m) => { window.alert(m); },
      pedirTexto: async (o = {}) => window.prompt(o.titulo || ''),
    };
  }
  return ctx;
}

const estilosVariante = {
  peligro: { icono: '⚠️', boton: 'bg-red-600 hover:bg-red-700 text-white', borde: 'border-red-200' },
  info: { icono: '❓', boton: 'bg-black hover:bg-gray-800 text-white', borde: 'border-gray-200' },
  exito: { icono: '✅', boton: 'bg-black hover:bg-gray-800 text-white', borde: 'border-green-200' },
  error: { icono: '⚠️', boton: 'bg-black hover:bg-gray-800 text-white', borde: 'border-red-200' },
};

function Dialogo({ peticion, onCerrar }) {
  const [texto, setTexto] = useState('');
  const confirmarRef = useRef(null);
  const esTexto = peticion.modo === 'texto';
  const esAviso = peticion.modo === 'aviso';
  const variante = estilosVariante[esAviso ? peticion.tipo : peticion.variante] || estilosVariante.info;
  const coincide = !esTexto || !peticion.verificacion || texto.trim() === peticion.verificacion;

  useEffect(() => {
    setTexto('');
    const t = setTimeout(() => confirmarRef.current?.focus(), 50);
    const alTeclado = (e) => {
      if (e.key === 'Escape') onCerrar(esTexto || peticion.modo === 'confirmar' ? (esTexto ? null : false) : undefined);
    };
    window.addEventListener('keydown', alTeclado);
    return () => { clearTimeout(t); window.removeEventListener('keydown', alTeclado); };
  }, [peticion.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-4"
      onClick={() => onCerrar(esTexto ? null : peticion.modo === 'confirmar' ? false : undefined)}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dialogo-titulo"
        aria-describedby="dialogo-detalle"
        onClick={(e) => e.stopPropagation()}
        className={`bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl border ${variante.borde}`}
      >
        <div className="text-3xl mb-3" aria-hidden="true">{esAviso ? variante.icono : (peticion.icono || variante.icono)}</div>
        {(peticion.titulo || esAviso) && (
          <h3 id="dialogo-titulo" className="text-base font-black text-gray-900 mb-1">
            {esAviso ? (typeof peticion.mensaje === 'string' && peticion.mensaje.length < 60 ? peticion.mensaje : (peticion.tipo === 'error' ? 'Algo salió mal' : peticion.tipo === 'exito' ? 'Listo' : 'Aviso')) : peticion.titulo}
          </h3>
        )}
        {(peticion.detalle || (esAviso && typeof peticion.mensaje === 'string' && peticion.mensaje.length >= 60)) && (
          <p id="dialogo-detalle" className="text-sm text-gray-600 font-medium mb-1">{peticion.detalle}</p>
        )}
        {esAviso && (
          <p id="dialogo-detalle" className="text-sm text-gray-600 font-medium mb-1">{peticion.mensaje}</p>
        )}
        {peticion.consecuencia && (
          <p className="text-xs text-gray-500 font-medium mt-2 mb-1">↳ {peticion.consecuencia}</p>
        )}
        {esTexto && (
          <label className="block mt-3">
            <span className="block text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1">
              {peticion.etiqueta || 'Escribe para confirmar'}
            </span>
            <input
              type="text"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={peticion.placeholder || ''}
              autoComplete="off"
              className="w-full min-h-[48px] p-3 border border-gray-300 rounded-xl text-sm font-mono focus:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
            />
          </label>
        )}
        <div className="flex gap-2 mt-5">
          {!esAviso && (
            <button
              type="button"
              onClick={() => onCerrar(esTexto ? null : false)}
              className="flex-1 min-h-[48px] py-3 bg-gray-100 text-gray-700 font-bold rounded-xl text-sm active:scale-95 transition-transform"
            >
              {peticion.cancelarTexto}
            </button>
          )}
          <button
            ref={confirmarRef}
            type="button"
            disabled={esTexto && !coincide}
            onClick={() => onCerrar(esTexto ? texto.trim() : (esAviso ? undefined : true))}
            className={`flex-1 min-h-[48px] py-3 font-bold rounded-xl text-sm active:scale-95 transition-transform disabled:opacity-40 ${variante.boton}`}
          >
            {esAviso ? 'Entendido' : peticion.confirmarTexto || 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  );
}
