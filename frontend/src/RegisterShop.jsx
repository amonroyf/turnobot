import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithPopup } from 'firebase/auth';
import {
  doc,
  collection,
  query,
  where,
  getDocs,
  setDoc,
  addDoc,
} from 'firebase/firestore';
import { auth, provider, db } from './firebase';
import { PAISES, paisPorISO } from './paises.js';

export function esSlugValido(slug) {
  return typeof slug === 'string' && /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug);
}

const defaultHorarioInicial = {
  lunes:     { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  martes:    { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  miercoles: { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  jueves:    { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  viernes:   { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  sabado:    { activo: true,  turnos: [{ inicio: '09:00', fin: '18:00' }] },
  domingo:   { activo: false, turnos: [] },
};

export default function RegisterShop() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    whatsapp: '',
    pais: 'CO',
  });

  const irASuTiendaOCrear = async (currentUser) => {
    try {
      const q = query(
        collection(db, 'negocios'),
        where('owner_uid', '==', currentUser.uid),
      );
      const qs = await getDocs(q);
      if (!qs.empty) {
        navigate('/admin');
        return;
      }
      setUser(currentUser);
      setStep(2);
    } catch (err) {
      console.error(err);
      setError('Hubo un error al verificar tu cuenta. Intenta de nuevo.');
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await signInWithPopup(auth, provider);
      await irASuTiendaOCrear(result.user);
    } catch (err) {
      console.error(err);
      setError('Error al iniciar sesión con Google. Intenta de nuevo.');
    }
    setLoading(false);
  };

  const handleNameChange = (e) => {
    const newName = e.target.value;
    const autoSlug = newName.toLowerCase().trim().replace(/[\s\W-]+/g, '-');
    setFormData({ ...formData, name: newName, slug: autoSlug });
  };

  const handleCompleteRegistration = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const slug = (formData.slug || '').toLowerCase().trim();
    if (!esSlugValido(slug)) {
      setError('El enlace solo puede tener minúsculas, números y guiones (3-50 caracteres).');
      setLoading(false);
      return;
    }

    const paisSel = paisPorISO(formData.pais);
    const waLimpio = formData.whatsapp.replace(/\D/g, '');
    const waLocal = waLimpio.startsWith(paisSel.prefijo) ? waLimpio.slice(paisSel.prefijo.length) : waLimpio;
    if (waLocal.length < (paisSel.minDigitos || 7)) {
      setError(`Ingresa un número de WhatsApp válido de ${paisSel.nombre} (ej. ${paisSel.ejemplo}).`);
      setLoading(false);
      return;
    }
    const whatsappFinal = paisSel.prefijo + waLocal;

    try {
      const API = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${API}/api/v1/b/${slug}/existe`);
      const data = await res.json().catch(() => null);
      if (data?.exists) {
        throw new Error('slug-en-uso');
      }

      await setDoc(doc(db, 'negocios', slug), {
        name: formData.name,
        owner_uid: user.uid,
        pais: (formData.pais || 'CO').toUpperCase(),
        whatsapp: whatsappFinal,
        direccion: '',
        horario: 'Lun a Sáb: 9:00 AM - 6:00 PM',
        telefono: whatsappFinal,
        calendar_id: 'primary',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota',
        open_time: '09:00',
        close_time: '18:00',
        min_notice_minutes: 0,
        booking_window_days: 30,
        cancel_window_hours: 24,
        max_bookings_per_phone_per_day: 3,
        created_at: new Date(),
      });

      await addDoc(collection(db, `negocios/${slug}/empleados`), {
        name: user.displayName || formData.name || 'Atención Principal',
        calendar_id: '',
        servicios_ids: [],
        horario: defaultHorarioInicial,
        created_at: new Date(),
      });

      // El negocio nace configurado: paso 3 "¿qué ofreces?" antes del panel.
      setStep(3);
    } catch (err) {
      console.error(err);
      if (err.message === 'slug-en-uso' || err.code === 'permission-denied') {
        setError('Este enlace ya está en uso. Por favor, elige otro.');
      } else {
        setError('Hubo un error al crear tu página. Intenta de nuevo.');
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <p className="text-xs font-black tracking-widest text-gray-400 uppercase mb-2">TurnoBot</p>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2" aria-label={`Paso ${step} de 3`}>
          Paso {step} de 3
        </p>
        <h2 className="text-3xl font-extrabold text-gray-900">
          {step === 1 ? 'Crea tu cuenta' : step === 2 ? 'Configura tu agenda' : '¿Qué ofreces?'}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          {step === 1
            ? 'Entra con tu cuenta de Google en 1 clic.'
            : step === 2
              ? 'Información básica para que tus clientes reserven.'
              : 'Elige y te dejamos el formulario listo. Lo puedes cambiar cuando quieras.'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow-sm rounded-2xl sm:px-10 border border-gray-100">
          {error && (
            <div role="alert" className="mb-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm text-center font-medium">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex justify-center items-center gap-3 py-3.5 px-4 border border-gray-300 rounded-xl shadow-sm text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50 active:scale-95 transition-transform"
              >
                <img
                  src="https://www.svgrepo.com/show/475656/google-color.svg"
                  alt="Google"
                  className="w-5 h-5"
                />
                {loading ? 'Conectando...' : 'Continuar con Google'}
              </button>
              <p className="text-[11px] text-gray-400 text-center font-medium">
                Sin contraseñas que recordar. Acceso rápido y seguro.
              </p>
            </div>
          )}

          {step === 2 && (
            <form className="space-y-5" onSubmit={handleCompleteRegistration}>
              <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-xl text-center font-medium">
                Cuenta conectada. Completa estos datos para activar tu agenda.
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  ¿Cómo se llama tu negocio?
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Barbería El Corte / Spa Sentirse Bien"
                  value={formData.name}
                  onChange={handleNameChange}
                  className="w-full min-h-[48px] p-3 border border-gray-300 rounded-xl text-sm focus:ring-black focus:border-black"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  WhatsApp para recibir avisos de citas
                </label>
                <div className="flex gap-2">
                  <select
                    value={formData.pais || 'CO'}
                    onChange={(e) => setFormData({ ...formData, pais: e.target.value })}
                    aria-label="País del negocio"
                    className="min-h-[48px] p-3 border border-gray-300 rounded-xl text-sm bg-white font-bold focus:ring-black focus:border-black"
                  >
                    {PAISES.map((p) => (
                      <option key={p.iso} value={p.iso}>{p.bandera} +{p.prefijo}</option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    required
                    inputMode="numeric"
                    placeholder={`Ej. ${paisPorISO(formData.pais).ejemplo}`}
                    value={formData.whatsapp}
                    onChange={(e) => setFormData({ ...formData, whatsapp: e.target.value })}
                    className="flex-1 min-w-0 w-full min-h-[48px] p-3 border border-gray-300 rounded-xl text-sm focus:ring-black focus:border-black"
                  />
                </div>
                <p className="mt-1 text-[11px] text-gray-400 font-medium">
                  Aquí te notificaremos las reservas de tus clientes.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Tu enlace de reservas
                </label>
                <div className="flex rounded-xl shadow-sm">
                  <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-xs font-mono">
                    {window.location.host}/shop/
                  </span>
                  <input
                    type="text"
                    required
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                      })
                    }
                    className="flex-1 block w-full min-w-0 min-h-[48px] p-3 border border-gray-300 rounded-none rounded-r-xl text-sm focus:ring-black focus:border-black"
                  />
                </div>
                {!esSlugValido((formData.slug || '').toLowerCase().trim()) && formData.slug && (
                  <p role="alert" className="mt-1 text-[11px] text-red-600 font-semibold">
                    El enlace debe tener mínimo 3 caracteres (solo letras, números y guiones).
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center items-center py-3.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50 min-h-[52px] active:scale-95 transition-transform"
              >
                {loading ? 'Creando tu agenda...' : 'Activar mi agenda de reservas'}
              </button>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-xl text-center font-medium">
                ¡Tu página está lista! Ahora cuéntanos qué ofreces.
              </div>
              {[
                { id: 'cita', icon: '✂️', titulo: 'Citas', ej: 'ej. corte 30 min' },
                { id: 'clase', icon: '🧘', titulo: 'Clases', ej: 'ej. yoga viernes' },
                { id: 'evento', icon: '📅', titulo: 'Evento', ej: 'ej. torneo sábado' },
              ].map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => navigate(`/admin?ofrecer=${o.id}`)}
                  aria-label={`Ofrecer: ${o.titulo}`}
                  className="w-full flex items-center gap-3 p-4 border border-gray-200 rounded-2xl bg-white text-left active:scale-[0.98] transition-transform hover:border-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black"
                >
                  <span className="text-3xl" aria-hidden="true">{o.icon}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-black text-gray-900">{o.titulo}</span>
                    <span className="block text-[11px] font-medium text-gray-500">{o.ej}</span>
                  </span>
                  <span aria-hidden="true" className="text-gray-300 font-black">›</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => navigate('/admin')}
                className="w-full py-3 text-xs font-bold text-gray-500 underline"
              >
                Hacer después →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
