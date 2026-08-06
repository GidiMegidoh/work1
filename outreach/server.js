/**
 * שרת ה-outreach: נקודת קצה אחת לשליחת דמו לפרוספקט.
 *
 *   npm run send-demo:server        (פורט 3100, או SEND_PORT מהסביבה)
 *
 *   POST /send-demo   { "phone": "+972501234567", "message": "היי דנה..." }
 *   GET  /log         יומן השליחות
 *   GET  /health      בדיקת חיות
 *
 * בלי אימות בכוונה — מפעיל יחיד, להרצה מקומית בלבד. לא לחשוף לאינטרנט
 * כמו שזה.
 */

'use strict';

const http = require('http');
const { sendDemo, getConfig, readLog } = require('./send-demo');

const PORT = Number(process.env.SEND_PORT || 3100);

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2) + '\n');
}

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/health') return json(res, 200, { ok: true });
  if (req.method === 'GET' && url === '/log') return json(res, 200, readLog());

  if (req.method === 'POST' && url === '/send-demo') {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 64 * 1024) req.destroy(); // הודעת דמו לא צריכה יותר
    });
    req.on('end', async () => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (_) {
        return json(res, 400, { ok: false, error: 'גוף הבקשה חייב להיות JSON: { phone, message }' });
      }
      const result = await sendDemo(payload);
      json(res, result.ok ? 200 : 400, result);
    });
    return;
  }

  json(res, 404, { ok: false, error: 'לא נמצא. נקודות קצה: POST /send-demo, GET /log, GET /health' });
});

server.listen(PORT, () => {
  const cfg = getConfig();
  console.log('═══════════════════════════════════════════');
  console.log('  📣 שיבוץ — שליחת דמו לפרוספקטים');
  console.log(`  POST http://localhost:${PORT}/send-demo   { phone, message }`);
  console.log(`  GET  http://localhost:${PORT}/log         יומן שליחות`);
  console.log(`  מצב: ${cfg.dryRun ? '🧪 dry-run (אין credentials או DRY_RUN=1)' : '📤 שליחה אמיתית'}`);
  console.log(`  קישור דמו: ${cfg.demoUrl}${cfg.demoUrlIsDefault ? '  ⚠️ ברירת מחדל — הגדירו DEMO_URL' : ''}`);
  console.log('═══════════════════════════════════════════');
});
