/**
 * שליחת דמו לליד: הודעת WhatsApp דרך Twilio עם קישור לדמו של שיבוץ.
 *
 * מודול הליבה — משמש גם את השרת (outreach/server.js) וגם את ה-CLI
 * (outreach/cli.js). חי מחוץ ל-src/ בכוונה: שומר הרשת מוכיח שהדמו עצמו
 * לא נוגע ברשת, וכלי המכירות הזה הוא היחיד שמדבר עם העולם.
 *
 * קונפיגורציה (משתני סביבה או קובץ .env בשורש הריפו):
 *   TWILIO_ACCOUNT_SID    — חובה לשליחה אמיתית
 *   TWILIO_AUTH_TOKEN     — חובה לשליחה אמיתית
 *   TWILIO_WHATSAPP_FROM  — ברירת מחדל: whatsapp:+14155238886 (ה-sandbox)
 *   DEMO_LINK             — ברירת מחדל: הקישור הראשון ב-assets/wa-link.md
 *   DRY_RUN=1             — מדפיס ורושם ביומן בלי לשלוח בפועל
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LOG_FILE = path.join(__dirname, 'sent-log.jsonl');
const WA_LINK_FILE = path.join(ROOT, 'assets', 'wa-link.md');

/** טוען .env מקומי (בלי תלות ב-dotenv). משתני סביבה קיימים גוברים. */
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

/** קישור הדמו: DEMO_LINK מהסביבה, ואם אין — הקישור הראשון ב-assets/wa-link.md. */
function resolveDemoLink() {
  if (process.env.DEMO_LINK) return process.env.DEMO_LINK;
  if (fs.existsSync(WA_LINK_FILE)) {
    const m = fs.readFileSync(WA_LINK_FILE, 'utf8').match(/https?:\/\/\S+/);
    if (m) return m[0].replace(/[)\]"'.,]+$/, '');
  }
  return null;
}

/**
 * נרמול מספר טלפון לפורמט E.164.
 * מקבל "+972501234567", "0501234567" (מקומי ישראלי) או עם רווחים/מקפים.
 */
function normalizePhone(raw) {
  if (typeof raw !== 'string') return null;
  let p = raw.replace(/[\s\-().]/g, '');
  if (/^05\d{8}$/.test(p)) p = '+972' + p.slice(1);
  if (/^9725\d{8}$/.test(p)) p = '+' + p;
  return /^\+\d{9,15}$/.test(p) ? p : null;
}

/** תבנית ההודעה: הטקסט של המוכר + קישור לדמו + קריאה לפעולה. */
function buildBody(message, link) {
  return [
    message.trim(),
    '',
    '🤖 שיבוץ — סוכן WhatsApp בעברית שקובע תורים ללקוחות שלך, 24/7.',
    '👇 לחצו על הקישור כדי לנסות את הדמו החי:',
    link,
  ].join('\n');
}

/** רישום ביומן: שורת JSON לקובץ + הדפסה לקונסול. */
function logSend(entry) {
  const record = { ts: new Date().toISOString(), ...entry };
  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n');
  const icon = record.status === 'sent' ? '✅' : record.status === 'dry-run' ? '🧪' : '❌';
  console.log(`${icon} [${record.ts}] ${record.status} → ${record.phone}` +
    (record.sid ? ` (sid: ${record.sid})` : '') +
    (record.error ? ` — ${record.error}` : ''));
  return record;
}

/**
 * שולח הודעת דמו לליד. מחזיר את רשומת היומן.
 * זורק Error עם message ברור על קלט לא תקין או כשל בשליחה.
 */
async function sendDemo({ phone, message }) {
  loadEnv();

  const to = normalizePhone(phone);
  if (!to) throw new Error(`מספר טלפון לא תקין: "${phone}" — צריך פורמט +972... או 05...`);
  if (!message || !String(message).trim()) throw new Error('חסרה הודעה (message)');

  const link = resolveDemoLink();
  if (!link) {
    throw new Error('לא נמצא קישור דמו — הגדירו DEMO_LINK בסביבה/.env או הוסיפו קישור ל-assets/wa-link.md');
  }

  const body = buildBody(String(message), link);

  if (process.env.DRY_RUN === '1') {
    console.log('— DRY RUN — ההודעה שהייתה נשלחת: —\n' + body + '\n———————————————');
    return logSend({ phone: to, status: 'dry-run', message: String(message), link, body });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  if (!sid || !token) {
    throw new Error('חסרים TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN (אפשר ב-.env). לבדיקה בלי שליחה: DRY_RUN=1');
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
      To: `whatsapp:${to}`,
      Body: body,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.message || `Twilio HTTP ${res.status}`;
    logSend({ phone: to, status: 'error', message: String(message), link, error: err });
    throw new Error(`השליחה נכשלה: ${err}`);
  }

  return logSend({ phone: to, status: 'sent', message: String(message), link, sid: data.sid });
}

module.exports = { sendDemo, normalizePhone, buildBody, resolveDemoLink, LOG_FILE };
