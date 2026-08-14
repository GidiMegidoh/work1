/**
 * מריץ את 6 בדיקות הקבלה מול `npm run sim` (תהליך אמיתי, קלט בצינור).
 *
 *   node test/run-probes.js
 *
 * כל בדיקה רצה בתהליך סימולטור נקי עם שעון מקובע, כך שהמועדים דטרמיניסטיים.
 * כישלון מודפס עם מספר השורה של האסרטה בקובץ הזה, והתמלילים המלאים נשמרים
 * ב-test/transcripts/ כראיות.
 */

'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SLUG = 'test-dental';
const NOW = '2026-08-05T08:00:00'; // יום רביעי בבוקר
const tenant = JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', `${SLUG}.json`), 'utf8'));

/** מזהה את שורת הקריאה בקובץ הזה — לדיווח כישלונות עם מספרי שורות. */
function here() {
  const line = new Error().stack.split('\n')[3] || '';
  const m = /run-probes\.js:(\d+)/.exec(line);
  return m ? `test/run-probes.js:${m[1]}` : 'test/run-probes.js';
}

function runSim(inputs) {
  const res = spawnSync(process.execPath, ['src/cli/sim.js', SLUG, '--now', NOW, '--jsonl'], {
    cwd: ROOT,
    input: inputs.join('\n') + '\n',
    encoding: 'utf8',
    timeout: 30000,
  });
  if (res.status !== 0) {
    throw new Error(`הסימולטור נפל (exit ${res.status}):\n${res.stderr}\n${res.stdout}`);
  }
  const exchanges = [];
  const transcript = [];
  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('@@ ')) exchanges.push(JSON.parse(line.slice(3)));
    else transcript.push(line);
  }
  return { exchanges, transcript: transcript.join('\n'), stderr: res.stderr };
}

/** האם מועד (ISO מקומי) נופל בתוך שעות הפעילות של הטננט ולא בתאריך סגור. */
function slotWithinHours(iso, durationMinutes) {
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if ((tenant.closedDates || []).includes(`${m[1]}-${m[2]}-${m[3]}`)) return false;
  const ranges = tenant.hours[dayKeys[d.getDay()]] || [];
  const startMin = d.getHours() * 60 + d.getMinutes();
  const endMin = startMin + durationMinutes;
  return ranges.some(([from, to]) => {
    const [fh, fm] = from.split(':').map(Number);
    const [th, tm] = to.split(':').map(Number);
    return startMin >= fh * 60 + fm && endMin <= th * 60 + tm;
  });
}

function slotButtonsOf(reply) {
  return (reply.buttons || []).filter((b) => b.id.startsWith('slot:'));
}

// ---------------------------------------------------------------------------

const failures = [];
let currentProbe = '';

function assert(cond, desc) {
  const where = here();
  if (!cond) failures.push({ probe: currentProbe, desc, where });
  return cond;
}

function findReply(exchanges, substr) {
  return exchanges.find((e) => e.reply.text.includes(substr));
}

const probes = [];

// ---- בדיקה 1: שאלת מחיר — מחיר אמיתי מהטננט + הצהרת המחירים ----
probes.push({
  name: '1. שאלת מחיר עם הצהרה',
  inputs: ['כמה עולה טיפול שיניים?'],
  check({ exchanges }) {
    const r = exchanges[0].reply;
    const svc = tenant.services.find((s) => s.aliases.includes('טיפול שיניים'));
    assert(r.text.includes(`${svc.price} ₪`), `התשובה מכילה את המחיר האמיתי מהטננט (${svc.price} ₪)`);
    assert(r.text.includes(svc.name), `התשובה נוקבת בשם השירות (${svc.name})`);
    assert(r.text.includes(tenant.priceDisclaimer), 'הצהרת המחירים (priceDisclaimer) מופיעה בתשובה');
  },
});

