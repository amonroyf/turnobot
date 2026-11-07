import React, { useEffect, useState } from "react";
import { auth, provider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase.js";
import ProfessionalDashboard from "./ProfessionalDashboard.jsx";

export default function App() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  if (!user) {
    return (
      <div style={{ padding: 40, fontFamily: "sans-serif", textAlign: "center" }}>
        <h1>TurnoBot QA Platform</h1>
        <p style={{ color: "#666" }}>Laboratorio de pruebas y trazabilidad</p>
        <button
          onClick={() => signInWithPopup(auth, provider)}
          style={{ padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Iniciar sesión con Google
        </button>
      </div>
    );
  }

  return <ProfessionalDashboard user={user} />;
}
