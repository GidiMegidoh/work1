/**
 * שליחת דמו לליד מהטרמינל, בפקודה אחת:
 *
 *   npm run send-demo -- "+972501234567" "היי דנה, ראיתי את הקליניקה שלכם..."
 *
 * בלי הודעה — נשלחת הודעת ברירת המחדל. לבדיקה בלי שליחה אמיתית:
 *
 *   DRY_RUN=1 npm run send-demo -- 0501234567
 */

'use strict';

const { sendDemo } = require('./send-demo');

const [phone, ...rest] = process.argv.slice(2);
const message = rest.join(' ') ||
  'היי! רציתי להראות לך את שיבוץ — סוכן WhatsApp שעונה ללקוחות וקובע תורים בשבילך, בעברית.';

if (!phone) {
  console.error('שימוש: npm run send-demo -- <טלפון> [הודעה]');
  console.error('למשל:  npm run send-demo -- "+972501234567" "היי, הנה הדמו שדיברנו עליו"');
  process.exit(1);
}

sendDemo({ phone, message }).catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
