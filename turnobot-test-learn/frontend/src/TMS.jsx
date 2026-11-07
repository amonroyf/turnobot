import React, { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, limit, addDoc, deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "./firebase.js";

const API_BASE = "https://turnobot-test-learn-backend-850305350371.us-central1.run.app";

const TABS = [
  { id: "dashboard", label: "📊 Dashboard" },
  { id: "requirements", label: "📋 Requisitos" },
  { id: "cases", label: "🧪 Casos" },
  { id: "suites", label: "📦 Suites" },
  { id: "manual", label: "✍️ Ejecución Manual" },
  { id: "defects", label: "🐛 Defectos" },
  { id: "traceability", label: "🔗 Trazabilidad" },
];

function useCollection(name, orderField = "created_at") {
  const [data, setData] = useState([]);
  useEffect(() => {
    const q = query(collection(db, name), orderBy(orderField, "desc"), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setData(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [name, orderField]);
  return data;
}

export default function TMS({ user }) {
  const [tab, setTab] = useState("dashboard");
  const requirements = useCollection("requirements");
  const cases = useCollection("test_cases");
  const suites = useCollection("test_suites");
  const defects = useCollection("defects");
  const runs = useCollection("test_runs", "timestamp");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "sans-serif", backgroundColor: "#f8fafc" }}>
      <div style={{ display: "flex", gap: 6, padding: 12, borderBottom: "1px solid #e2e8f0", backgroundColor: "#fff", flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              backgroundColor: tab === t.id ? "#0f172a" : "#e2e8f0",
              color: tab === t.id ? "#fff" : "#334155",
              fontWeight: 700,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {tab === "dashboard" && <Dashboard requirements={requirements} cases={cases} suites={suites} defects={defects} runs={runs} />}
        {tab === "requirements" && <RequirementsView requirements={requirements} />}
        {tab === "cases" && <CasesView cases={cases} requirements={requirements} suites={suites} />}
        {tab === "suites" && <SuitesView suites={suites} cases={cases} />}
        {tab === "manual" && <ManualView cases={cases} user={user} />}
        {tab === "defects" && <DefectsView defects={defects} cases={cases} requirements={requirements} />}
        {tab === "traceability" && <TraceabilityView requirements={requirements} cases={cases} defects={defects} />}
      </div>
    </div>
  );
}

function Dashboard({ requirements, cases, suites, defects, runs }) {
  const totalCases = cases.length;
  const covered = new Set(runs.map((r) => r.test_case_id).filter(Boolean)).size;
  const coverage = totalCases ? Math.round((covered / totalCases) * 100) : 0;
  const pass = runs.filter((r) => r.status === "pass").length;
  const fail = runs.filter((r) => r.status === "fail").length;
  const openDefects = defects.filter((d) => d.status === "open").length;
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Dashboard de Calidad</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[
          ["Requisitos", requirements.length, "#2563eb"],
          ["Casos de Prueba", cases.length, "#7c3aed"],
          ["Suites", suites.length, "#0891b2"],
          ["Defectos Abiertos", openDefects, "#dc2626"],
        ].map(([label, val, color]) => (
          <div key={label} style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color }}>{val}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
        <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>COBERTURA DE CASOS</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#16a34a" }}>{coverage}%</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{covered} de {totalCases} casos ejecutados</div>
        </div>
        <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 8 }}>RESULTADOS DE EJECUCIÓN</div>
          <div style={{ fontSize: 14 }}>✅ Pass: <b>{pass}</b></div>
          <div style={{ fontSize: 14 }}>❌ Fail: <b>{fail}</b></div>
          <div style={{ fontSize: 14 }}>Total runs: <b>{runs.length}</b></div>
        </div>
      </div>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Últimas ejecuciones</h3>
      <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 8 }}>
        {runs.slice(0, 10).map((r) => (
          <div key={r.id} style={{ padding: 6, borderBottom: "1px solid #f1f5f9", fontSize: 12, display: "flex", justifyContent: "space-between" }}>
            <span>{r.test_name || r.test_case_id}</span>
            <span style={{ color: r.status === "pass" ? "#16a34a" : r.status === "fail" ? "#dc2626" : "#64748b", fontWeight: 700 }}>{r.status}</span>
          </div>
        ))}
        {runs.length === 0 && <div style={{ color: "#94a3b8", fontSize: 12 }}>Sin ejecuciones.</div>}
      </div>
    </div>
  );
}

