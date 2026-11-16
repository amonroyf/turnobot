# Búsqueda laboral — Semana 1

> 10 ofertas reales de QA en Colombia (nov 2026). El objetivo de esta sesión no es
> postularse: es **entender qué pide el mercado** y comparar con lo que
> Turnobot demuestra.
>
> **Regla del plan:** todavía NO te postres. Esta tabla es insumo.

## Las 10 ofertas

| # | Empresa / Rol | Ciudad / Modalidad | Salario | Stack | Años | Inglés | ¿Playwright? |
|---|---------------|--------------------|---------|-------|-------|--------|--------------|
| 1 | **dondoctor** — Ingeniero de Automatización QA | Bogotá / Híbrido | A convenir | Playwright + TS, POM, Screenplay, Azure DevOps, Postman, ISTQB | 3–5 | No menciona | ✅ **Sí** (es el requisito central) |
| 2 | **Applaudo** — QA Automation Engineer (Entry level) | Remoto (Bogotá) | No dice | Playwright + POM, JS/TS, Azure Pipelines, Test Plans, Postman, IA-assisted testing | No dice (dice "Entry level") | **"Strong verbal and written English"** | ✅ **Sí** |
| 3 | **Hitss Colombia** — QA Automatizador Jr (Playwright E2E) | Remoto / Bogotá | No dice | Playwright, APIs REST + GraphQL, **SQL y NoSQL**, Scrum/Kanban | Estudiante últimos semestres o profesional | No menciona | ✅ **Sí** |
| 4 | **T-mapp** — Analista de pruebas (skill automatización) | Medellín/Bogotá / Híbrido | No dice | Playwright + **Screenplay**, Karate, AWS, Scrum | Mín. 2 | No menciona | ✅ **Sí** (no negociable) |
| 5 | **Sofka** — QA Automatizador SSR/SR | Medellín / Híbrido | No dice | Playwright, **SerenityBDD**, **Rest Assured**, SQL+NoSQL, Azure DevOps, Scrum, IA Generativa | 2–4 (contrato 5 meses) | No menciona | ✅ **Sí** |
| 6 | **Inetum** — TESTER JUNIOR | Bogotá / Contrato indefinido | No dice | Selenium, Cucumber, Playwright, Cypress, Appium, **Jira + Xray**, Postman, SQL, Jenkins | Mín. 1 (manual) | No menciona | ✅ (uno de varios) |
| 7 | **R4 INNOVATION** — QA Tester Junior | Remoto | **$1.750.905** + auxilio $249.905 | Manual + automatizado, Jira, reporte de bugs | Mín. 6 meses | No menciona | ❌ No pide |
| 8 | **Cinte Colombia** — QA tester junior | Bogotá / Híbrido | **$2,5–3 M** | Manual + automatización, SQL (Oracle, DB2), IDE scripting, gestión de defectos | Mín. 1 | No menciona | ❌ No pide |
| 9 | **Empresa conf.** — Tester automatizador junior nivel I | Remoto | **$4–4,5 M** | **Selenium**, JMeter, **Java**, SQL, MongoDB, Scrum | Mín. 1 | No menciona | ❌ No pide |
| 10 | **TALYCAP** — QA funcional (Web+API+Mobile) | Remoto | $5,5–6 M | **ISTQB**, BrowserStack, Azure Test Plans, Postman, JMeter, API+Web+Mobile, Scrum | 1–3 | No menciona | ❌ No pide |

**Salarios vistos:** $1,75 M (manual Jr) · $2,4–3 M (Jr híbrido) · $3,5–4 M (automatizador) ·
$4–5,5 M (automatizador con Java) · $5,5–6 M (funcional completo).
**Ojo:** los salaries más altos son los que piden **más stack** (Java, Selenium, Appium, mobile).

---

## Top 5 requisitos que se repiten

1. **Playwright (6 de 10)** — y en 3 de ellas es explícitamente *no negociable*.
   POM aparece en 4. **Screenplay** aparece 2 veces (dondoctor lo pide como deseable,
   T-mapp lo pide como requisito): es el siguiente nivel después de POM.
2. **API testing** — Postman, REST, validación de contratos. Aparece en 7 de 10.
   Nadie pide "solo UI".
3. **SQL / NoSQL** — 6 de 10. "Validar información y escribir consultas complejas".
   **Este es el gap más grande mío**: mi repo tiene Firestore, no SQL.
4. **CI/CD (Azure DevOps / Pipelines)** — 5 de 10. GitHub Actions me sirve, pero
   el nombre del producto importa en el filtro automático.
