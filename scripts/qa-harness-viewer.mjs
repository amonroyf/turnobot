#!/usr/bin/env node
// Visor del harness de tests Go: sirve los reportes JSON (delta de Firestore)
// y una UI para explorarlos en el navegador.
//
// Sin dependencias: solo Node. Todo corre en local.
//
//   node scripts/qa-harness-viewer.mjs [--dir backend/test-reports] [--port 4173]
//
// - /                  -> la UI
// - /api/reports       -> lista de reportes (metadatos)
// - /api/report/<name> -> un reporte completo
// - /api/reload        -> relee la carpeta (para ver cambios sin recargar)

import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';

const args = process.argv.slice(2);
function arg(flag, def) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const ROOT = resolve(arg('--root', process.cwd()));
const DIR = resolve(ROOT, arg('--dir', 'backend/test-reports'));
const PORT = Number(arg('--port', '4173'));

if (!existsSync(DIR)) {
  console.error(
    `\n✗ No existe la carpeta de reportes: ${DIR}\n` +
      `  Corré los tests primero:\n` +
      `    cd backend && FIRESTORE_EMULATOR_HOST=127.0.0.1:8090 \\\n` +
      `    FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098 \\\n` +
      `    GCP_PROJECT_ID=demo-test go test ./... -count=1\n`,
  );
  process.exit(1);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function send(res, code, type, body) {
  res.writeHead(code, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function listReports() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(await readFile(join(DIR, f), 'utf8'));
      const delta = raw.db_delta || {};
      const counts = { added: 0, modified: 0, removed: 0 };
      let docs = 0;
      for (const coll of Object.values(delta)) {
        for (const info of Object.values(coll || {})) {
          docs += 1;
          if (counts[info.status] !== undefined) counts[info.status] += 1;
        }
      }
      out.push({
        file: f,
        test_name: raw.test_name,
        status: raw.status,
        method: raw.http_request?.method,
        url: raw.http_request?.url,
        code: raw.response?.status_code,
        duration_ms: raw.duration_ms,
        environment: raw.environment,
        docs_touched: docs,
        ...counts,
        has_logs: (raw.console_logs || []).length > 0,
      });
    } catch {
      // Reporte corrupto: lo saltamos pero no tumbamos el visor.
    }
  }
  out.sort((a, b) => a.test_name.localeCompare(b.test_name) || a.file.localeCompare(b.file));
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  try {
    if (path === '/' || path === '/index.html') {
      const html = await readFile(new URL('./qa-harness-viewer.html', import.meta.url), 'utf8');
      return send(res, 200, MIME['.html'], html);
    }

    if (path === '/api/reports') {
      const list = await listReports();
      return send(res, 200, MIME['.json'], JSON.stringify(list));
    }

    if (path.startsWith('/api/report/')) {
      const name = basename(decodeURIComponent(path.slice('/api/report/'.length)));
      // basename() evita path traversal (..)
      const file = join(DIR, name);
      if (!existsSync(file)) return send(res, 404, MIME['.json'], '{"error":"no existe"}');
      return send(res, 200, MIME['.json'], await readFile(file, 'utf8'));
    }

    if (path === '/api/reload') {
      const list = await listReports();
      return send(res, 200, MIME['.json'], JSON.stringify(list));
    }

    send(res, 404, 'text/plain; charset=utf-8', 'no encontrado');
  } catch (err) {
    send(res, 500, 'application/json; charset=utf-8', JSON.stringify({ error: String(err) }));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n✗ El puerto ${PORT} ya está ocupado.\n` +
        `  Probablemente el visor ya está corriendo: http://localhost:${PORT}\n` +
        `  O usá otro puerto:  node scripts/qa-harness-viewer.mjs --port 4174\n`,
    );
  } else {
    console.error(`\n✗ No se pudo arrancar el visor: ${err.message}\n`);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const n = listReports().then((l) => l.length).catch(() => '?');
  n.then((count) => {
    console.log(`\n🔬 Visor del harness QA`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   reportes: ${DIR} (${count})`);
    console.log(`\n   Ctrl+C para salir\n`);
  });
});
