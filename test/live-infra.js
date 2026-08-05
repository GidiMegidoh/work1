/**
 * בדיקות התשתית החיה: תיקוני הבאגים, תפר היומן (google), אימות חתימת
 * webhook, וזרימה מלאה שרת→סוכן→שליחה — הכול עם רשת מדומה (mock fetch),
 * בלי קרדנצ'לס אמיתיים ובלי אף קריאת רשת אמיתית.
 *
 *   node test/live-infra.js
 */

'use strict';

// הליבה עובדת בזמן מקומי נאיבי — הבדיקות מקבעות את אזור הזמן של התהליך
// לאזור של הטננט, בדיוק כפי שהשרת אוכף בפרודקשן (חייב לקרות לפני כל new Date)
process.env.TZ = 'Asia/Jerusalem';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const { createAgent } = require(path.join(ROOT, 'src', 'core', 'agent'));
const wa = require(path.join(ROOT, 'server', 'lib', 'whatsapp'));
const gcal = require(path.join(ROOT, 'server', 'lib', 'google-calendar'));
const { createApp } = require(path.join(ROOT, 'server', 'index'));

let passed = 0;
let failed = 0;
function check(cond, desc) {
  if (cond) { passed += 1; console.log(`  ✅ ${desc}`); }
  else { failed += 1; console.log(`  ❌ ${desc}`); }
}
function section(name) { console.log(`\n━━ ${name}`); }

const shibutz = JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', 'shibutz.json'), 'utf8'));
const dental = JSON.parse(fs.readFileSync(path.join(ROOT, 'tenants', 'test-dental.json'), 'utf8'));

// ---------------------------------------------------------------------------
section('1. רגרסיה: extraBlockedTopics בוורטיקל general לא מדפיס null');
{
  const t = JSON.parse(JSON.stringify(shibutz));
  t.guardrails.extraBlockedTopics = ['ביטקוין'];
  const agent = createAgent(t, { now: '2026-08-05T08:00:00' });
  const r = agent.handleMessage('g1', 'אתם מקבלים ביטקוין?');
  check(!r.text.includes('null'), 'אין "null" בתשובה');
  check(r.text.includes('אני לא עונה עליו'), 'יש משפט סירוב כללי');
  check(r.buttons.some((b) => b.id.startsWith('slot:')), 'עדיין מוצעים מועדים');

  const t2 = JSON.parse(JSON.stringify(shibutz));
  t2.guardrails.extraBlockedTopics = ['ביטקוין'];
  t2.guardrails.extraDecline = 'על נושאי תשלום עונה רק המנהל.';
  const r2 = createAgent(t2, { now: '2026-08-05T08:00:00' }).handleMessage('g2', 'ביטקוין?');
  check(r2.text.startsWith('על נושאי תשלום עונה רק המנהל.'),
    'extraDecline לבדו משמש כשאין decline של ורטיקל');
}

// ---------------------------------------------------------------------------
section('2. רגרסיה: מינוח מהטננט במקום "משך הטיפול"/"תור"');
{
  const veltrum = createAgent(shibutz, { now: '2026-08-05T08:00:00' });
  const price = veltrum.handleMessage('t1', 'כמה עולה שיחת דמו?');
  check(price.text.includes('משך השיחה'), `תשובת מחיר: "משך השיחה" (Veltrum) — ${price.text.split('\n')[0]}`);
  check(!price.text.includes('משך הטיפול'), 'אין "משך הטיפול" אצל טננט לא-קליני');

  ['אני רוצה לקבוע פגישה', '1', 'ישראל ישראלי', 'מרפאה', 'עשרות', 'אני', 'כן']
    .reduce((_, m) => veltrum.handleMessage('t2', m), null);
  const state = veltrum.getState();
  check(state.bookings.length === 1, 'ההזמנה הושלמה עם מינוח פגישה');
  const mine = veltrum.handleMessage('t2', 'מתי הפגישה שלי?');
  check(mine.text.includes('הפגישה הקרובה שלך'), '"מתי הפגישה שלי?" מזוהה עם המינוח המקומי');

  const clinical = createAgent(dental, { now: '2026-08-05T08:00:00' });
  const dprice = clinical.handleMessage('t3', 'כמה עולה ניקוי אבנית?');
  check(dprice.text.includes('משך הטיפול'), 'ברירת המחדל הקלינית נשמרה בטננט dental');
}

