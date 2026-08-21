/**
 * נקודת הקצה ש-Meta קוראת אליה. שרת http של Node בלי תלויות, באותו סגנון
 * של src/cli/demo-serve.js.
 *
 *   node src/whatsapp/server.js [slug]        מצב sim — אפס רשת (ברירת מחדל)
 *   WA_MODE=live node src/whatsapp/server.js  מול המספר החי
 *
 *   GET  /webhook  — אימות הבעלות של Meta (hub.challenge)
 *   POST /webhook  — הודעות נכנסות
 *   GET  /health   — בדיקת חיים + מה עוד חסר כדי לעלות לאוויר
 *
 * הגוף נקרא כ-Buffer גולמי ונשמר ככזה: אימות החתימה חייב לרוץ על הבייטים
 * המקוריים, לפני JSON.parse.
 */

'use strict';

const http = require('http');
const { URL } = require('url');
const { loadConfig, missingForLive, loadTenant } = require('./config');
const { createTransport } = require('./transport');
const { createWebhookHandler } = require('./handler');

function readRawBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('גוף הבקשה גדול מדי')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function start(opts) {
  opts = opts || {};
  const cfg = loadConfig({ mode: opts.mode });
  const slug = opts.slug || process.argv[2] || cfg.tenantSlug;
  const tenant = loadTenant(slug);
  const log = opts.logger || ((m) => console.log(m));

  const transport = createTransport(cfg);
  const handler = createWebhookHandler({ config: cfg, tenant, transport, logger: log });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, body, type) => {
      res.writeHead(status, { 'Content-Type': type || 'text/plain; charset=utf-8' });
      res.end(body);
    };

    if (url.pathname === '/health') {
      const missing = missingForLive(cfg);
      return send(200, JSON.stringify({
        ok: true, mode: cfg.mode, tenant: tenant.id, businessName: tenant.businessName,
        readyForLive: missing.length === 0, missingForLive: missing,
      }, null, 2), 'application/json; charset=utf-8');
    }

    if (url.pathname !== '/webhook') return send(404, 'לא נמצא');

    if (req.method === 'GET') {
      const q = {};
      url.searchParams.forEach((v, k) => { q[k] = v; });
      const out = handler.verify(q);
      log(`GET /webhook → ${out.status}`);
      return send(out.status, out.body);
    }

    if (req.method === 'POST') {
      let raw;
      try {
        raw = await readRawBody(req, 1024 * 1024);
      } catch (err) {
        return send(413, 'גוף גדול מדי');
      }
      // כל תקלה מכאן והלאה עדיין מחזירה 200 — 5xx גורם ל-Meta לנסות שוב ושוב
      try {
        const out = await handler.receive(raw, req.headers);
        log(`POST /webhook → ${out.status} · נשלחו ${out.sent.length} הודעות`);
        return send(out.status, out.body);
      } catch (err) {
        log(`❌ שגיאה בטיפול ב-webhook: ${err.message}`);
        return send(200, 'EVENT_RECEIVED');
      }
    }

    return send(405, 'שיטה לא נתמכת');
  });

  const port = Number(process.env.PORT || 3100);
  server.listen(port, () => {
    const missing = missingForLive(cfg);
    log('═══════════════════════════════════════════');
    log(`  📡 webhook של שיבוץ — ${tenant.businessName} (${tenant.id})`);
    log(`  מצב: ${cfg.mode}${cfg.mode === 'sim' ? '  (אפס קריאות רשת)' : '  ⚠️  מול המספר החי'}`);
    log(`  GET/POST http://localhost:${port}/webhook`);
    log(`  בריאות:  http://localhost:${port}/health`);
    if (missing.length) log(`  חסר לעלייה לאוויר: ${missing.length} פריטים (ראו /health ו-GO-LIVE-DEMO.md)`);
    log('═══════════════════════════════════════════');
  });
  return { server, handler, transport, config: cfg, tenant };
}

if (require.main === module) start();
module.exports = { start, readRawBody };
