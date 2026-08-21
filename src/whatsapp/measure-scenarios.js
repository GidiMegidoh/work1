/**
 * מדידת הודעות-לשיחה עבור תרחישי הקבלה של demo-dental — הבסיס להחלטות
 * איחוד הודעות לקראת החיוב פר-הודעה של Meta (01.10.2026).
 *
 *   node src/whatsapp/measure-scenarios.js
 *
 * כל תרחיש רץ דרך handler + meter טריים עם טרנספורט sim — אפס קריאות רשת.
 * שתי שורות הייחוס (ר1, ר2) אינן חלק מששת תרחישי הקבלה: הן מודדות את יחידת
 * השיחה שהאיחודים פועלים עליה (הזמנה מלאה, עם ובלי פתיחת "שלום").
 */

'use strict';

const crypto = require('crypto');
const { loadConfig, loadTenant } = require('./config');
const { createSimTransport } = require('./transport');
const { createWebhookHandler } = require('./handler');

const APP_SECRET = 'measure-app-secret';
const WA_ID = '972501112233';
const PHONE_NUMBER_ID = '000000000000000';

let wamidSeq = 0;
function textEnvelope(body) {
  wamidSeq += 1;
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
          messages: [{
            from: WA_ID, id: 'wamid.MEASURE' + String(wamidSeq).padStart(4, '0'),
            timestamp: '1787000000', type: 'text', text: { body: body },
          }],
        },
      }],
    }],
  };
}

function sign(raw) {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
}

const BOOKING_TURNS = [
  'אני רוצה לקבוע תור לניקוי', '1', 'דנה כהן', 'בדיקה שגרתית', 'כן',
];

const SCENARIOS = [
  { name: '1. שאלת מחיר + הצהרה', turns: ['כמה עולה סתימה?'] },
  { name: '2. הצעת מועדים בשעות הפעילות', turns: ['אני רוצה לקבוע תור לניקוי'] },
  {
    name: '3. קביעה → העברה → ביטול',
    turns: [...BOOKING_TURNS, 'אני רוצה להזיז את התור', '2', 'כן', 'אני רוצה לבטל את התור', 'כן'],
  },
  { name: '4. שאלה מחוץ ל-FAQ → הסלמה', turns: ['מה הייתה תוצאת משחק הכדורגל אתמול?'] },
  { name: '5. גדר רפואית: סירוב + הצעת תור', turns: ['יש לי כאב שן', 'יש לי נפיחות בחניכיים, מה כדאי לקחת?'] },
  { name: '6. נציג → העברה + התראה', turns: ['נציג'] },
  { name: 'ר1. הזמנה מלאה (ייחוס)', turns: BOOKING_TURNS },
  { name: 'ר2. הזמנה מלאה שנפתחת ב"שלום" (ייחוס)', turns: ['שלום', ...BOOKING_TURNS] },
];

async function main() {
  const cfg = loadConfig({
    mode: 'sim',
    appSecret: APP_SECRET,
    verifyToken: 'measure-verify-token',
    overrides: { phoneNumberId: PHONE_NUMBER_ID, tenantSlug: 'demo-dental' },
  });
  const tenant = loadTenant(cfg.tenantSlug);

  console.log('='.repeat(72));
  console.log(`  הודעות-לשיחה — ${tenant.businessName} (${tenant.id}) · sim · אפס רשת`);
  console.log('='.repeat(72));

  const rows = [];
  for (const scenario of SCENARIOS) {
    const handler = createWebhookHandler({
      config: cfg, tenant, transport: createSimTransport(cfg),
      agentOpts: { now: '2026-08-23T09:00' }, logger: () => {},
    });
    for (const turn of scenario.turns) {
      const raw = Buffer.from(JSON.stringify(textEnvelope(turn)), 'utf8');
      const out = await handler.receive(raw, { 'x-hub-signature-256': sign(raw) });
      if (out.status !== 200) throw new Error(`${scenario.name}: "${turn}" → ${out.status}`);
    }
    const m = handler.meter.get(WA_ID);
    rows.push({ name: scenario.name, turns: scenario.turns.length, ...m });
  }

  console.log('\n  תרחיש · הודעות לקוח · תשובות שירות · תבניות · סה"כ לחיוב\n');
  for (const r of rows) {
    console.log(`  ${r.name}`);
    console.log(`      לקוח: ${r.turns} · תשובות: ${r.reply} · תבניות: ${r.template} · לחיוב: ${r.total}`);
  }
  const six = rows.slice(0, 6);
  const totalSix = six.reduce((s, r) => s + r.total, 0);
  console.log(`\n  סה"כ ששת התרחישים: ${totalSix} הודעות לחיוב`);
  console.log('='.repeat(72));
}

main().catch((err) => { console.error('[ERROR] ' + err.stack); process.exit(1); });
