/**
 * שרת שליחת הדמו:
 *
 *   npm run send-server            (פורט 3100, או SEND_PORT מהסביבה)
 *
 *   POST /send-demo   גוף: { "phone": "+972501234567", "message": "טקסט" }
 *   GET  /sent        רשימת השליחות מהיומן (outreach/sent-log.jsonl)
 *
 * בלי אימות — כלי פנימי של מפעיל יחיד. להאזין רק על localhost.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const { sendDemo, LOG_FILE } = require('./send-demo');

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/sent') {
    const lines = fs.existsSync(LOG_FILE)
      ? fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
      : [];
    return json(res, 200, lines);
  }

  if (req.method !== 'POST' || req.url.split('?')[0] !== '/send-demo') {
    return json(res, 404, { ok: false, error: 'יש רק POST /send-demo ו-GET /sent' });
  }

  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
    if (raw.length > 64 * 1024) req.destroy();
  });
  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json(res, 400, { ok: false, error: 'גוף הבקשה חייב להיות JSON: { "phone": "...", "message": "..." }' });
    }
    try {
      const record = await sendDemo(payload);
      json(res, 200, { ok: true, ...record });
    } catch (err) {
      json(res, 400, { ok: false, error: err.message });
    }
  });
});

const port = Number(process.env.SEND_PORT || 3100);
server.listen(port, '127.0.0.1', () => {
  console.log('═══════════════════════════════════════════');
  console.log('  📤 שרת שליחת הדמו של שיבוץ');
  console.log(`  POST http://localhost:${port}/send-demo`);
  console.log(`  GET  http://localhost:${port}/sent`);
  console.log('═══════════════════════════════════════════');
});
