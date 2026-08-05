/**
 * דמו בטרמינל — משוחחים עם הבוט בלי Twilio ובלי WhatsApp.
 * הרצה:  npm run demo
 *
 * שימושי כדי להראות ללקוח את כל הזרימה תוך 30 שניות,
 * כולל התזכורת שנשלחת אחרי דקה (תודפס כאן לקונסול —
 * השאירו את החלון פתוח כדי לראות אותה).
 */

const readline = require('readline');
const { handleIncomingMessage } = require('./bot');

// מספר טלפון פיקטיבי שמייצג את "המטופל" בשיחת הדמו
const DEMO_PHONE = 'whatsapp:+972500000000';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '👤 אתם: ',
});

console.log('\n═══════════════════════════════════════════');
console.log('  💬 דמו בוט תורים — שיחה בטרמינל');
console.log('  נסו: "אני רוצה תור"  |  יציאה: exit');
console.log('═══════════════════════════════════════════\n');

async function main() {
  rl.prompt();

  // for await על ה-readline שומר על סדר השורות גם כשהקלט מגיע מ-pipe,
  // בניגוד ל-rl.question עם callback אסינכרוני שמאבד שורות שהגיעו יחד.
  for await (const line of rl) {
    if (line.trim().toLowerCase() === 'exit') break;

    if (line.trim()) {
      const reply = await handleIncomingMessage(DEMO_PHONE, line);
      console.log(`\n🤖 הבוט:\n${reply}\n`);
    }
    rl.prompt();
  }

  rl.close();
  console.log('\n👋 להתראות! (התזכורת נשלחת דקה אחרי אישור התור)\n');
}

main();
