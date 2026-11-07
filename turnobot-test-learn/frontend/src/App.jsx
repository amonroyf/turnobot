import React, { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { auth, db, provider, signInWithPopup, signOut, onAuthStateChanged } from "./firebase.js";
import { CATALOGO_PRUEBAS } from "./conceptos.js";

export default function App() {
  const [user, setUser] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState("http");
  const [tagActivo, setTagActivo] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "test_runs"), orderBy("timestamp", "desc"), limit(50));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRuns(data);
      if (data.length > 0 && !selected) setSelected(data[0]);
    });
    return () => unsub();
  }, [user]);

  const infoConcepto = selected
    ? CATALOGO_PRUEBAS[selected.test_name] || {
        categoria: "Prueba General",
        colorCategoria: "#64748b",
        etiquetas: [{ nombre: "Test Unitario", color: "#64748b", definicion: "Evalúa una función o flujo específico del sistema de forma aislada." }],
        reglaNegocio: selected.test_name,
        explicacionRegla: "Prueba técnica ejecutada sobre el motor de TurnoBot.",
        porQueImporta: "Garantiza la estabilidad del código ante modificaciones."
      }
    : null;

  if (!user) {
    return (
      <div style={{ padding: 40, fontFamily: "sans-serif", textAlign: "center" }}>
        <h1>TurnoBot Test &amp; Learn</h1>
        <p style={{ color: "#666" }}>Laboratorio de pruebas y conceptos de software</p>
        <button
          onClick={() => signInWithPopup(auth, provider)}
          style={{ padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
        >
          Iniciar sesión con Google
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif", backgroundColor: "#f8fafc" }}>
      <aside style={{ width: 300, borderRight: "1px solid #e2e8f0", padding: 16, backgroundColor: "#fff", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>Historial Tests</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={async () => {
                setRunning(true);
                try {
                  await fetch("https://turnobot-test-learn-backend-850305350371.us-central1.run.app/api/tests/run", { method: "POST" });
                } finally {
                  setTimeout(() => setRunning(false), 3000);
                }
              }}
              disabled={running}
              style={{ fontSize: 11, cursor: "pointer" }}
            >
              {running ? "Ejecutando..." : "▶ Ejecutar"}
            </button>
            <button onClick={() => signOut(auth)} style={{ fontSize: 11, cursor: "pointer" }}>Salir</button>
          </div>
        </div>

        {runs.map((r) => {
          const isSelected = selected?.id === r.id;
          const ficha = CATALOGO_PRUEBAS[r.test_name];
          return (
            <div
              key={r.id}
              onClick={() => { setSelected(r); setTagActivo(null); }}
              style={{
                padding: 10,
                marginBottom: 8,
                border: "1px solid",
                borderColor: isSelected ? "#2563eb" : "#e2e8f0",
                borderRadius: 8,
                cursor: "pointer",
                backgroundColor: isSelected ? "#eff6ff" : "#fff",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{r.test_name}</div>
              {ficha && (
                <span style={{ fontSize: 10, color: ficha.colorCategoria, fontWeight: 700 }}>
                  ● {ficha.categoria}
                </span>
              )}
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                ⏱ {r.duration_ms || 0} ms | HTTP {r.http_response?.status_code || 200}
              </div>
            </div>
          );
        })}
      </aside>

      <main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {!selected ? (
          <div style={{ padding: 40, color: "#94a3b8" }}>Selecciona una prueba del historial.</div>
        ) : (
          <>
            <section style={{ flex: 1.1, borderRight: "1px solid #e2e8f0", backgroundColor: "#fff", padding: 24, overflowY: "auto" }}>
              <span style={{ backgroundColor: `${infoConcepto.colorCategoria}15`, color: infoConcepto.colorCategoria, fontSize: 11, fontWeight: 800, padding: "4px 8px", borderRadius: 4 }}>
                {infoConcepto.categoria.toUpperCase()}
              </span>

              <h2 style={{ fontSize: 20, color: "#0f172a", margin: "12px 0 8px 0" }}>{infoConcepto.reglaNegocio}</h2>

              <div style={{ margin: "16px 0" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>
                  🏷️ Etiquetas del Concepto (Toca una para ver su definición)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {infoConcepto.etiquetas.map((tag) => (
                    <button
                      key={tag.nombre}
                      onClick={() => setTagActivo(tag)}
                      style={{
                        backgroundColor: tagActivo?.nombre === tag.nombre ? tag.color : "#f1f5f9",
                        color: tagActivo?.nombre === tag.nombre ? "#fff" : "#334155",
                        border: "1px solid #cbd5e1",
                        padding: "5px 10px",
                        borderRadius: 16,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      #{tag.nombre}
                    </button>
                  ))}
                </div>
              </div>

              {tagActivo && (
                <div style={{ backgroundColor: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#166534" }}>📚 Glosario: #{tagActivo.nombre}</div>
                  <p style={{ fontSize: 13, color: "#15803d", margin: "4px 0 0 0", lineHeight: 1.4 }}>{tagActivo.definicion}</p>
                </div>
              )}

              <div style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16, marginBottom: 12 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 12, color: "#475569", textTransform: "uppercase" }}>📖 ¿Qué regla de negocio evalúa?</h4>
                <p style={{ margin: 0, fontSize: 13, color: "#1e293b", lineHeight: 1.5 }}>{infoConcepto.explicacionRegla}</p>
              </div>

              <div style={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 12, color: "#475569", textTransform: "uppercase" }}>🛡️ ¿Por qué es crítico para TurnoBot?</h4>
                <p style={{ margin: 0, fontSize: 13, color: "#1e293b", lineHeight: 1.5 }}>{infoConcepto.porQueImporta}</p>
              </div>
            </section>

            <section style={{ flex: 1, padding: 20, overflowY: "auto", backgroundColor: "#f8fafc" }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {["http", "db", "console"].map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 6,
                      border: "none",
                      backgroundColor: tab === t ? "#0f172a" : "#e2e8f0",
                      color: tab === t ? "#fff" : "#334155",
                      fontWeight: 700,
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                  >
                    {t === "http" ? "🌐 TRÁFICO HTTP" : t === "db" ? "⚡ DELTA FIRESTORE" : "📋 LOGS"}
                  </button>
                ))}
              </div>

              {tab === "http" && (
                <div>
                  <h4 style={{ fontSize: 12, color: "#64748b" }}>Petición HTTP (Request)</h4>
                  <pre style={{ backgroundColor: "#0f172a", color: "#38bdf8", padding: 12, borderRadius: 6, fontSize: 11, overflowX: "auto" }}>
                    {JSON.stringify(selected.http_request, null, 2)}
                  </pre>
                  <h4 style={{ fontSize: 12, color: "#64748b" }}>Respuesta HTTP (Response)</h4>
                  <pre style={{ backgroundColor: "#0f172a", color: "#4ade80", padding: 12, borderRadius: 6, fontSize: 11, overflowX: "auto" }}>
                    {JSON.stringify(selected.http_response, null, 2)}
                  </pre>
                </div>
              )}

              {tab === "db" && (
                <div>
                  <h4 style={{ fontSize: 12, color: "#64748b" }}>Cambios detectados (Delta)</h4>
                  <pre style={{ backgroundColor: "#0f172a", color: "#facc15", padding: 12, borderRadius: 6, fontSize: 11, overflowX: "auto" }}>
                    {JSON.stringify(selected.db_delta, null, 2)}
                  </pre>
                </div>
              )}

              {tab === "console" && (
                <pre style={{ backgroundColor: "#0f172a", color: "#cbd5e1", padding: 12, borderRadius: 6, fontSize: 11, overflowX: "auto" }}>
                  {JSON.stringify(selected.console_logs || ["Sin logs de consola."], null, 2)}
                </pre>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