// ---------------------------------------------------------------------------
section('3. יחידה: פירוק webhook של Meta ו-payload יוצא');
{
  const body = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA1',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '972500000000', phone_number_id: '111222333' },
          contacts: [{ profile: { name: 'דנה' }, wa_id: '972501234567' }],
          messages: [
            { from: '972501234567', id: 'wamid.A1', timestamp: '1770000000', type: 'text', text: { body: 'שלום' } },
            { from: '972501234567', id: 'wamid.A2', timestamp: '1770000001', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'menu:book', title: 'קביעת פגישה 📅' } } },
            { from: '972501234567', id: 'wamid.A3', timestamp: '1770000002', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'slot:2026-08-05T12:00', title: 'רביעי 05.08 · 12:00' } } },
          ],
        },
      }],
    }],
  };
  const { messages } = wa.parseWebhook(body);
  check(messages.length === 3, 'שלוש הודעות פורקו');
  check(messages[0].input.text === 'שלום' && messages[0].phoneNumberId === '111222333', 'טקסט + phone_number_id');
  check(messages[1].input.buttonId === 'menu:book', 'button_reply → buttonId');
  check(messages[2].input.buttonId === 'slot:2026-08-05T12:00', 'list_reply → buttonId');

  const sender = wa.createWhatsAppSender({ token: null, log: () => {} });
  const few = sender.interactivePayload('972501234567', 'לאשר?', [
    { id: 'confirm', title: 'אישור ✔' }, { id: 'abort', title: 'ביטול' }]);
  check(few.interactive.type === 'button', 'עד 3 כפתורים → interactive buttons');
  const many = sender.interactivePayload('972501234567', 'מועדים:',
    Array.from({ length: 7 }, (_, i) => ({ id: `slot:${i}`, title: `מועד ${i} עם שם ארוך מאוד מאוד` })));
  check(many.interactive.type === 'list', '4+ כפתורים → interactive list');
  check(many.interactive.action.sections[0].rows.every((r) => r.title.length <= 24), 'כותרות שורה נחתכות ל-24 תווים');
}

// ---------------------------------------------------------------------------
section('4. יחידה: JWT של service account נחתם ומאומת');
{
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = {
    client_email: 'shibutz-test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  const jwt = gcal.signJwt(sa, 1770000000000);
  const [h, c, s] = jwt.split('.');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  check(header.alg === 'RS256', 'header alg=RS256');
  check(claims.iss === sa.client_email && claims.scope.includes('auth/calendar'), 'claims: iss + scope');
  check(claims.exp - claims.iat === 3600, 'תוקף שעה');
  const ok = crypto.createVerify('RSA-SHA256').update(`${h}.${c}`)
    .verify(publicKey, Buffer.from(s, 'base64url'));
  check(ok, 'החתימה מאומתת מול המפתח הציבורי');
}

// ---------------------------------------------------------------------------
// תשתית משותפת לבדיקות השרת: טננט google בתיקייה זמנית + רשת מדומה
// ---------------------------------------------------------------------------

const PHONE_ID = '111222333';
const APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'shibutz-verify-2026';
const CAL_ID = 'veltrum-test@group.calendar.google.com';
const FIXED_NOW = new Date(2026, 7, 5, 8, 0, 0).getTime(); // רביעי 08:00 מקומי

const { privateKey: saKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const FAKE_SA = {
  client_email: 'shibutz-live@test-project.iam.gserviceaccount.com',
  private_key: saKey.export({ type: 'pkcs8', format: 'pem' }),
};

function makeScratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shibutz-live-'));
  const tenantsDir = path.join(dir, 'tenants');
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(tenantsDir, { recursive: true });
  const live = JSON.parse(JSON.stringify(shibutz));
  live.calendar = { provider: 'google', calendarId: CAL_ID, additionalBusyCalendars: [] };
  live.whatsapp = { phoneNumberId: PHONE_ID };
  fs.writeFileSync(path.join(tenantsDir, 'shibutz.json'), JSON.stringify(live, null, 2));
  return { dir, tenantsDir, dataDir };
}

/** רשת Google מדומה: token, freeBusy עם חלון תפוס, ואירועים. */
function makeGoogleMock() {
  const calls = [];
  // תפוס ביומן: רביעי 10:00–12:00 שעון ישראל (IDT, +03:00 באוגוסט)
  const busyBlock = { start: '2026-08-05T10:00:00+03:00', end: '2026-08-05T12:00:00+03:00' };
  let eventSeq = 0;
  const fetchImpl = async (url, init) => {
    // גוף בקשת הטוקן הוא form-urlencoded, לא JSON — לא מפילים עליו את המוק
    let parsedBody = null;
    if (init && init.body) {
      try { parsedBody = JSON.parse(init.body); }
      catch (e) { parsedBody = String(init.body).slice(0, 40) + '…'; }
    }
    const record = { url, method: (init && init.method) || 'GET', body: parsedBody };
    calls.push(record);
    const respond = (status, json) => ({
      ok: status < 300, status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    });
    if (url.includes('oauth2.googleapis.com/token')) {
      return respond(200, { access_token: 'ya29.test', expires_in: 3600 });
    }
    if (url.endsWith('/freeBusy')) {
      return respond(200, { calendars: { [CAL_ID]: { busy: [busyBlock] } } });
    }
    if (url.includes('/events') && record.method === 'POST') {
      eventSeq += 1;
      return respond(200, { id: `gcal-evt-${eventSeq}` });
    }
    if (record.method === 'PATCH' || record.method === 'DELETE') {
      return respond(200, {});
    }
    return respond(404, { error: 'unexpected url ' + url });
  };
  return { calls, fetchImpl };
}

function makeWhatsAppMock() {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, payload: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.out' + sent.length }] }) };
  };
  return { sent, fetchImpl };
}

