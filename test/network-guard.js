/**
 * שומר הרשת: מוכיח שהדמו לא נוגע ברשת בכלל.
 *
 * 1. מנטרים כל נקודת יציאה לרשת ב-Node (net/tls/http/https/dns/fetch) לפני
 *    טעינת הקוד, מריצים את כל שיחות הבדיקה ובניית אתר הדמו — ומוודאים אפס
 *    ניסיונות חיבור. הקריאה היחידה המותרת היא קריאת קובץ הטננט מהדיסק.
 * 2. סורקים את קוד המקור: אסור שיופיעו graph.facebook.com (WhatsApp Cloud API),
 *    googleapis (Google Calendar) או hebcal (קריאת חגים חיה).
 */

'use strict';

const attempts = [];

function trap(mod, name, fnName) {
  const original = mod[fnName];
  mod[fnName] = function () {
    attempts.push(`${name}.${fnName}(${JSON.stringify(arguments[0]).slice(0, 120)})`);
    throw new Error(`ניסיון גישה לרשת: ${name}.${fnName}`);
  };
  return original;
}

const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const dns = require('dns');

trap(net.Socket.prototype, 'net.Socket.prototype', 'connect');
trap(net, 'net', 'connect');
trap(net, 'net', 'createConnection');
trap(tls, 'tls', 'connect');
trap(http, 'http', 'request');
trap(http, 'http', 'get');
trap(https, 'https', 'request');
trap(https, 'https', 'get');
trap(dns, 'dns', 'lookup');
trap(dns, 'dns', 'resolve');
if (typeof globalThis.fetch === 'function') {
  globalThis.fetch = function (url) {
    attempts.push(`fetch(${String(url).slice(0, 120)})`);
    throw new Error('ניסיון גישה לרשת: fetch');
  };
}

// ---- מכאן והלאה הרשת חסומה. טוענים את המערכת ומריצים הכול. ----

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const { createAgent } = require(path.join(ROOT, 'src', 'core', 'agent'));
const buildSite = require(path.join(ROOT, 'src', 'demo', 'build-site'));

// הקריאה המותרת היחידה: קובץ הטננט מהדיסק המקומי
const tenant = JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', 'test-dental.json'), 'utf8'));
const agent = createAgent(tenant, { now: '2026-08-05T08:00:00' });

const conversations = [
  ['כמה עולה טיפול שיניים?'],
  ['אני רוצה לקבוע תור', '1', '1', 'ישראל ישראלי', 'בדיקה', 'מכבי', 'כן',
    'אני רוצה להזיז את התור', '1', 'כן', 'לבטל את התור', 'כן'],
  ['מה הייתה תוצאת משחק הכדורגל אתמול?'],
  ['יש לי כאב שן', '1', 'דנה', 'כאב', 'דלג', 'כן'],
  ['נציג'],
  ['שלום', 'מה שעות הפעילות?', 'איפה חונים?', 'הסר'],
];

conversations.forEach((conv, i) => {
  conv.forEach((msg) => agent.handleMessage(`guard-${i}`, msg));
});

// גם בניית אתר הדמו חייבת לעבוד בלי רשת
const outDir = buildSite('test-dental');

let failed = false;
if (attempts.length) {
  failed = true;
  console.log('❌ זוהו ניסיונות גישה לרשת:');
  attempts.forEach((a) => console.log(`   ✗ ${a}`));
} else {
  console.log('✅ אפס ניסיונות רשת בכל שיחות הבדיקה ובבניית אתר הדמו');
}

// ---- סריקת קוד המקור ----
const FORBIDDEN = ['graph.facebook.com', 'googleapis', 'hebcal', 'twilio', 'api.whatsapp.com'];
const scanDirs = ['src', 'demo'];
const hits = [];
function scan(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(p);
    else if (/\.(js|html|css|json)$/.test(entry.name)) {
      const content = fs.readFileSync(p, 'utf8');
      FORBIDDEN.forEach((f) => {
        if (content.toLowerCase().includes(f)) hits.push(`${path.relative(ROOT, p)} מכיל "${f}"`);
      });
    }
  }
}
scanDirs.forEach((d) => scan(path.join(ROOT, d)));

if (hits.length) {
  failed = true;
  console.log('❌ נמצאו אזכורי שירותים חיצוניים בקוד:');
  hits.forEach((h) => console.log(`   ✗ ${h}`));
} else {
  console.log(`✅ אין אזכור ל-${FORBIDDEN.join(' / ')} בקוד הדמו`);
}

console.log(`   (אתר הדמו נבנה ל-${path.relative(ROOT, outDir)} ללא רשת)`);
process.exit(failed ? 1 : 0);
