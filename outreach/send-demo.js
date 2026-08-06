/**
 * שליחת הודעת WhatsApp לפרוספקט עם קישור לדמו של שיבוץ, דרך Twilio.
 *
 * מודול הליבה — משמש גם את השרת (server.js) וגם את ה-CLI (cli.js).
 * בכוונה יושב ב-outreach/ ולא ב-src/: שומר הרשת (test/network-guard.js)
 * אוכף שקוד הדמו עצמו לא מזכיר ספקים חיצוניים ולא ניגש לרשת. כלי המכירות
 * הזה הוא ערוץ נפרד, מחוץ לדמו.
 *
 * קונפיגורציה (משתני סביבה או קובץ .env בשורש הפרויקט):
 *   TWILIO_ACCOUNT_SID    חשבון Twilio (ACxxxx...)
 *   TWILIO_AUTH_TOKEN     טוקן אימות
 *   TWILIO_WHATSAPP_FROM  מספר השולח (ברירת מחדל: sandbox +14155238886)
 *   DEMO_URL              קישור אתר הדמו שנשלח לפרוספקט
 *   DEMO_CHAT_URL         (אופציונלי) קישור ישיר לנגן הצ'אט — שורה נוספת בהודעה
 *   DRY_RUN=1             הדפסה + רישום ביומן בלי שליחה אמיתית
 *
 * בלי credentials המודול עובר אוטומטית ל-dry-run, כדי שאפשר יהיה לבדוק
 * את התבנית והיומן לפני שמחברים חשבון אמיתי.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(__dirname, 'send-log.json');
const DEFAULT_SANDBOX_FROM = '+14155238886'; // Twilio WhatsApp Sandbox

// ---- קונפיגורציה ----

/** טוען KEY=VALUE מקובץ .env בשורש הפרויקט (אם קיים) בלי לדרוס סביבה קיימת. */
function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function getConfig() {
  loadEnvFile();
  const sid = process.env.TWILIO_ACCOUNT_SID || '';
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const hasCreds = Boolean(sid && token);
  return {
    sid,
    token,
    from: process.env.TWILIO_WHATSAPP_FROM || DEFAULT_SANDBOX_FROM,
    demoUrl: process.env.DEMO_URL || 'http://localhost:3000',
    chatUrl: process.env.DEMO_CHAT_URL || '',
    demoUrlIsDefault: !process.env.DEMO_URL,
    dryRun: process.env.DRY_RUN === '1' || !hasCreds,
    hasCreds,
  };
}

// ---- טלפון ----

/**
 * מנרמל מספר טלפון ל-E.164. מקבל "+972501234567", "0501234567" (יומר
 * ל-+972) או ספרות עם רווחים/מקפים. מחזיר null אם לא תקין.
 */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\s\-().]/g, '');
  if (/^0\d{8,9}$/.test(p)) p = '+972' + p.slice(1); // מקומי ישראלי
  if (/^972\d{8,9}$/.test(p)) p = '+' + p;
  return /^\+\d{8,15}$/.test(p) ? p : null;
}

// ---- תבנית ההודעה ----

function buildMessage(text, demoUrl, chatUrl) {
  const lines = [
    text.trim(),
    '',
    '🤖 הדמו החי של שיבוץ — סוכן WhatsApp בעברית לקביעת תורים:',
    `🌐 אתר הדמו: ${demoUrl}`,
  ];
  if (chatUrl) lines.push(`💬 דמו בוט הוואטסאפ: ${chatUrl}`);
  lines.push('', '👆 לחצו על הקישור, גלשו באתר ונסו לדבר עם הבוט בבועת הצ\'אט');
  return lines.join('\n');
}

// ---- יומן שליחות ----

function appendLog(entry) {
  let log = [];
  try {
    log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    if (!Array.isArray(log)) log = [];
  } catch (_) { /* קובץ חדש */ }
  log.push(entry);
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2) + '\n', 'utf8');
}

function readLog() {
  try {
    const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(log) ? log : [];
  } catch (_) {
    return [];
  }
}

// ---- שליחה דרך Twilio REST API (בלי תלויות) ----

function twilioSend(cfg, to, body) {
  return new Promise((resolve, reject) => {
    const form = new URLSearchParams({
      From: `whatsapp:${cfg.from}`,
      To: `whatsapp:${to}`,
      Body: body,
    }).toString();

    const req = https.request({
      hostname: 'api.twilio.com',
      path: `/2010-04-01/Accounts/${cfg.sid}/Messages.json`,
      method: 'POST',
      auth: `${cfg.sid}:${cfg.token}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form),
      },
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(data); } catch (_) { /* תשובה לא-JSON */ }
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ sid: parsed.sid, status: parsed.status });
        } else {
          reject(new Error(parsed.message || `Twilio HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Twilio timeout')));
    req.write(form);
    req.end();
  });
}

/**
 * הפונקציה הראשית: שולחת (או מדמה) הודעת דמו לפרוספקט ורושמת ביומן.
 * מחזירה { ok, dryRun, to, body, sid?, error? }.
 */
async function sendDemo({ phone, message }) {
  const cfg = getConfig();
  const to = normalizePhone(phone);
  if (!to) {
    return { ok: false, error: `מספר טלפון לא תקין: "${phone}" (צפוי E.164, למשל +972501234567)` };
  }
  if (typeof message !== 'string' || !message.trim()) {
    return { ok: false, error: 'חסרה הודעה (message)' };
  }

  const body = buildMessage(message, cfg.demoUrl, cfg.chatUrl);
  const entry = {
    at: new Date().toISOString(),
    to,
    body,
    demoUrl: cfg.demoUrl,
    status: 'dry-run',
  };

  if (cfg.dryRun) {
    entry.note = cfg.hasCreds ? 'DRY_RUN=1' : 'אין TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN — לא נשלח בפועל';
    appendLog(entry);
    return { ok: true, dryRun: true, to, body, note: entry.note };
  }

  try {
    const res = await twilioSend(cfg, to, body);
    entry.status = 'sent';
    entry.sid = res.sid;
    appendLog(entry);
    return { ok: true, dryRun: false, to, body, sid: res.sid };
  } catch (err) {
    entry.status = 'failed';
    entry.error = err.message;
    appendLog(entry);
    return { ok: false, dryRun: false, to, body, error: err.message };
  }
}

module.exports = { sendDemo, normalizePhone, buildMessage, getConfig, readLog, LOG_FILE };
