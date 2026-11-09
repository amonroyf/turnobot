import React, { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, orderBy, query, limit } from "firebase/firestore";
import { db, auth, signOut } from "./firebase.js";
import { CATALOGO_PRUEBAS } from "./conceptos.js";

const BACKEND_URL = "https://turnobot-test-learn-backend-850305350371.us-central1.run.app";

export default function ProfessionalDashboard({ user }) {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [activeTab, setActiveTab] = useState("diff");
  const [searchFilter, setSearchFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "test_runs"), orderBy("timestamp", "desc"), limit(100));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRuns(data);
      if (data.length > 0 && !selectedRunId) {
        setSelectedRunId(data[0].id);
      }
    });
    return () => unsub();
  }, [selectedRunId]);

  const selectedRun = useMemo(() => {
    return runs.find((r) => r.id === selectedRunId) || runs[0] || null;
  }, [runs, selectedRunId]);

  const stats = useMemo(() => {
    const total = runs.length;
    if (total === 0) return { passRate: 0, passed: 0, failed: 0, avgTime: 0, flaky: 0 };
    const passed = runs.filter((r) => r.status === "pass").length;
    const failed = runs.filter((r) => r.status === "fail").length;
    const totalDuration = runs.reduce((acc, r) => acc + (Number(r.duration_ms) || 0), 0);

    const statusByName = {};
    runs.forEach((r) => {
      if (!statusByName[r.test_name]) statusByName[r.test_name] = new Set();
      if (r.status) statusByName[r.test_name].add(r.status);
    });
    const flakyCount = Object.values(statusByName).filter((set) => set.has("pass") && set.has("fail")).length;

    return {
      passRate: Math.round((passed / total) * 100),
      passed,
      failed,
      avgTime: Math.round(totalDuration / total),
      flaky: flakyCount,
    };
  }, [runs]);

  const filteredRuns = useMemo(() => {
    return runs.filter((r) => {
      const matchText = (r.test_name || "").toLowerCase().includes(searchFilter.toLowerCase());
      const matchStatus = statusFilter === "all" || r.status === statusFilter;
      return matchText && matchStatus;
    });
  }, [runs, searchFilter, statusFilter]);

  const triggerRun = async () => {
    setIsRunning(true);
    try {
      await fetch(`${BACKEND_URL}/api/tests/run`, { method: "POST" });
    } catch (e) {
      console.error("Error triggering tests:", e);
    } finally {
      setTimeout(() => setIsRunning(false), 2500);
    }
  };

  const metadata = selectedRun ? CATALOGO_PRUEBAS[selectedRun.test_name] : null;

  return (
    <div style={css.root}>
      <header style={css.header}>
        <div style={css.branding}>
          <div style={css.logo}>TB</div>
          <div>
            <div style={css.brandTitle}>TURNOBOT QA PLATFORM</div>
            <div style={css.brandSubtitle} title="Plataforma unificada de ejecución, trazabilidad y depuración de pruebas.">Automated Testing Engine & Traceability Matrix</div>
          </div>
        </div>

        <div style={css.actionsBar}>
          <button
            onClick={triggerRun}
            disabled={isRunning}
            style={{ ...css.btnPrimary, opacity: isRunning ? 0.6 : 1 }}
          >
            {isRunning ? "Dispatching Cloud Build..." : "▶ Trigger Full Suite"}
          </button>
          <div style={css.userSection}>
            <span style={css.userEmail}>{user?.email}</span>
            <button onClick={() => signOut(auth)} style={css.btnOutline}>Exit</button>
          </div>
        </div>
      </header>

      <section style={css.kpiBar}>
        <div style={css.kpiItem}>
          <span style={css.kpiLabel} title="Porcentaje de ejecuciones exitosas (pass) sobre el total de runs registrados.">PASS RATE ⓘ</span>
          <span style={{ ...css.kpiValue, color: stats.passRate > 90 ? "#16a34a" : "#dc2626" }}>
            {stats.passRate}%
          </span>
          <span style={css.kpiSub}>{stats.passed} pass / {stats.failed} fail</span>
        </div>
        <div style={css.kpiItem}>
          <span style={css.kpiLabel} title="Tiempo medio de ejecución de las pruebas en milisegundos.">AVG RUNTIME ⓘ</span>
          <span style={css.kpiValue}>{stats.avgTime} ms</span>
          <span style={css.kpiSub}>latency target &lt; 50ms</span>
        </div>
        <div style={css.kpiItem}>
          <span style={css.kpiLabel} title="Cantidad de pruebas con resultados mixtos pass/fail (inestables).">FLAKY RISKS ⓘ</span>
          <span style={{ ...css.kpiValue, color: stats.flaky > 0 ? "#ea580c" : "#16a34a" }}>
            {stats.flaky}
          </span>
          <span style={css.kpiSub}>unstable test signatures</span>
        </div>
        <div style={css.kpiItem}>
          <span style={css.kpiLabel} title="Modo de ejecución determinista, sin IA ni tokens.">ENGINE MODE ⓘ</span>
          <span style={css.kpiValue}>Deterministic</span>
          <span style={css.kpiSub}>No-AI zero token overhead</span>
        </div>
      </section>

      <div style={css.workspace}>
        <aside style={css.testExplorer}>
          <div style={css.explorerToolbar}>
            <input
              type="text"
              placeholder="Filter test cases..." title="Filtra la lista de ejecuciones por nombre de prueba."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={css.searchInput}
            />
            <div style={css.filterRow}>
              {["all", "pass", "fail"].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  style={{
                    ...css.filterTab,
                    backgroundColor: statusFilter === st ? "#0f172a" : "#f1f5f9",
                    color: statusFilter === st ? "#fff" : "#475569",
                  }}
                >
                  {st.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div style={css.runTree}>
            {filteredRuns.map((r) => {
              const active = r.id === selectedRunId;
              const isOk = r.status === "pass";
              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedRunId(r.id)}
                  style={{
                    ...css.runTreeItem,
                    borderLeftColor: isOk ? "#16a34a" : "#dc2626",
                    backgroundColor: active ? "#f1f5f9" : "#fff",
                  }}
                >
                  <div style={css.treeRow}>
                    <span style={{ ...css.statusBadge, backgroundColor: isOk ? "#dcfce7" : "#fee2e2", color: isOk ? "#15803d" : "#b91c1c" }}>
                      {r.status?.toUpperCase() || "RUN"}
                    </span>
                    <span style={css.testNameLabel}>{r.test_name}</span>
                  </div>
                  <div style={css.treeMeta}>
                    <span>⏱ {r.duration_ms || 0}ms</span>
                    <span>HTTP {r.http_response?.status_code || 200}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {selectedRun ? (
          <main style={css.inspector}>
            <div style={css.inspectorHeader}>
              <div>
                <div style={css.badgeRow}>
                  <span style={css.categoryTag}>{metadata?.categoria || "Core Engine Test"}</span>
                  <span style={css.envTag}>{selectedRun.environment || "emulator:gcp"}</span>
                </div>
                <h2 style={css.testHeading}>{selectedRun.test_name}</h2>
              </div>
              <div style={css.inspectorStats}>
                <div>Status: <b>{selectedRun.status?.toUpperCase()}</b></div>
                <div>Runtime: <b>{selectedRun.duration_ms} ms</b></div>
                <div>Timestamp: <b>{new Date(selectedRun.timestamp?.seconds ? selectedRun.timestamp.seconds * 1000 : selectedRun.timestamp).toLocaleTimeString()}</b></div>
              </div>
            </div>

            <div style={css.tabBar}>
              {[
                { id: "diff", label: "⚡ Firestore Database Delta" },
                { id: "http", label: "🌐 HTTP Contract (Req/Res)" },
                { id: "rule", label: "📖 Business Rule Specification" },
                { id: "logs", label: "📋 Stderr / Stdout Captures" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    ...css.tabButton,
                    borderBottomColor: activeTab === t.id ? "#2563eb" : "transparent",
                    color: activeTab === t.id ? "#2563eb" : "#475569",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div style={css.inspectorBody}>
              {activeTab === "diff" && (
                <div style={css.diffSection}>
                  <div style={css.alertInfo}>
                    State reconciliation before and after transaction execution.
                  </div>
                  {Object.keys(selectedRun.db_delta || {}).length === 0 ? (
                    <div style={css.emptyState}>No mutations recorded in Firestore for this execution.</div>
                  ) : (
                    Object.entries(selectedRun.db_delta).map(([collection, docs]) => (
                      <div key={collection} style={css.deltaBlock}>
                        <div style={css.collHeader}>Collection: <code>{collection}</code></div>
                        {Object.entries(docs).map(([docId, change]) => (
                          <div key={docId} style={css.diffEntry}>
                            <div style={css.diffEntryHead}>
                              <span>Document ID: <b>{docId}</b></span>
                              <span style={{
                                ...css.changeBadge,
                                backgroundColor: change.status === "added" ? "#16a34a" : change.status === "modified" ? "#d97706" : "#dc2626"
                              }}>
                                {change.status?.toUpperCase()}
                              </span>
                            </div>
                            {change.status === "modified" ? (
                              <div style={css.sideBySide}>
                                <div style={css.sideCol}>
                                  <div style={css.sideTitle}>Before Execution:</div>
                                  <pre style={css.codeViewer}>{JSON.stringify(change.before, null, 2)}</pre>
                                </div>
                                <div style={css.sideCol}>
                                  <div style={css.sideTitle}>After Execution:</div>
                                  <pre style={css.codeViewer}>{JSON.stringify(change.after, null, 2)}</pre>
                                </div>
                              </div>
                            ) : (
                              <pre style={css.codeViewer}>
                                {JSON.stringify(change.after || change.before, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "http" && (
                <div style={css.sideBySide}>
                  <div style={css.sideCol}>
                    <div style={css.sideTitle}>HTTP Request Payload:</div>
                    <pre style={css.codeViewerDark}>{JSON.stringify(selectedRun.http_request || {}, null, 2)}</pre>
                  </div>
                  <div style={css.sideCol}>
                    <div style={css.sideTitle}>HTTP Response:</div>
                    <pre style={css.codeViewerDark}>{JSON.stringify(selectedRun.http_response || {}, null, 2)}</pre>
                  </div>
                </div>
              )}

              {activeTab === "rule" && (
                <div style={css.ruleCard}>
                  {metadata ? (
                    <>
                      <h3 style={css.ruleTitle}>{metadata.reglaNegocio}</h3>
                      <div style={css.tagContainer}>
                        {metadata.etiquetas.map((t) => (
                          <div key={t.nombre} style={css.tagBox}>
                            <span style={css.tagTitle}>#{t.nombre}</span>
                            <span style={css.tagDef}>{t.definicion}</span>
                          </div>
                        ))}
                      </div>
                      <h4 style={css.ruleSub}>System Constraint Evaluated</h4>
                      <p style={css.ruleDesc}>{metadata.explicacionRegla}</p>
                      <h4 style={css.ruleSub}>Operational Risk Mitigated</h4>
                      <p style={css.ruleDesc}>{metadata.porQueImporta}</p>
                    </>
                  ) : (
                    <div style={css.emptyState}>No educational specification linked to this test signature.</div>
                  )}
                </div>
              )}

              {activeTab === "logs" && (
                <pre style={css.consoleOutput}>
                  {(selectedRun.console_logs && selectedRun.console_logs.length > 0)
                    ? selectedRun.console_logs.join("\n")
                    : "No standard output / error streams recorded."}
                </pre>
              )}
            </div>
          </main>
        ) : (
          <div style={css.emptyState}>Select an execution run to view technical trace and business rules.</div>
        )}
      </div>
    </div>
  );
}

const css = {
  root: { display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "#f8fafc", fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", backgroundColor: "#0f172a", color: "#fff" },
  branding: { display: "flex", alignItems: "center", gap: 12 },
  logo: { width: 32, height: 32, borderRadius: 6, backgroundColor: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: "#fff" },
  brandTitle: { fontSize: 14, fontWeight: 800, letterSpacing: 0.5 },
  brandSubtitle: { fontSize: 11, color: "#94a3b8" },
  actionsBar: { display: "flex", alignItems: "center", gap: 16 },
  btnPrimary: { backgroundColor: "#2563eb", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" },
  btnOutline: { backgroundColor: "transparent", color: "#94a3b8", border: "1px solid #334155", padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" },
  userSection: { display: "flex", alignItems: "center", gap: 8 },
  userEmail: { fontSize: 11, color: "#cbd5e1" },
  kpiBar: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, backgroundColor: "#e2e8f0", borderBottom: "1px solid #e2e8f0" },
  kpiItem: { backgroundColor: "#fff", padding: "12px 20px", display: "flex", flexDirection: "column" },
  kpiLabel: { fontSize: 10, fontWeight: 800, color: "#64748b", letterSpacing: 0.5 },
  kpiValue: { fontSize: 22, fontWeight: 800, color: "#0f172a", margin: "2px 0" },
  kpiSub: { fontSize: 10, color: "#94a3b8" },
  workspace: { display: "flex", flex: 1, overflow: "hidden" },
  testExplorer: { width: 360, backgroundColor: "#fff", borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column" },
  explorerToolbar: { padding: 12, borderBottom: "1px solid #f1f5f9" },
  searchInput: { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontSize: 12, borderRadius: 6, border: "1px solid #cbd5e1", outline: "none", marginBottom: 8 },
  filterRow: { display: "flex", gap: 4 },
  filterTab: { flex: 1, border: "none", padding: "4px 0", fontSize: 10, fontWeight: 700, borderRadius: 4, cursor: "pointer" },
  runTree: { flex: 1, overflowY: "auto", padding: 8 },
  runTreeItem: { padding: "10px 12px", border: "1px solid #e2e8f0", borderLeftWidth: 4, borderRadius: 6, marginBottom: 6, cursor: "pointer" },
  treeRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 4 },
  statusBadge: { fontSize: 9, fontWeight: 800, padding: "2px 5px", borderRadius: 4 },
  testNameLabel: { fontSize: 12, fontWeight: 700, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  treeMeta: { display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b" },
  inspector: { flex: 1, display: "flex", flexDirection: "column", backgroundColor: "#fff", overflow: "hidden" },
  inspectorHeader: { padding: "16px 24px", borderBottom: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", alignItems: "flex-start" },
  badgeRow: { display: "flex", gap: 6, marginBottom: 6 },
  categoryTag: { fontSize: 10, fontWeight: 800, color: "#2563eb", backgroundColor: "#eff6ff", padding: "2px 6px", borderRadius: 4 },
  envTag: { fontSize: 10, fontWeight: 700, color: "#64748b", backgroundColor: "#f1f5f9", padding: "2px 6px", borderRadius: 4 },
  testHeading: { fontSize: 18, fontWeight: 800, color: "#0f172a", margin: 0 },
  inspectorStats: { textAlign: "right", fontSize: 11, color: "#64748b", lineHeight: 1.6 },
  tabBar: { display: "flex", padding: "0 24px", borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc" },
  tabButton: { padding: "12px 16px", border: "none", borderBottom: "2px solid transparent", background: "transparent", fontSize: 12, fontWeight: 700, cursor: "pointer" },
  inspectorBody: { flex: 1, padding: 24, overflowY: "auto", backgroundColor: "#f8fafc" },
  diffSection: { display: "flex", flexDirection: "column", gap: 16 },
  alertInfo: { padding: "8px 12px", backgroundColor: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, fontSize: 11, color: "#1e40af" },
  deltaBlock: { backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 16 },
  collHeader: { fontSize: 12, fontWeight: 800, color: "#334155", marginBottom: 12 },
  diffEntry: { border: "1px solid #f1f5f9", borderRadius: 6, padding: 12, marginBottom: 8, backgroundColor: "#fafafa" },
  diffEntryHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 11 },
  changeBadge: { color: "#fff", fontSize: 9, fontWeight: 800, padding: "2px 6px", borderRadius: 4 },
  sideBySide: { display: "flex", gap: 12 },
  sideCol: { flex: 1 },
  sideTitle: { fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 },
  codeViewer: { margin: 0, padding: 10, backgroundColor: "#f1f5f9", borderRadius: 6, fontSize: 11, color: "#0f172a", overflowX: "auto" },
  codeViewerDark: { margin: 0, padding: 12, backgroundColor: "#0f172a", borderRadius: 6, fontSize: 11, color: "#38bdf8", overflowX: "auto" },
  consoleOutput: { margin: 0, padding: 16, backgroundColor: "#0f172a", borderRadius: 8, color: "#f8fafc", fontSize: 11, lineHeight: 1.5, overflowX: "auto" },
  ruleCard: { backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 20 },
  ruleTitle: { fontSize: 16, fontWeight: 800, color: "#0f172a", margin: "0 0 16px 0" },
  ruleSub: { fontSize: 12, fontWeight: 800, color: "#475569", textTransform: "uppercase", margin: "16px 0 6px 0" },
  ruleDesc: { fontSize: 13, color: "#334155", lineHeight: 1.5, margin: 0 },
  tagContainer: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 },
  tagBox: { padding: 8, backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6 },
  tagTitle: { fontSize: 11, fontWeight: 800, color: "#2563eb", display: "block" },
  tagDef: { fontSize: 11, color: "#64748b", marginTop: 2, display: "block" },
  emptyState: { padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 },
};
