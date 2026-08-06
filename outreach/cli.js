/**
 * שליחת דמו לפרוספקט בפקודה אחת:
 *
 *   npm run send-demo -- <phone> "<message>"
 *   npm run send-demo -- +972501234567 "היי דנה, ראיתי את הקליניקה שלך"
 *   npm run send-demo -- --log            ← הצגת יומן השליחות
 *
 * ההודעה הסופית = הטקסט שלכם + קישור לדמו + קריאה לפעולה (ראו
 * buildMessage ב-send-demo.js). בלי credentials של Twilio רץ במצב dry-run.
 */

'use strict';

const { sendDemo, readLog, getConfig } = require('./send-demo');

const args = process.argv.slice(2).filter((a) => a !== '--');

if (args[0] === '--log') {
  const log = readLog();
  if (!log.length) {
    console.log('היומן ריק — עוד לא נשלחו דמואים.');
  } else {
    for (const e of log) {
      const icon = { sent: '📤', 'dry-run': '🧪', failed: '❌' }[e.status] || '·';
      console.log(`${icon} ${e.at}  ${e.to}  [${e.status}]${e.sid ? '  ' + e.sid : ''}${e.error ? '  ' + e.error : ''}`);
    }
    console.log(`\nסה"כ: ${log.length} (יומן מלא: outreach/send-log.json)`);
  }
  process.exit(0);
}

const [phone, ...messageParts] = args;
const message = messageParts.join(' ');

if (!phone || !message) {
  console.error('שימוש: npm run send-demo -- <phone> "<message>"');
  console.error('       npm run send-demo -- +972501234567 "היי דנה, הנה הדמו שדיברנו עליו"');
  console.error('       npm run send-demo -- --log');
  process.exit(1);
}

(async () => {
  const cfg = getConfig();
  const result = await sendDemo({ phone, message });

  if (!result.ok) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }

  console.log(result.dryRun
    ? `🧪 dry-run — לא נשלח בפועל (${result.note})`
    : `📤 נשלח ל-${result.to} (Twilio SID: ${result.sid})`);
  console.log('');
  console.log('─── ההודעה ───');
  console.log(result.body);
  console.log('──────────────');
  if (cfg.demoUrlIsDefault) {
    console.log('⚠️  DEMO_URL לא הוגדר — נשלח קישור localhost. הגדירו DEMO_URL בקובץ .env');
  }
  console.log('היומן: outreach/send-log.json  (או npm run send-demo -- --log)');
})();
