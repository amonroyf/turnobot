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
  runTransaction,
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
      // Transacción: verificar y crear atómicamente para que dos registros
      // simultáneos con el mismo enlace no se sobrescriban entre sí.
      await runTransaction(db, async (tx) => {
        const docRef = doc(db, 'negocios', slug);
        const docSnap = await tx.get(docRef);
        if (docSnap.exists()) {
          throw new Error('slug-en-uso');
        }
        tx.set(docRef, {
          name: formData.name,
          owner_uid: user.uid, // <-- Blindamos la regla de seguridad multi-tenant
          whatsapp: '',
          direccion: '',
          horario: '',
          telefono: '',
          calendar_id: 'primary',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          open_time: '09:00',
          close_time: '18:00',
          created_at: new Date(),
        });
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
        <h2 className="text-3xl font-extrabold text-gray-900">
          {step === 1 ? 'Crea tu Cuenta' : 'Configura tu Negocio'}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          {step === 1
            ? 'Empieza a recibir reservas automáticamente'
            : 'Elige cómo te encontrarán tus clientes'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-gray-100">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm text-center">
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
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-3 text-gray-400">o</span>
                </div>
              </div>

              {!showPassword ? (
                <button
                  onClick={() => setShowPassword(true)}
                  className="w-full text-center text-sm font-semibold text-gray-500 hover:text-gray-700"
                >
                  ¿Prefieres crear tu cuenta con correo y contraseña?
                </button>
              ) : (
                <form className="space-y-4" onSubmit={handlePasswordRegister}>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    placeholder="Correo electrónico"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:ring-black focus:border-black"
                  />
                  <input
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="Contraseña (mínimo 6 caracteres)"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:ring-black focus:border-black"
                  />
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
              <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg text-center">
                Sesión iniciada. Solo falta configurar tu negocio.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Nombre del Local
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ej. Clínica Wellness / Auto Detailing"
                  value={formData.name}
                  onChange={handleNameChange}
                  className="mt-1 w-full p-3 border border-gray-300 rounded-xl focus:ring-black focus:border-black"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Tu Enlace Personalizado
                </label>
                <div className="mt-1 flex rounded-xl shadow-sm">
                  <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">
                    tu-saas.com/shop/
                  </span>
                  <input
                    type="text"
                    required
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        slug: e.target.value.toLowerCase(),
                      })
                    }
                    className="flex-1 block w-full min-w-0 p-3 border border-gray-300 rounded-none rounded-r-xl focus:ring-black focus:border-black"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50"
              >
                {loading ? 'Validando...' : 'Finalizar Configuración'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}