function sign(rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
}

let wamidSeq = 0;
function metaText(text) {
  wamidSeq += 1;
  return metaEnvelope({ from: '972501111111', id: `wamid.test${wamidSeq}`, timestamp: '1770000000', type: 'text', text: { body: text } });
}
function metaButton(id, title, kind) {
  wamidSeq += 1;
  const interactive = kind === 'list'
    ? { type: 'list_reply', list_reply: { id, title } }
    : { type: 'button_reply', button_reply: { id, title } };
  return metaEnvelope({ from: '972501111111', id: `wamid.test${wamidSeq}`, timestamp: '1770000000', type: 'interactive', interactive });
}
function metaEnvelope(message) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA-TEST',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '972500000000', phone_number_id: PHONE_ID },
          contacts: [{ profile: { name: 'לקוח בדיקה' }, wa_id: '972501111111' }],
          messages: [message],
        },
      }],
    }],
  };
}

async function drain(app) {
  for (const r of app.runtimes.values()) await r.queue;
}

function buildApp(scratch, mocks, extraEnv) {
  return createApp({
    env: {
      WHATSAPP_APP_SECRET: APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      ADMIN_SECRET: 'test-admin',
      GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify(FAKE_SA),
      ...extraEnv,
    },
    tenantsDir: scratch.tenantsDir,
    dataDir: scratch.dataDir,
    nowFn: () => FIXED_NOW,
    calendarFetch: mocks.google.fetchImpl,
    whatsappFetch: mocks.whatsapp.fetchImpl,
    log: (line) => mocks.logs.push(line),
  });
}

function listen(app) {
  return new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port));
  });
}