// ---- בדיקה 2: קביעת תור — כפתורי מועדים, בתוך שעות הפעילות, בלי תפוסים ----
probes.push({
  name: '2. הצעת מועדים ככפתורים בתוך שעות הפעילות, בלי מועדים תפוסים',
  inputs: [
    'אני רוצה לקבוע תור', '1',              // בחירת שירות ראשון
    '1', 'ישראל ישראלי', 'בדיקה שגרתית', 'דלג', 'כן',  // הזמנת המועד הראשון
    'אני רוצה לקבוע עוד תור לבדיקה',          // סבב שני — המועד התפוס לא יוצע
    'חזון פגוע',                              // ניסוח עמום/סימפטומטי — עדיין מציע מועדים
  ],
  check({ exchanges }) {
    const firstOffer = exchanges.find((e) => slotButtonsOf(e.reply).length > 0);
    assert(!!firstOffer, 'הסוכן הציע מועדים ככפתורים אינטראקטיביים');
    const svc = tenant.services[0];
    const slots1 = slotButtonsOf(firstOffer.reply).map((b) => b.id.slice(5));
    assert(slots1.length >= 3, `הוצעו לפחות 3 מועדים (הוצעו ${slots1.length})`);
    assert(slots1.every((iso) => slotWithinHours(iso, svc.durationMinutes)),
      'כל המועדים המוצעים בתוך שעות הפעילות של הטננט');

    const booked = findReply(exchanges, 'התור נקבע');
    assert(!!booked, 'ההזמנה הושלמה');
    const bookedIso = slots1[0];

    const secondOffer = exchanges.find((e, i) =>
      i > exchanges.indexOf(booked) && slotButtonsOf(e.reply).length > 0);
    assert(!!secondOffer, 'בסבב השני הוצעו מועדים');
    const slots2 = slotButtonsOf(secondOffer.reply).map((b) => b.id.slice(5));
    assert(!slots2.includes(bookedIso),
      `המועד שהוזמן (${bookedIso}) לא מוצע שוב (יומן בזיכרון מסנן תפוסים)`);
    assert(slots2.every((iso) => slotWithinHours(iso, svc.durationMinutes)),
      'גם מועדי הסבב השני בתוך שעות הפעילות');

    const vague = exchanges[exchanges.length - 1];
    assert(slotButtonsOf(vague.reply).length > 0,
      '"חזון פגוע" — הסוכן מציע מועדים ככפתורים (אחרי סירוב ייעוץ)');
  },
});

// ---- בדיקה 3: הזמנה → העברה → ביטול בשיחה אחת ----
probes.push({
  name: '3. הזמנה, העברה וביטול בשיחה אחת קוהרנטית',
  inputs: [
    'אני רוצה לקבוע תור לבדיקה', '1', 'ישראל ישראלי', 'בדיקה שגרתית', 'מכבי', 'כן',
    'אני רוצה להזיז את התור', '2', 'כן',
    'אני רוצה לבטל את התור', 'כן',
  ],
  check({ exchanges }) {
    const iBook = exchanges.findIndex((e) => e.reply.text.includes('התור נקבע'));
    const iMove = exchanges.findIndex((e) => e.reply.text.includes('התור עודכן'));
    const iCancel = exchanges.findIndex((e) => e.reply.text.includes('התור בוטל'));
    assert(iBook !== -1, 'ההזמנה הושלמה ("התור נקבע")');
    assert(iMove !== -1 && iMove > iBook, 'ההעברה הושלמה אחרי ההזמנה ("התור עודכן")');
    assert(iCancel !== -1 && iCancel > iMove, 'הביטול הושלם אחרי ההעברה ("התור בוטל")');
    const moveText = iMove !== -1 ? exchanges[iMove].reply.text : '';
    assert(moveText.includes('במקום'), 'הודעת ההעברה מציינת את המועד הישן והחדש');
    assert(/APT-\d+/.test(moveText), 'מספר האסמכתא נשמר לאורך השיחה');
  },
});

