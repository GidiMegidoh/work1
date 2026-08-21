/**
 * הוכחה מקומית של כל שרשרת ה-webhook — בלי שום קריאת רשת ובלי Meta.
 *
 *   node src/whatsapp/selftest.js
 *
 * מזרים מטעני webhook אמיתיים במבנה של Cloud API דרך handler.receive עם
 * טרנספורט sim, ומדפיס את המטענים שהיו נשלחים בפועל. מכוסים:
 *   1. הודעת טקסט            → תשובת טקסט/רשימה
 *   2. לחיצה על כפתור מועד   → המשך הזרימה
 *   3. "נציג"                → תבנית lead_alert אל escalation.notifyPhones
 *   4. אימות חתימה           → חתימה תקינה עוברת, גוף שהשתנה נדחה
 *   5. משלוח חוזר של Meta    → אותו wamid פעמיים = שליחה אחת
 */

'use strict';

const crypto = require('crypto');
const { loadConfig, loadTenant } = require('./config');
const { createSimTransport } = require('./transport');
const { createWebhookHandler } = require('./handler');
const { replyToMessage, LIMITS } = require('./outbound');
const { parseWebhook } = require('./inbound');

const APP_SECRET = 'selftest-app-secret';
const VERIFY_TOKEN = 'selftest-verify-token';
const WA_ID = '972501112233';           // "הלקוח" בבדיקה
const PHONE_NUMBER_ID = '000000000000000';

let wamidSeq = 0;
function nextWamid() {
  wamidSeq += 1;
  return 'wamid.SELFTEST' + String(wamidSeq).padStart(4, '0');
}

/** מטען webhook נכנס במבנה המדויק של Cloud API. */
function inboundEnvelope(message) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '111111111111111',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '972524608284', phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'דנה אבידן' }, wa_id: WA_ID }],
          messages: [message],
        },
      }],
    }],
  };
}

function textEnvelope(body, id) {
  return inboundEnvelope({
    from: WA_ID, id: id || nextWamid(), timestamp: '1787000000',
    type: 'text', text: { body: body },
  });
}

function buttonEnvelope(buttonId, title, id) {
  return inboundEnvelope({
    from: WA_ID, id: id || nextWamid(), timestamp: '1787000001',
    type: 'interactive',
    interactive: { type: 'button_reply', button_reply: { id: buttonId, title: title } },
  });
}

function sign(raw) {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
}

function show(label, sent) {
  console.log('\n' + '-'.repeat(72) + '\n' + label);
  if (!sent.length) { console.log('   (לא נשלחה שום הודעה)'); return; }
  sent.forEach((s) => {
    console.log(`\n   >> ${s.purpose} · type=${s.payload.type} · shape=${s.shape} · to=${s.to}`);
    console.log(JSON.stringify(s.payload, null, 2).split('\n').map((l) => '     ' + l).join('\n'));
  });
}