async function post(port, body, headers) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(`http://127.0.0.1:${port}/webhook/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: raw,
  });
  return res;
}

// ---------------------------------------------------------------------------
async function serverTests() {
  section('5. אימות webhook: אתגר GET של Meta');
  {
    const scratch = makeScratch();
    const mocks = { google: makeGoogleMock(), whatsapp: makeWhatsAppMock(), logs: [] };
    const app = buildApp(scratch, mocks, { WHATSAPP_TOKEN: 'test-token' });
    const port = await listen(app);

    const good = await fetch(`http://127.0.0.1:${port}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
    check(good.status === 200 && await good.text() === '1158201444', 'verify token נכון → מהדהד את hub.challenge');
    const bad = await fetch(`http://127.0.0.1:${port}/webhook/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=x`);
    check(bad.status === 403, 'verify token שגוי → 403');

    section('6. אימות חתימה X-Hub-Signature-256');
    const payload = metaText('שלום');
    const raw = JSON.stringify(payload);

    const unsigned = await post(port, raw, {});
    check(unsigned.status === 403, `POST בלי חתימה → ${unsigned.status} (403)`);
    const wrongSig = 'sha256=' + crypto.createHmac('sha256', 'wrong-secret').update(raw).digest('hex');
    const forged = await post(port, raw, { 'X-Hub-Signature-256': wrongSig });
    check(forged.status === 403, `POST עם חתימה מסוד שגוי → ${forged.status} (403)`);
    console.log(`     חתימה שנדחתה: ${wrongSig.slice(0, 30)}…`);
    const goodSig = sign(raw);
    const okRes = await post(port, raw, { 'X-Hub-Signature-256': goodSig });
    check(okRes.status === 200, `POST עם חתימה תקינה → ${okRes.status} (200)`);
    console.log(`     חתימה שהתקבלה: ${goodSig.slice(0, 30)}…`);
    await drain(app);

    section('7. תפר google: מועדים תפוסים ביומן לא מוצעים');
    // ביומן המדומה תפוס 10:00–12:00; עכשיו 08:00, מינימום התראה 120 דק' → בלי
    // יומן ההצעה הראשונה הייתה 10:00. עם היומן — חייבת להיות 12:00.
    const bookRaw = JSON.stringify(metaText('אני רוצה לקבוע פגישה'));
    await post(port, bookRaw, { 'X-Hub-Signature-256': sign(bookRaw) });
    await drain(app);
    const offer = mocks.whatsapp.sent[mocks.whatsapp.sent.length - 1].payload;
    check(offer.type === 'interactive' && offer.interactive.type === 'list', 'הצעת מועדים נשלחת כ-list (מעל 3 אפשרויות)');
    const offeredIsos = offer.interactive.action.sections[0].rows
      .map((r) => r.id).filter((id) => id.startsWith('slot:')).map((id) => id.slice(5));
    check(offeredIsos.length >= 3, `הוצעו ${offeredIsos.length} מועדים`);
    check(offeredIsos[0] === '2026-08-05T12:00', `המועד הראשון 12:00 — אחרי החלון התפוס (בפועל: ${offeredIsos[0]})`);
    check(!offeredIsos.some((iso) => iso >= '2026-08-05T10:00' && iso < '2026-08-05T12:00'),
      'אף מועד לא בתוך החלון התפוס 10:00–12:00');
    check(mocks.google.calls.some((c) => c.url.endsWith('/freeBusy')), 'busy רוענן מהיומן לפני המענה');

    section('8. זרימה מלאה: קביעה → אירוע ביומן, העברה → PATCH, ביטול → DELETE');
    const steps = [
      metaButton('slot:2026-08-05T12:00', 'רביעי 05.08 · 12:00', 'list'),
      metaText('ישראל ישראלי'),
      metaText('מרפאת שיניים'),
      metaText('עשרות'),
      metaText('אני'),
      metaButton('confirm', 'אישור ✔'),
    ];
    for (const s of steps) {
      const r = JSON.stringify(s);
      await post(port, r, { 'X-Hub-Signature-256': sign(r) });
      await drain(app);
    }
    const confirmMsg = mocks.whatsapp.sent[mocks.whatsapp.sent.length - 1].payload;
    const confirmText = confirmMsg.text ? confirmMsg.text.body : confirmMsg.interactive.body.text;
    check(confirmText.includes('הפגישה נקבעה'), 'אישור ההזמנה במינוח הטננט');
    const insert = mocks.google.calls.find((c) => c.method === 'POST' && c.url.includes('/events'));
    check(!!insert, 'נשלחה יצירת אירוע ל-Google Calendar');
    check(insert && insert.body.start.dateTime === '2026-08-05T12:00:00' &&
      insert.body.start.timeZone === 'Asia/Jerusalem', 'זמן האירוע: dateTime מקומי + timeZone של הטננט');
    check(insert && insert.body.end.dateTime === '2026-08-05T12:15:00', 'משך 15 דק\' (שיחת דמו)');
    check(insert && insert.body.summary.includes('ישראל ישראלי'), 'שם הלקוח בכותרת האירוע');
    check(insert && insert.body.extendedProperties.private.shibutzBookingId.startsWith('APT-'),
      'האסמכתא נשמרת על האירוע (extendedProperties)');

    const resched = [
      metaText('אני רוצה להזיז את הפגישה'),
      metaButton('slot:2026-08-05T12:30', 'רביעי 05.08 · 12:30', 'list'),
      metaButton('reconfirm', 'כן, להעביר ✔'),
    ];
    for (const s of resched) {
      const r = JSON.stringify(s);
      await post(port, r, { 'X-Hub-Signature-256': sign(r) });
      await drain(app);
    }
    const patch = mocks.google.calls.find((c) => c.method === 'PATCH');
    check(!!patch && patch.url.includes('gcal-evt-1'), 'העברת מועד → PATCH על אותו אירוע');
    check(patch && patch.body.start.dateTime === '2026-08-05T12:30:00', 'המועד החדש נכתב ליומן');

    const cancel = [metaText('לבטל את הפגישה'), metaButton('cancel:confirm', 'כן, לבטל')];
    for (const s of cancel) {
      const r = JSON.stringify(s);
      await post(port, r, { 'X-Hub-Signature-256': sign(r) });
      await drain(app);
    }
    const del = mocks.google.calls.find((c) => c.method === 'DELETE');
    check(!!del && del.url.includes('gcal-evt-1'), 'ביטול → DELETE של האירוע ביומן');

    section('9. עמידות: כפילות משלוח של Meta + ריסטרט לא מאבד מצב');
    const sentBefore = mocks.whatsapp.sent.length;
    const dup = metaText('שלום');
    const dupRaw = JSON.stringify(dup);
    await post(port, dupRaw, { 'X-Hub-Signature-256': sign(dupRaw) });
    await drain(app);
    await post(port, dupRaw, { 'X-Hub-Signature-256': sign(dupRaw) }); // אותו wamid — משלוח חוזר
    await drain(app);
    check(mocks.whatsapp.sent.length === sentBefore + 1, 'הודעה כפולה (אותו message id) נענית פעם אחת בלבד');

    await new Promise((r) => app.server.close(r));

    // "ריסטרט": אפליקציה חדשה על אותו data dir — ההזמנה שבוטלה מוכרת, שיחה נמשכת
    const mocks2 = { google: makeGoogleMock(), whatsapp: makeWhatsAppMock(), logs: [] };
    const app2 = buildApp(scratch, mocks2, { WHATSAPP_TOKEN: 'test-token' });
    const port2 = await listen(app2);
    const q = metaText('מתי הפגישה שלי?');
    const qRaw = JSON.stringify(q);
    await post(port2, qRaw, { 'X-Hub-Signature-256': sign(qRaw) });
    await drain(app2);
    const afterRestart = mocks2.whatsapp.sent[mocks2.whatsapp.sent.length - 1].payload;
    const artText = afterRestart.text ? afterRestart.text.body : afterRestart.interactive.body.text;
    check(artText.includes('לא מצאתי פגישה פעילה'),
      'אחרי ריסטרט: השרת זוכר שהפגישה בוטלה (המצב שוחזר מהדיסק)');

    section('10. טעינת טננטים מחדש (SIGHUP) בלי לאבד שיחות');
    const liveFile = path.join(scratch.tenantsDir, 'shibutz.json');
    const editable = JSON.parse(fs.readFileSync(liveFile, 'utf8'));
    editable.services[0].price = 'ללא עלות — מבצע השקה';
    fs.writeFileSync(liveFile, JSON.stringify(editable, null, 2));
    app2.loadAllTenants();
    const priceQ = metaText('כמה עולה שיחת דמו?');
    const priceRaw = JSON.stringify(priceQ);
    await post(port2, priceRaw, { 'X-Hub-Signature-256': sign(priceRaw) });
    await drain(app2);
    const priceReply = mocks2.whatsapp.sent[mocks2.whatsapp.sent.length - 1].payload;
    const priceText = priceReply.text ? priceReply.text.body : priceReply.interactive.body.text;
    check(priceText.includes('מבצע השקה'), 'אחרי reload: המחיר החדש מהקובץ בתוקף');
    const q2 = metaText('מתי הפגישה שלי?');
    const q2Raw = JSON.stringify(q2);
    await post(port2, q2Raw, { 'X-Hub-Signature-256': sign(q2Raw) });
    await drain(app2);
    const memReply = mocks2.whatsapp.sent[mocks2.whatsapp.sent.length - 1].payload;
    const memText = memReply.text ? memReply.text.body : memReply.interactive.body.text;
    check(memText.includes('לא מצאתי פגישה פעילה'), 'אחרי reload: היסטוריית השיחה נשמרה');

    await new Promise((r) => app2.server.close(r));
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  section('11. DRY-RUN: בלי WHATSAPP_TOKEN שום דבר לא נשלח — ה-payload נרשם');
  {
    const scratch = makeScratch();
    const mocks = { google: makeGoogleMock(), whatsapp: makeWhatsAppMock(), logs: [] };
    const app = buildApp(scratch, mocks, {}); // בלי טוקן
    const port = await listen(app);
    const msg = metaText('כמה עולה שיחת דמו?');
    const raw = JSON.stringify(msg);
    const res = await post(port, raw, { 'X-Hub-Signature-256': sign(raw) });
    await drain(app);
    check(res.status === 200, 'ה-webhook נענה 200');
    check(mocks.whatsapp.sent.length === 0, 'אפס קריאות יוצאות ל-Meta');
    const dryLog = mocks.logs.find((l) => l.includes('DRY-RUN'));
    check(!!dryLog && dryLog.includes('graph.facebook.com') && dryLog.includes('111222333/messages'),
      'ה-URL וה-payload המלא נרשמו ללוג');
    console.log('\n     —— ה-payload שהיה נשלח (מתוך הלוג) ——');
    console.log(dryLog.split('\n').map((l) => '     ' + l).join('\n'));
    await new Promise((r) => app.server.close(r));
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }

  section('12. גדר עלייה לאוויר: טננט google בלי יומן תקין לא מקבל תנועה');
  {
    const scratch = makeScratch();
    const mocks = { google: makeGoogleMock(), whatsapp: makeWhatsAppMock(), logs: [] };
    const app = buildApp(scratch, mocks, { GOOGLE_SERVICE_ACCOUNT_JSON: '' }); // אין SA
    const runtime = app.findBySlug('shibutz');
    check(runtime && !runtime.webhookActive, 'הטננט מושבת (לא קובעים תורים בלי יומן)');
    check(runtime.issues.length > 0 && mocks.logs.some((l) => l.includes('service account')),
      'הבעיה נרשמה בקול רם בלוג');
    fs.rmSync(scratch.dir, { recursive: true, force: true });
  }
}