function RequirementsView({ requirements }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const create = async () => {
    if (!title.trim()) return;
    await addDoc(collection(db, "requirements"), { title, description: desc, status: "draft", owner: "", created_at: new Date() });
    setTitle(""); setDesc("");
  };
  const remove = async (id) => { await deleteDoc(doc(db, "requirements", id)); };
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Requisitos</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input placeholder="Título del requisito" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
        <input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ flex: 2, padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
        <button onClick={create} style={{ padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" }}>+ Crear</button>
      </div>
      {requirements.map((r) => (
        <div key={r.id} style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>{r.title}</b>
            <button onClick={() => remove(r.id)} style={{ fontSize: 11, color: "#dc2626", border: "none", background: "none", cursor: "pointer" }}>Eliminar</button>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{r.description}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Estado: {r.status}</div>
        </div>
      ))}
      {requirements.length === 0 && <div style={{ color: "#94a3b8" }}>Sin requisitos.</div>}
    </div>
  );
}

function CasesView({ cases, requirements, suites }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState("manual");
  const [priority, setPriority] = useState("medium");
  const [reqIds, setReqIds] = useState([]);
  const [steps, setSteps] = useState([{ action: "", expected: "" }]);
  const create = async () => {
    if (!title.trim()) return;
    const stepsClean = steps.map((s, i) => ({ order: i + 1, action: s.action, expected: s.expected })).filter((s) => s.action.trim());
    await addDoc(collection(db, "test_cases"), {
      title, description: desc, type, priority, steps: stepsClean,
      requirement_ids: reqIds, suite_ids: [], tags: [], version: 1, created_at: new Date(),
    });
    setTitle(""); setDesc(""); setSteps([{ action: "", expected: "" }]); setReqIds([]);
  };
  const remove = async (id) => { await deleteDoc(doc(db, "test_cases", id)); };
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Casos de Prueba</h2>
      <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} style={{ flex: 1, padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }} />
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
            <option value="manual">Manual</option>
            <option value="automated">Automatizado</option>
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #e2e8f0" }}>
            <option value="low">Baja</option>
            <option value="medium">Media</option>
            <option value="high">Alta</option>
          </select>
        </div>
        <input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 8 }} />
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Pasos</div>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input placeholder="Acción" value={s.action} onChange={(e) => { const c = [...steps]; c[i].action = e.target.value; setSteps(c); }} style={{ flex: 1, padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }} />
            <input placeholder="Resultado esperado" value={s.expected} onChange={(e) => { const c = [...steps]; c[i].expected = e.target.value; setSteps(c); }} style={{ flex: 1, padding: 6, borderRadius: 6, border: "1px solid #e2e8f0" }} />
          </div>
        ))}
        <button onClick={() => setSteps([...steps, { action: "", expected: "" }])} style={{ fontSize: 11, marginBottom: 8, cursor: "pointer" }}>+ Paso</button>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Requisitos vinculados</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {requirements.map((r) => (
            <label key={r.id} style={{ fontSize: 11 }}>
              <input type="checkbox" checked={reqIds.includes(r.id)} onChange={(e) => {
                if (e.target.checked) setReqIds([...reqIds, r.id]); else setReqIds(reqIds.filter((x) => x !== r.id));
              }} /> {r.title}
            </label>
          ))}
        </div>
        <button onClick={create} style={{ padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: "#7c3aed", color: "#fff", fontWeight: 700, cursor: "pointer" }}>+ Crear Caso</button>
      </div>
      {cases.map((c) => (
        <div key={c.id} style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>{c.title}</b>
            <button onClick={() => remove(c.id)} style={{ fontSize: 11, color: "#dc2626", border: "none", background: "none", cursor: "pointer" }}>Eliminar</button>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{c.description}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{c.type} · {c.priority} · {c.steps?.length || 0} pasos</div>
        </div>
      ))}
      {cases.length === 0 && <div style={{ color: "#94a3b8" }}>Sin casos.</div>}
    </div>
  );
}