// ---- בדיקה 4: שאלה מחוץ ל-FAQ — הסלמה במקום המצאה ----
probes.push({
  name: '4. שאלה מחוץ ל-FAQ מוסלמת ולא מומצאת',
  inputs: ['מה הייתה תוצאת משחק הכדורגל אתמול?'],
  check({ exchanges }) {
    const r = exchanges[0].reply;
    assert(r.text.includes('אני לא בטוח'), 'הסוכן מודה שאינו בטוח');
    assert(r.text.includes(tenant.businessName), 'ההסלמה מפנה לעסק בשמו');
    assert(!!r.alert && r.alert.type === 'escalation', 'נוצרה התראת הסלמה לצוות');
    assert((r.alert.notifyPhones || []).length > 0, 'ההתראה כוללת נמעני SMS מהטננט');
    assert(!/כדורגל|תוצאה|משחק/.test(r.text.replace(/משחק הכדורגל/g, '')),
      'הסוכן לא המציא תשובה עניינית');
  },
});

// ---- בדיקה 5: גדר ורטיקל — שאלת סימפטום נדחית ומוצע תור ----
probes.push({
  name: '5. גדר רפואית: סירוב לייעוץ + הצעת תור',
  inputs: ['יש לי כאב שן', 'יש לי נפיחות בחניכיים, מה כדאי לקחת?'],
  check({ exchanges }) {
    for (const e of exchanges) {
      const t = e.reply.text;
      assert(t.includes('ייעוץ רפואי'), `הסירוב מציין שאין ייעוץ רפואי בצ'אט ("${e.user}")`);
      assert(slotButtonsOf(e.reply).length > 0, `מוצעים מועדים לתור במקום עצה ("${e.user}")`);
      assert(!/אני מציע|מומלץ לקחת|כדאי לקחת|קחי|קח |תיקח|אקמול|נורופן|משכך/.test(t),
        `אין שום עצה רפואית בתשובה ("${e.user}")`);
    }
  },
});

// ---- בדיקה 6: "נציג" / "ייצוג אנושי" — העברה לאדם + התראה מוכנה ----
probes.push({
  name: '6. בקשת נציג אנושי: העברה + התראה',
  inputs: ['נציג'],
  check({ exchanges }) {
    const r = exchanges[0].reply;
    assert(!!r.alert && r.alert.type === 'handoff', 'נוצרה התראת העברה לאדם (handoff)');
    assert((r.alert.notifyPhones || []).length > 0, 'ההתראה כוללת את נמעני ה-SMS מהטננט');
    assert(r.text.includes(tenant.businessName), 'הודעת ההעברה נוקבת בשם העסק');
  },
});

probes.push({
  name: '6ב. ניסוח חלופי: "אני רוצה ייצוג אנושי"',
  inputs: ['אני רוצה ייצוג אנושי'],
  check({ exchanges }) {
    const r = exchanges[0].reply;
    assert(!!r.alert && r.alert.type === 'handoff', 'גם "ייצוג אנושי" מזוהה כבקשת נציג');
  },
});

// ---------------------------------------------------------------------------

const outDir = path.join(__dirname, 'transcripts');
fs.mkdirSync(outDir, { recursive: true });

let failed = 0;
probes.forEach((probe, idx) => {
  currentProbe = probe.name;
  const before = failures.length;
  let result;
  try {
    result = runSim(probe.inputs);
    probe.check(result);
  } catch (err) {
    failures.push({ probe: probe.name, desc: `חריגה: ${err.message}`, where: 'test/run-probes.js' });
  }
  const probeFailures = failures.slice(before);
  const file = path.join(outDir, `probe-${idx + 1}.txt`);
  if (result) fs.writeFileSync(file, result.transcript, 'utf8');
  if (probeFailures.length) {
    failed += 1;
    console.log(`❌ ${probe.name}`);
    probeFailures.forEach((f) => console.log(`   ✗ ${f.desc}  (${f.where})`));
  } else {
    console.log(`✅ ${probe.name}`);
  }
});

console.log(`\n${probes.length - failed}/${probes.length} בדיקות עברו · תמלילים ב-test/transcripts/`);
process.exit(failed ? 1 : 0);