async function main() {
  const cfg = loadConfig({
    mode: 'sim',
    appSecret: APP_SECRET,
    verifyToken: VERIFY_TOKEN,
    overrides: { phoneNumberId: PHONE_NUMBER_ID, tenantSlug: 'demo-dental' },
  });
  const tenant = loadTenant(cfg.tenantSlug);
  const transport = createSimTransport(cfg);
  const handler = createWebhookHandler({
    config: cfg, tenant, transport,
    agentOpts: { now: '2026-08-23T09:00' },   // שעון מקובע = פלט דטרמיניסטי
    logger: (m) => console.log('   ' + m),
  });

  console.log('='.repeat(72));
  console.log(`  בדיקה עצמית של ה-webhook — ${tenant.businessName} (${tenant.id})`);
  console.log(`  מצב: ${cfg.mode} · טרנספורט: sim · אפס קריאות רשת`);
  console.log('='.repeat(72));

  let failures = 0;
  const check = (cond, desc) => {
    console.log(`   ${cond ? '[PASS]' : '[FAIL]'} ${desc}`);
    if (!cond) failures += 1;
  };

  // ---- 0. אימות GET של Meta ----
  console.log('\n' + '-'.repeat(72) + '\n0. אימות הבעלות (GET /webhook)');
  const okVerify = handler.verify({
    'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444',
  });
  const badVerify = handler.verify({
    'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1158201444',
  });
  check(okVerify.status === 200 && okVerify.body === '1158201444', 'טוקן נכון → 200 + החזרת ה-challenge');
  check(badVerify.status === 403, 'טוקן שגוי → 403');

  // ---- 1. הודעת טקסט ----
  const raw1 = Buffer.from(JSON.stringify(textEnvelope('אני רוצה לקבוע תור לניקוי')), 'utf8');
  const r1 = await handler.receive(raw1, { 'x-hub-signature-256': sign(raw1) });
  show('1. טקסט נכנס: "אני רוצה לקבוע תור לניקוי"', r1.sent);
  check(r1.status === 200, 'הוחזר 200');
  check(r1.sent.length === 1 && r1.sent[0].payload.type === 'interactive', 'נשלחה הודעת interactive אחת');
  check(r1.sent[0].shape === 'list', '7 כפתורים מהסוכן → רשימה (מגבלת 3 הכפתורים של Meta נעקפת)');
  const rows = r1.sent[0].payload.interactive.action.sections[0].rows;
  check(rows.length <= 10, `${rows.length} שורות — בתוך מגבלת 10 השורות`);
  check(rows.every((r) => r.title.length <= 24), 'כל כותרות השורות בתוך 24 תווים');
  const firstSlot = rows.find((r) => r.id.indexOf('slot:') === 0);
  check(!!firstSlot, 'הרשימה כוללת מזהי מועדים אמיתיים (slot:…)');

  // ---- 2. לחיצה על כפתור ----
  const raw2 = Buffer.from(JSON.stringify(buttonEnvelope(firstSlot.id, firstSlot.title)), 'utf8');
  const r2 = await handler.receive(raw2, { 'x-hub-signature-256': sign(raw2) });
  show(`2. לחיצה על כפתור: ${firstSlot.id}`, r2.sent);
  check(r2.sent.length === 1, 'נשלחה תשובה אחת');
  check(/על שם מי/.test(JSON.stringify(r2.sent[0].payload)), 'הזרימה התקדמה לשלב השם');

  // ---- 3. "נציג" → תבנית lead_alert ----
  const raw3 = Buffer.from(JSON.stringify(textEnvelope('נציג')), 'utf8');
  const r3 = await handler.receive(raw3, { 'x-hub-signature-256': sign(raw3) });
  show('3. "נציג" → תשובה ללקוח + תבנית lead_alert לבעלים', r3.sent);
  const alerts = r3.sent.filter((s) => s.purpose === 'alert');
  check(r3.sent.some((s) => s.purpose === 'reply'), 'הלקוח קיבל אישור העברה');
  check(alerts.length === tenant.escalation.notifyPhones.length,
    `נשלחה תבנית לכל נמען ב-notifyPhones (${tenant.escalation.notifyPhones.length})`);
  check(alerts.every((a) => a.payload.type === 'template'),
    'ההתראה היא template ולא טקסט חופשי (הודעה ביוזמת העסק מחייבת תבנית)');
  check(alerts.every((a) => a.payload.template.name === cfg.templates.leadAlert),
    `שם התבנית הוא ${cfg.templates.leadAlert}`);
  check(alerts.every((a) => a.payload.template.components[0].parameters.length === 1),
    'התבנית נשלחת עם משתנה אחד — {{1}} של «פנייה חדשה: {{1}}»');
  check(alerts.every((a) => tenant.escalation.notifyPhones.indexOf(a.to) !== -1),
    'הנמענים הם בדיוק escalation.notifyPhones מקובץ הטננט');

  // ---- 4. חתימה ----
  console.log('\n' + '-'.repeat(72) + '\n4. אימות חתימת X-Hub-Signature-256');
  const raw4 = Buffer.from(JSON.stringify(textEnvelope('מה מדיניות הביטולים?')), 'utf8');
  const good = await handler.receive(raw4, { 'x-hub-signature-256': sign(raw4) });
  check(good.status === 200 && good.sent.length === 1, 'חתימה תקינה → 200 ונשלחה תשובה');

  const tampered = Buffer.from(JSON.stringify(textEnvelope('מחירון')), 'utf8');
  const bad = await handler.receive(tampered, { 'x-hub-signature-256': sign(raw4) });
  check(bad.status === 403 && bad.sent.length === 0, 'גוף שהוחלף מול חתימה ישנה → 403 ואפס שליחות');

  const noSig = await handler.receive(raw4, {});
  check(noSig.status === 403, 'בקשה בלי כותרת חתימה → 403');

  // ---- 5. משלוח חוזר ----
  console.log('\n' + '-'.repeat(72) + '\n5. משלוח חוזר של Meta (אותו wamid פעמיים)');
  const dupId = nextWamid();
  const rawA = Buffer.from(JSON.stringify(textEnvelope('מחירון', dupId)), 'utf8');
  const first = await handler.receive(rawA, { 'x-hub-signature-256': sign(rawA) });
  const again = await handler.receive(rawA, { 'x-hub-signature-256': sign(rawA) });
  check(first.sent.length === 1, 'משלוח ראשון → נשלחה תשובה אחת');
  check(again.sent.length === 0, 'משלוח חוזר של אותו wamid → אפס שליחות (דה-דופליקציה)');

  // ---- 6. מגבלות המטען של Meta — נכפות בכוח, לא במקרה ----
  console.log('');
  console.log('-'.repeat(72));
  console.log('6. מגבלות אורך וכמות של Meta');
  const many = Array.from({ length: 14 }, (_, i) => ({
    id: 'slot:overflow-' + i,
    title: 'יום רביעי 26.08.2026 בשעה ' + (9 + i) + ':00 עם ד"ר מאיה לוי במרפאה',
  }));
  const over = replyToMessage({ text: 'בחר מועד', buttons: many }, WA_ID);
  const overRows = over.message.interactive.action.sections[0].rows;
  check(over.shape === 'list', '14 כפתורים → רשימה');
  check(overRows.length === LIMITS.maxRows, `נחתך ל-${LIMITS.maxRows} שורות בדיוק`);
  check(over.truncated === 14 - LIMITS.maxRows,
    `${over.truncated} השורות העודפות מדווחות ולא נבלעות בשקט`);
  check(overRows.every((r) => r.title.length <= LIMITS.rowTitle),
    `כל כותרת נחתכה ל-${LIMITS.rowTitle} תווים (הארוכה ביותר: ${Math.max.apply(null, overRows.map((r) => r.title.length))})`);
  check(overRows.some((r) => /…$/.test(r.title)), 'כותרת שנחתכה מסומנת באליפסיס');
  const three = replyToMessage({ text: 'x', buttons: many.slice(0, 3) }, WA_ID);
  check(three.shape === 'button' && three.message.interactive.action.buttons.length === 3,
    '3 כפתורים → interactive/button (ולא רשימה)');
  check(three.message.interactive.action.buttons
    .every((b) => b.reply.title.length <= LIMITS.buttonTitle),
    `כותרות הכפתורים נחתכו ל-${LIMITS.buttonTitle} תווים`);
  const empty = replyToMessage({ text: '', buttons: [{ id: 'a', title: 'b' }] }, WA_ID);
  check(empty.message.interactive.body.text.length > 0, 'גוף ריק לא נשלח כ-body ריק (Meta מחזירה 400)');

  // ---- 7. עמידות: מטענים פגומים והודעות של טננט אחר ----
  console.log('');
  console.log('-'.repeat(72));
  console.log('7. עמידות מול קלט לא צפוי');
  let threw = false;
  try {
    parseWebhook({ entry: [null] });
    parseWebhook({ entry: [{ changes: [null] }] });
    parseWebhook({ entry: [{ changes: [{ value: { messages: [null] } }] }] });
    parseWebhook(null);
    parseWebhook({ entry: 'not-an-array' });
  } catch (err) { threw = true; }
  check(!threw, 'מטענים פגומים אינם מפילים את הפענוח');
  const mixed = parseWebhook({
    object: 'whatsapp_business_account',
    entry: [null, {
      changes: [{ field: 'messages', value: {
        metadata: { phone_number_id: PHONE_NUMBER_ID },
        messages: [null, { from: WA_ID, id: 'wamid.MIXED', type: 'text', text: { body: 'שלום' } }],
      } }],
    }],
  });
  check(mixed.events.length === 1, 'הודעה תקינה באותה חבילה עם אלמנט פגום עדיין מטופלת');

  const foreign = JSON.parse(JSON.stringify(textEnvelope('מחירון')));
  foreign.entry[0].changes[0].value.metadata.phone_number_id = 'OTHER-TENANT-NUMBER';
  const rawF = Buffer.from(JSON.stringify(foreign), 'utf8');
  const rf = await handler.receive(rawF, { 'x-hub-signature-256': sign(rawF) });
  check(rf.sent.length === 0, 'הודעה שהגיעה ל-phone_number_id של טננט אחר — אפס שליחות');

  // ---- 8. כשל מסירה: לא מאבדים את התשובה ----
  console.log('');
  console.log('-'.repeat(72));
  console.log('8. כשל זמני בשליחה ומשלוח חוזר');
  let failOnce = true;
  const flaky = {
    mode: 'sim', sent: [],
    send(payload) {
      if (failOnce) { failOnce = false; return Promise.reject(new Error('HTTP 503 מ-Graph')); }
      flaky.sent.push(payload);
      return Promise.resolve({ messages: [{ id: 'wamid.RETRY' }] });
    },
  };
  const h2 = createWebhookHandler({
    config: cfg, tenant, transport: flaky,
    agentOpts: { now: '2026-08-23T09:00' }, logger: (m) => console.log('   ' + m),
  });
  const rawR = Buffer.from(JSON.stringify(textEnvelope('מחירון', 'wamid.FLAKY001')), 'utf8');
  const try1 = await h2.receive(rawR, { 'x-hub-signature-256': sign(rawR) });
  check(try1.status === 503, 'כשל מסירה מחזיר 503 (כדי ש-Meta תשלח שוב) ולא 200');
  check(flaky.sent.length === 0, 'אחרי הכישלון שום דבר לא נמסר');
  const try2 = await h2.receive(rawR, { 'x-hub-signature-256': sign(rawR) });
  check(try2.status === 200 && flaky.sent.length === 1,
    'המשלוח החוזר מוסר את המטען השמור — בלי להריץ שוב את הסוכן');
  const try3 = await h2.receive(rawR, { 'x-hub-signature-256': sign(rawR) });
  check(flaky.sent.length === 1, 'משלוח חוזר נוסף אחרי מסירה מוצלחת — אפס שליחות כפולות');

  // ---- סיכום ----
  console.log('\n' + '='.repeat(72));
  console.log(`  סך המטענים שהוכנו לשליחה: ${transport.sent.length} · קריאות רשת בפועל: 0`);
  console.log(failures ? `  [FAIL] ${failures} בדיקות נכשלו` : '  [PASS] כל הבדיקות עברו');
  console.log('='.repeat(72));
  process.exit(failures ? 1 : 0);
}

main().catch((err) => { console.error('[ERROR] ' + err.stack); process.exit(1); });