function SuitesView({ suites, cases }) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [caseIds, setCaseIds] = useState([]);
  const create = async () => {
    if (!name.trim()) return;
    await addDoc(collection(db, "test_suites"), { name, description: desc, case_ids: caseIds, params: {}, parent_id: "", created_at: new Date() });
    setName(""); setDesc(""); setCaseIds([]);
  };
  const fork = async (id) => {
    await fetch(`${API_BASE}/api/test-suites/${id}/fork`, { method: "POST" });
  };
  const remove = async (id) => { await deleteDoc(doc(db, "test_suites", id)); };
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Suites de Prueba</h2>
      <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <input placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 8 }} />
        <input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 8 }} />
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Casos incluidos</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {cases.map((c) => (
            <label key={c.id} style={{ fontSize: 11 }}>
              <input type="checkbox" checked={caseIds.includes(c.id)} onChange={(e) => {
                if (e.target.checked) setCaseIds([...caseIds, c.id]); else setCaseIds(caseIds.filter((x) => x !== c.id));
              }} /> {c.title}
            </label>
          ))}
        </div>
        <button onClick={create} style={{ padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: "#0891b2", color: "#fff", fontWeight: 700, cursor: "pointer" }}>+ Crear Suite</button>
      </div>
      {suites.map((s) => (
        <div key={s.id} style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>{s.name}</b>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => fork(s.id)} style={{ fontSize: 11, cursor: "pointer" }}>Fork</button>
              <button onClick={() => remove(s.id)} style={{ fontSize: 11, color: "#dc2626", border: "none", background: "none", cursor: "pointer" }}>Eliminar</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{s.description}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{s.case_ids?.length || 0} casos · parent: {s.parent_id || "—"}</div>
        </div>
      ))}
      {suites.length === 0 && <div style={{ color: "#94a3b8" }}>Sin suites.</div>}
    </div>
  );
}