async function reviewRegressionTests() {
  section('13. כפתור ישן (סטייל וואטסאפ) לעולם לא מחזיר null');
  {
    const agent = createAgent(shibutz, { now: '2026-08-05T08:00:00' });
    // הלקוח לוחץ "אישור" מהודעה ישנה בהיסטוריה, בלי שום זרימה פעילה
    const r = agent.handleMessage('stale1', { buttonId: 'confirm', buttonTitle: 'אישור ✔' });
    check(r != null && typeof r.text === 'string' && r.text.length > 0,
      'לחיצה על כפתור לא-רלוונטי מחזירה תשובה ידידותית');
    const r2 = agent.handleMessage('stale2', { buttonId: 'cancel:confirm', buttonTitle: 'כן, לבטל' });
    check(r2 != null && r2.buttons.length > 0, 'גם cancel:confirm ישן — תשובה עם תפריט');
  }

  section('14. יחידה: קצוות WhatsApp — נפילת רשת ותווי תבנית');
  {
    const failingSender = wa.createWhatsAppSender({
      token: 'live-token',
      fetchImpl: async () => { throw new Error('ECONNRESET'); },
      log: () => {},
    });
    const res = await failingSender.post('111', { type: 'text' });
    check(res.error === true && res.network === true, 'נפילת fetch חוזרת כ-{error} ולא כחריגה');

    const sender = wa.createWhatsAppSender({ token: null, log: () => {} });
    const tpl = sender.templatePayload('972501111111', 'lead_alert',
      ['פנייה חדשה:\nכאב\tחזק  מאוד'], 'he');
    check(!/[\n\t]/.test(tpl.template.components[0].parameters[0].text) &&
      !/ {2,}/.test(tpl.template.components[0].parameters[0].text),
      'פרמטר תבנית מנוקה משורות חדשות/טאבים (Meta דוחה אותם)');
  }

  section('15. יחידה: אירוע שנגמר בחצות מתגלגל ליום הבא');
  {
    const calls = [];
    const client = gcal.createCalendarClient({
      serviceAccount: FAKE_SA,
      nowFn: () => FIXED_NOW,
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init && init.body && init.body[0] === '{' ? JSON.parse(init.body) : null });
        if (url.includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 3600 }), text: async () => '' };
        return { ok: true, status: 200, json: async () => ({ id: 'e1' }), text: async () => '{"id":"e1"}' };
      },
    });
    await client.createEvent(CAL_ID, {
      summary: 'בדיקת חצות', slotIso: '2026-08-05T23:30', durationMinutes: 30, timeZone: 'Asia/Jerusalem',
    });
    const ev = calls.find((c) => c.body && c.body.start);
    check(ev.body.start.dateTime === '2026-08-05T23:30:00' && ev.body.end.dateTime === '2026-08-06T00:00:00',
      `סיום בחצות → תאריך היום הבא (${ev.body.end.dateTime})`);
  }

  section('16. שרת: כשל שליחה לא מוחק מצב, dry-run לא נוגע בסוכן החי, phoneNumberId כפול');
  {
    // כשל שליחה קבוע: המצב עדיין נשמר לדיסק וה-loop לא קורס
    const scratch = makeScratch();
    const mocks = {
      google: makeGoogleMock(),
      whatsapp: { sent: [], fetchImpl: async () => { throw new Error('ETIMEDOUT'); } },
      logs: [],
    };
    const app = buildApp(scratch, mocks, { WHATSAPP_TOKEN: 'live' });
    const port = await listen(app);
    const raw = JSON.stringify(metaText('שלום'));
    await post(port, raw, { 'X-Hub-Signature-256': sign(raw) });
    await drain(app);
    check(mocks.logs.some((l) => l.includes('שגיאת רשת בשליחה')), 'כשל שליחה נרשם בלוג');
    check(fs.existsSync(path.join(scratch.dataDir, 'state-shibutz.json')),
      'המצב נשמר לדיסק גם כשהשליחה נכשלה');

    // dry-run על עותק: הסוכן החי לא זוכר את השיחה
    const dryRes = await fetch(`http://127.0.0.1:${port}/admin/dry-run`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant: 'shibutz', text: 'אני רוצה לקבוע פגישה' }),
    });
    const dry = await dryRes.json();
    check(dry.reply && dry.reply.buttons.some((b) => b.id.startsWith('slot:')), 'dry-run מחזיר הצעת מועדים');
    const liveSessions = app.findBySlug('shibutz').agent.exportState().sessions;
    check(!liveSessions['dry-run'], 'הסוכן החי לא הושפע מה-dry-run (עותק)');
    await new Promise((r) => app.server.close(r));
    fs.rmSync(scratch.dir, { recursive: true, force: true });

    // phoneNumberId כפול: תנועה לא מנותבת לאף אחד מהשניים
    const scratch2 = makeScratch();
    const dupTenant = JSON.parse(fs.readFileSync(path.join(scratch2.tenantsDir, 'shibutz.json'), 'utf8'));
    dupTenant.id = 'shibutz-copy';
    fs.writeFileSync(path.join(scratch2.tenantsDir, 'shibutz-copy.json'), JSON.stringify(dupTenant));
    const mocks2 = { google: makeGoogleMock(), whatsapp: makeWhatsAppMock(), logs: [] };
    const app2 = buildApp(scratch2, mocks2, { WHATSAPP_TOKEN: 'live' });
    const port2 = await listen(app2);
    const raw2 = JSON.stringify(metaText('שלום'));
    await post(port2, raw2, { 'X-Hub-Signature-256': sign(raw2) });
    await drain(app2);
    check(mocks2.whatsapp.sent.length === 0 && mocks2.logs.some((l) => l.includes('כפול')),
      'phoneNumberId שמופיע בשני טננטים — לא מנותב ונרשם בקול');
    await new Promise((r) => app2.server.close(r));
    fs.rmSync(scratch2.dir, { recursive: true, force: true });
  }
}

serverTests().then(() => reviewRegressionTests()).then(() => {
  console.log(`\n${failed ? '❌' : '✅'} ${passed}/${passed + failed} בדיקות תשתית חיה עברו`);
  process.exit(failed ? 1 : 0);
}).catch((err) => {
  console.error('❌ חריגה:', err);
  process.exit(1);
});
