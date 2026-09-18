import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  signInWithPopup,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import {
  doc,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  setDoc,
} from 'firebase/firestore';
import { auth, provider, db } from './firebase';

// Slug válido: minúsculas, números y guiones; 3-50 caracteres; sin guiones
// en los extremos. Evita IDs que rompan rutas (/shop/:slug) o Firestore.
export function esSlugValido(slug) {
  return typeof slug === 'string' && /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/.test(slug);
}

export default function RegisterShop() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [user, setUser] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    email: '',
    password: '',
  });

  // Tras autenticarse (Google o correo): si el usuario ya tiene tienda va al
  // panel; si no, pasa al paso 2 para elegir nombre y enlace.
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

  // Paso 1a: Inicio de sesión con Google (popup)
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

  // Paso 1b: Registro alternativo con correo y contraseña
  const handlePasswordRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password,
      );
      await irASuTiendaOCrear(userCredential.user);
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Este correo ya está registrado. Prueba con otra cuenta.');
      } else if (err.code === 'auth/weak-password') {
        setError('La contraseña debe tener al menos 6 caracteres.');
      } else if (err.code === 'auth/invalid-email') {
        setError('El correo no es válido.');
      } else {
        setError('Hubo un error al crear la cuenta. Intenta de nuevo.');
      }
    }
    setLoading(false);
  };

  // Paso 2: nombre y slug del negocio
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

    try {
      // Verificar y crear (getDoc + setDoc) para evitar cuelgues de runTransaction en headless.
      const docRef = doc(db, 'negocios', slug);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        throw new Error('slug-en-uso');
      }
      await setDoc(docRef, {
        name: formData.name,
        owner_uid: user.uid,
        whatsapp: '',
        direccion: '',
        horario: '',
        telefono: '',
        calendar_id: 'primary',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        open_time: '09:00',
        close_time: '18:00',
        min_notice_minutes: 0,
        created_at: new Date(),
      });

      navigate('/admin');
    } catch (err) {
      console.error(err);
      if (err.message === 'slug-en-uso') {
        setError('Este enlace ya está en uso. Por favor, elige otro.');
      } else {
        setError('Hubo un error al crear la tienda. Intenta de nuevo.');
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <p className="text-xs font-black tracking-widest text-gray-400 uppercase mb-2">TurnoBot</p>
        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mb-2" aria-label={`Paso ${step} de 2`}>
          Paso {step} de 2
        </p>
        <h2 className="text-3xl font-extrabold text-gray-900">
          {step === 1 ? 'Crea tu cuenta' : 'Nombra tu página'}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          {step === 1
            ? 'Con esta cuenta entrarás a tu agenda. Te toma 1 minuto.'
            : 'Así te encontrarán tus clientes para reservar.'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-6 shadow rounded-2xl sm:px-10 border border-gray-100">
          {error && (
            <div role="alert" className="mb-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm text-center font-medium">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full flex justify-center items-center gap-3 py-3 px-4 border border-gray-300 rounded-xl shadow-sm text-sm font-bold text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50"
              >
                <img
                  src="https://www.svgrepo.com/show/475656/google-color.svg"
                  alt="Google"
                  className="w-5 h-5"
                />
                {loading ? 'Conectando...' : 'Continuar con Google'}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center text-[11px]">
                  <span className="bg-white px-4 font-bold uppercase tracking-widest text-gray-400">o</span>
                </div>
              </div>

              {!showPassword ? (
                <button
                  onClick={() => setShowPassword(true)}
                  className="w-full text-center text-sm font-bold text-gray-600 hover:text-black underline underline-offset-4 decoration-gray-300"
                >
                  ¿Prefieres crear tu cuenta con correo y contraseña?
                </button>
              ) : (
                <form className="space-y-4" onSubmit={handlePasswordRegister}>
                  <label className="block">
                    <span className="block text-xs font-bold text-gray-700 mb-1">Correo electrónico</span>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="tucorreo@ejemplo.com"
                    aria-label="Correo electrónico"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className="w-full min-h-[48px] p-3 border border-gray-300 rounded-xl text-sm focus:ring-black focus:border-black"
                  />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-bold text-gray-700 mb-1">Contraseña (mínimo 6 caracteres)</span>
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="••••••"
                    aria-label="Contraseña de mínimo 6 caracteres"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    className="w-full min-h-[48px] p-3 border border-gray-300 rounded-xl text-sm focus:ring-black focus:border-black"
                  />
                  </label>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50"
                  >
                    {loading ? 'Creando cuenta...' : 'Crear cuenta con correo'}
                  </button>
                </form>
              )}
            </div>
          )}

          {step === 2 && (
            <form className="space-y-5" onSubmit={handleCompleteRegistration}>
              <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg text-center font-medium">
                ✅ Cuenta lista. Ahora crea tu página de reservas.
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700">
                  ¿Cómo se llama tu negocio?
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Barbería El Corte"
                  value={formData.name}
                  onChange={handleNameChange}
                  className="mt-1 w-full min-h-[48px] p-3 border border-gray-300 rounded-xl focus:ring-black focus:border-black"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700">
                  Tu enlace para compartir
                </label>
                <div className="mt-1 flex rounded-xl shadow-sm">
                  <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">
                    {window.location.host}/shop/
                  </span>
                  <input
                    type="text"
                    required
                    aria-describedby="ayuda-enlace"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                      })
                    }
                    className="flex-1 block w-full min-w-0 min-h-[48px] p-3 border border-gray-300 rounded-none rounded-r-xl focus:ring-black focus:border-black"
                  />
                </div>
                <p id="ayuda-enlace" className="mt-2 text-[11px] text-gray-500 font-medium">
                  Solo minúsculas, números y guiones. Tus clientes entrarán a <strong>{window.location.host}/shop/{formData.slug || 'tu-enlace'}</strong>
                </p>
                {!esSlugValido((formData.slug || '').toLowerCase().trim()) && formData.slug && (
                  <p role="alert" className="mt-1 text-[11px] text-red-600 font-semibold">
                    Revisa el enlace: mínimo 3 caracteres, sin espacios ni símbolos.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50 min-h-[52px]"
              >
                {loading ? 'Creando tu página...' : 'Crear mi página de reservas'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}