function ManualView({ cases, user }) {
  const [selectedCase, setSelectedCase] = useState(null);
  const [stepStatus, setStepStatus] = useState({});
  const [executedBy, setExecutedBy] = useState(user?.email || "");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const runCase = async () => {
    if (!selectedCase) return;
    setSubmitting(true);
    const stepResults = (selectedCase.steps || []).map((s, i) => ({
      step_order: s.order || i + 1,
      status: stepStatus[i] || "pending",
    }));
    try {
      const res = await fetch(`${API_BASE}/api/test-cases/${selectedCase.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executed_by: executedBy, environment: "manual", step_results: stepResults, duration_ms: 0 }),
      });
      const data = await res.json();
      setMsg("Guardado: " + (data.id || res.status));
    } catch (e) {
      setMsg("Error: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Ejecución Manual</h2>
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ width: 280 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Seleccionar caso</div>
          {cases.filter((c) => c.type === "manual" || !c.type).map((c) => (
            <div
              key={c.id}
              onClick={() => { setSelectedCase(c); setStepStatus({}); setMsg(""); }}
              style={{
                padding: 8, marginBottom: 6, borderRadius: 6, cursor: "pointer",
                backgroundColor: selectedCase?.id === c.id ? "#eff6ff" : "#fff",
                border: "1px solid #e2e8f0",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700 }}>{c.title}</div>
            </div>
          ))}
          {cases.length === 0 && <div style={{ color: "#94a3b8", fontSize: 12 }}>Sin casos.</div>}
        </div>
        <div style={{ flex: 1 }}>
          {!selectedCase ? (
            <div style={{ color: "#94a3b8" }}>Selecciona un caso.</div>
          ) : (
            <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 16 }}>
              <h3 style={{ fontSize: 16, margin: "0 0 8px" }}>{selectedCase.title}</h3>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 12 }}>{selectedCase.description}</div>
              {(selectedCase.steps || []).map((s, i) => (
                <div key={i} style={{ marginBottom: 10, padding: 10, backgroundColor: "#f8fafc", borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>Paso {s.order || i + 1}: {s.action}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Esperado: {s.expected}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    {["pass", "fail", "skip"].map((st) => (
                      <button
                        key={st}
                        onClick={() => setStepStatus({ ...stepStatus, [i]: st })}
                        style={{
                          padding: "4px 10px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11,
                          backgroundColor: stepStatus[i] === st ? (st === "pass" ? "#16a34a" : st === "fail" ? "#dc2626" : "#64748b") : "#e2e8f0",
                          color: stepStatus[i] === st ? "#fff" : "#334155",
                        }}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <input placeholder="Ejecutado por" value={executedBy} onChange={(e) => setExecutedBy(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", marginRight: 8 }} />
                <button onClick={runCase} disabled={submitting} style={{ padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: "#16a34a", color: "#fff", fontWeight: 700, cursor: "pointer" }}>
                  {submitting ? "Guardando..." : "Registrar ejecución"}
                </button>
              </div>
              {msg && <div style={{ marginTop: 8, fontSize: 12, color: "#334155" }}>{msg}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DefectsView({ defects, cases, requirements }) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [caseIds, setCaseIds] = useState([]);
  const create = async () => {
    if (!title.trim()) return;
    await addDoc(collection(db, "defects"), { title, description: desc, severity, status: "open", case_ids: caseIds, requirement_ids: [], created_at: new Date() });
    setTitle(""); setDesc(""); setCaseIds([]);
  };
  const updateStatus = async (id, status) => {
    await updateDoc(doc(db, "defects", id), { status });
  };
  const remove = async (id) => { await deleteDoc(doc(db, "defects", id)); };
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Defectos</h2>
      <div style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, marginBottom: 16 }}>
        <input placeholder="Título" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 8 }} />
        <input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} style={{ width: "100%", padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 8 }} />
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} style={{ padding: 8, borderRadius: 6, border: "1px solid #e2e8f0", marginBottom: 8 }}>
          <option value="low">Baja</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
          <option value="critical">Crítica</option>
        </select>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Casos afectados</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {cases.map((c) => (
            <label key={c.id} style={{ fontSize: 11 }}>
              <input type="checkbox" checked={caseIds.includes(c.id)} onChange={(e) => {
                if (e.target.checked) setCaseIds([...caseIds, c.id]); else setCaseIds(caseIds.filter((x) => x !== c.id));
              }} /> {c.title}
            </label>
          ))}
        </div>
        <button onClick={create} style={{ padding: "8px 14px", borderRadius: 6, border: "none", backgroundColor: "#dc2626", color: "#fff", fontWeight: 700, cursor: "pointer" }}>+ Reportar Defecto</button>
      </div>
      {defects.map((d) => (
        <div key={d.id} style={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <b>{d.title}</b>
            <button onClick={() => remove(d.id)} style={{ fontSize: 11, color: "#dc2626", border: "none", background: "none", cursor: "pointer" }}>Eliminar</button>
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{d.description}</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{d.severity} · {d.case_ids?.length || 0} casos</div>
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            {["open", "in_progress", "resolved", "closed"].map((st) => (
              <button key={st} onClick={() => updateStatus(d.id, st)} style={{
                fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "none", cursor: "pointer",
                backgroundColor: d.status === st ? "#0f172a" : "#e2e8f0",
                color: d.status === st ? "#fff" : "#334155",
              }}>{st}</button>
            ))}
          </div>
        </div>
      ))}
      {defects.length === 0 && <div style={{ color: "#94a3b8" }}>Sin defectos.</div>}
    </div>
  );
}

function TraceabilityView({ requirements, cases, defects }) {
  return (
    <div>
      <h2 style={{ fontSize: 18, marginBottom: 12 }}>Matriz de Trazabilidad</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ backgroundColor: "#f1f5f9" }}>
              <th style={{ padding: 8, textAlign: "left" }}>Requisito</th>
              <th style={{ padding: 8, textAlign: "left" }}>Casos vinculados</th>
              <th style={{ padding: 8, textAlign: "left" }}>Defectos</th>
            </tr>
          </thead>
          <tbody>
            {requirements.map((r) => {
              const linkedCases = cases.filter((c) => (c.requirement_ids || []).includes(r.id));
              const linkedDefects = defects.filter((d) => (d.requirement_ids || []).includes(r.id));
              return (
                <tr key={r.id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                  <td style={{ padding: 8, fontWeight: 700 }}>{r.title}</td>
                  <td style={{ padding: 8 }}>{linkedCases.length ? linkedCases.map((c) => c.title).join(", ") : "—"}</td>
                  <td style={{ padding: 8 }}>{linkedDefects.length ? linkedDefects.map((d) => d.title).join(", ") : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {requirements.length === 0 && <div style={{ color: "#94a3b8", marginTop: 12 }}>Sin requisitos. Crea requisitos y vincúlalos a casos.</div>}
      <div style={{ marginTop: 16, fontSize: 12, color: "#64748b" }}>
        Nota: los defectos se vinculan a requisitos si se agregan manualmente en Firestore o mediante extensión futura.
      </div>
    </div>
  );
}
