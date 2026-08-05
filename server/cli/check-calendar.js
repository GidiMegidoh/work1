/**
 * "בדיקת יומן" — מוודא שחשבון השירות רואה וכותב ליומן של הלקוח.
 * מריצים בזמן שיחת ההטמעה, כשהלקוח על הקו (סעיף 4 ב-SKILL).
 *
 *   node server/cli/check-calendar.js <slug|calendarId>
 *
 * slug של טננט (למשל shibutz) בודק את calendarId + additionalBusyCalendars
 * מהקובץ שלו; כל ערך אחר נבדק כ-calendarId ישיר.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { loadEnv } = require('../lib/env');
const { loadServiceAccount, createCalendarClient } = require('../lib/google-calendar');

const ROOT = path.join(__dirname, '..', '..');

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('שימוש: node server/cli/check-calendar.js <slug|calendarId>');
    process.exit(1);
  }

  const env = loadEnv(path.join(ROOT, '.env'));
  let sa;
  try {
    sa = loadServiceAccount(env);
  } catch (err) {
    console.error(`❌ service account לא נטען: ${err.message}`);
    process.exit(1);
  }
  if (!sa) {
    console.error('❌ אין service account. יש להגדיר GOOGLE_SERVICE_ACCOUNT_JSON (תוכן ה-JSON) או GOOGLE_SERVICE_ACCOUNT_FILE (נתיב) ב-.env');
    process.exit(1);
  }

  let calendarId = target;
  let additional = [];
  let timezone = 'Asia/Jerusalem';
  const tenantFile = path.join(ROOT, 'tenants', `${target}.json`);
  if (fs.existsSync(tenantFile)) {
    const tenant = JSON.parse(fs.readFileSync(tenantFile, 'utf8'));
    if (!tenant.calendar || !tenant.calendar.calendarId) {
      console.error(`❌ לטננט ${target} אין calendar.calendarId בקובץ`);
      process.exit(1);
    }
    calendarId = tenant.calendar.calendarId;
    additional = tenant.calendar.additionalBusyCalendars || [];
    timezone = tenant.timezone || timezone;
    console.log(`טננט: ${tenant.businessName} (${target})`);
  }

  console.log(`חשבון שירות: ${sa.client_email}`);
  console.log(`יומן: ${calendarId}${additional.length ? ` (+${additional.length} יומני busy)` : ''}`);
  console.log('בודק...\n');

  const client = createCalendarClient({ serviceAccount: sa });
  const report = await client.calendarCheck(calendarId, additional, timezone);

  console.log(`${report.readOk ? '✅' : '❌'} קריאת פנוי/תפוס (freeBusy)`);
  console.log(`${report.writeOk ? '✅' : '❌'} כתיבת אירוע ומחיקתו`);
  for (const extra of report.additional) {
    console.log(`${extra.ok ? '✅' : '❌'} יומן busy נוסף: ${extra.id}${extra.error ? ` (${extra.error})` : ''}`);
  }
  for (const err of report.errors) console.log(`   ✗ ${err}`);

  const ok = report.readOk && report.writeOk && report.additional.every((a) => a.ok);
  console.log(ok
    ? '\n✅ היומן מחווט נכון — אפשר להפעיל calendar.provider="google" לטננט.'
    : `\n❌ היומן לא מוכן. לרוב הפתרון: שיתוף היומן עם ${sa.client_email} בהרשאת "Make changes to events".`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