5. **Inglés** — solo 1 de 10 lo exige explícitamente (Applaudo: "strong verbal and
   written English"), pero 3 más lo piden como "deseable"/"valorable". Y el que lo
   exige, **es el único que dice "Entry level"** y no pide años de experiencia.

---

## ¿Qué demuestra Turnobot y qué me falta?

| Lo que pide el mercado | ¿Turnobot lo demuestra? | Evidencia |
|------------------------|------------------------|-----------|
| Playwright + POM | ✅ **Sí, fuerte** | 12 specs, `pages/BookingPage.js` con POM |
| Fixtures / datos de prueba | ⚠️ **Parcial** | Hay `setup.js` con seed idempotente, pero **no hay `test.extend` con fixtures** |
| Manejo de flakiness | ✅ **Sí** | `workers:1`, `retries:1`,Allure, reporte de flaky pendiente |
| API testing | ✅ **Sí** | Colección Postman + Newman + `scripts/run-api-gcp.sh` |
| SQL / NoSQL | ⚠️ **Parcial** | NoSQL sí (Firestore). **SQL: cero.** |
| CI/CD | ✅ **Sí** | `qa.yml` (emulador), `qa-gcp.yml` (WIF + GCP), `ci.yml` |
| GitHub Actions | ✅ | Hay workflow, pero piden **Azure DevOps** por nombre |
| Reportes / Allure | ✅ | `allure-playwright` instalado |
| Screenplay pattern | ❌ **No** | Tengo POM. Podría台词 agregarlo |
| ISTQB fundamentals | ⚠️ | Conocidos por estudio, no por certificado |
| Java + Selenium | ❌ **No** | Todo el stack es JS/TS + Go |
| Mobile / Appium / BrowserStack | ❌ **No** | Turnobot no tiene app móvil |
| Pruebas de carga | ⚠️ | `tests/perf/load.js` existe pero **k6 no está instalado** |
| Accesibilidad (axe) | ❌ **No** | Sin instalar |
| Análisis de riesgo | ⚠️ | En la bitácora de hoy: 25 reglas sin cobertura = insumo real |

### Gaps honestos (los que van al CV, no al CV)

1. **SQL.** Es el gap más citado (6/10) y el que menos sé. Opciones: (a) aprender lo
   básico y armar un proyecto chico con PostgreSQL, (b) mostrar que sé *leer* el
   modelo de datos de Firestore (queries, índices, cardinalidad) — que es el mismo
   pensamiento con otro dialecto. La opción (b) es defendible en entrevista.
2. **Azure DevOps.** No lo voy a aprender. En su lugar: GitHub Actions + Allure +
   artifacts + reportes. Es transferible y lo puedo explicar en 30 segundos.
3. **Screenplay.** 2 ofertas lo piden. El plan de 14 semanas tiene POM en la semana 9.
   Screenplay es unATM upgrade natural para la semana 10 si sobra tiempo.
4. **Java/Selenium.** El plan §14 ya lo addresses: no en paralelo. Después de la
   semana 14, puente de 5 días.
5. **Mobile.** Fuera de alcance. Turnobot es web.

---

## Conclusión para el CV

**La oferta #2 (Applaudo) es la que mejor encaja con este proyecto:**
dice "Entry level", pide Playwright + POM (que es literalmente lo que hago),
no pide años de experiencia, y —esta es la clave— pide **exploratory testing**
además de automatización. Eso es un argumento fuerte: "no solo automatizo, también
pienso qué probar".

**La oferta #7 (R4 INNOVATION, $1,75 M) es la puerta de entrada real:**
pide 6 meses, acepta automatizado, es remoto. Es el primer sueldo.

**La oferta #3 (Hitss Jr) es la mejor meta a corto plazo:** pide Playwright E2E,
acepta estudiantes de últimos semestres, y pide SQL/NoSQL — que es el gap que
tengo que cerrar.

---

## Cómo voy a responder "no sé" en una entrevista

El plan ya lo dice: "Sé pedir ayuda y decir 'esto no sé'". Concretamente:

| Si me preguntan | Mi respuesta honesta y fuerte |
|-----------------|---------------------------|
| "¿Usaste Screenplay?" | "No todavía. Usé POM; conozco Screenplay y sé cuándo conviene: cuando hay múltiples actores con flujos distintos, POM se acopla al actor." |
| "¿SQL?" | "No en mi proyecto personal: usé Firestore. Conozco el modelo relacional y sé leer/escribir queries; lo que no he hecho es optimizar joins e índices en producción." |
| "¿Java?" | "Mi stack es TypeScript y Go. No sé Selenium, pero transferí los conceptos en 5 días cuando lo necesité." |
| "¿Azure DevOps?" | "Uso GitHub Actions. Los conceptos de pipeline, artifacts y matrices son los mismos." |
| "Dime un bug que encontraste" | → **BUG-003** (el `aud` mismatch: 77 tests rotos por una causa raíz de una línea). Es un STAR perfecto: qué encontré, cómo lo reproduje, raíz, fix, prevención. |
