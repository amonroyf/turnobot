import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from './firebase';

export default function RegisterShop() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    email: '',
    password: ''
  });

  const handleNameChange = (e) => {
    const newName = e.target.value;
    const autoSlug = newName
      .toLowerCase()
      .trim()
      .replace(/[\s\W-]+/g, '-');
    setFormData({ ...formData, name: newName, slug: autoSlug });
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // 1. Verificar si el slug ya existe antes de crear el usuario
      const docRef = doc(db, 'negocios', formData.slug);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        setError('Este enlace ya está en uso. Por favor, elige otro.');
        setLoading(false);
        return;
      }

      // 2. Crear la cuenta de usuario en Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        formData.email,
        formData.password
      );
      const user = userCredential.user;

      // 3. Crear el documento del negocio en Firestore (inyectando el owner_uid)
      await setDoc(docRef, {
        name: formData.name,
        owner_uid: user.uid, // <-- Blindamos la regla de seguridad multi-tenant
        whatsapp: '',
        direccion: '',
        horario: '',
        telefono: '',
        calendar_id: 'primary',
        created_at: new Date()
      });

      // 4. Redirigir al panel de administración
      navigate('/admin');
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setError('Este correo ya está registrado.');
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h2 className="text-3xl font-extrabold text-gray-900">Crea tu Barbería</h2>
        <p className="mt-2 text-sm text-gray-600">
          Empieza a recibir reservas automáticamente
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-2xl sm:px-10 border border-gray-100">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}

          <form className="space-y-5" onSubmit={handleRegister}>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Nombre del Local
              </label>
              <input
                type="text"
                required
                placeholder="Ej. Barbería VIP"
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
                    setFormData({ ...formData, slug: e.target.value.toLowerCase() })
                  }
                  className="flex-1 block w-full min-w-0 p-3 border border-gray-300 rounded-none rounded-r-xl focus:ring-black focus:border-black"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Correo Electrónico
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="mt-1 w-full p-3 border border-gray-300 rounded-xl focus:ring-black focus:border-black"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Contraseña
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={formData.password}
                onChange={(e) =>
                  setFormData({ ...formData, password: e.target.value })
                }
                className="mt-1 w-full p-3 border border-gray-300 rounded-xl focus:ring-black focus:border-black"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-black hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-black disabled:opacity-50"
            >
              {loading ? 'Creando cuenta...' : 'Crear mi cuenta gratis'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
