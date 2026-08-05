/**
 * מקים טננט דמו חדש ללקוח פוטנציאלי בפקודה אחת:
 *
 *   npm run demo:new <slug> [vertical] [-- --name "שם העסק"]
 *
 * הוורטיקל נלקח מהארגומנט, או מזוהה מתוך ה-slug (demo-dental → dental),
 * וכברירת מחדל general. הקובץ נוצר מ-preset מלא של הוורטיקל — עובד מיד,
 * בלי עריכה ידנית: calendar.provider=memory ואפס חיבורים חיצוניים.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { validateTenant } = require('../core/agent');

const ROOT = path.join(__dirname, '..', '..');
const PRESETS_DIR = path.join(ROOT, 'src', 'presets');
const VERTICALS = ['dental', 'medical', 'aesthetics', 'legal', 'fitness', 'general'];

function parseArgs(argv) {
  const args = { slug: null, vertical: null, name: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') args.name = argv[++i];
    else if (a === '--force') args.force = true;
    else if (!a.startsWith('--') && !args.slug) args.slug = a;
    else if (!a.startsWith('--') && !args.vertical) args.vertical = a;
  }
  return args;
}

function inferVertical(slug) {
  for (const v of VERTICALS) {
    if (slug.includes(v)) return v;
  }
  const hebrewHints = { dental: ['shen', 'shinaim'], legal: ['law', 'adv'], fitness: ['gym', 'fit'] };
  for (const [v, hints] of Object.entries(hebrewHints)) {
    if (hints.some((h) => slug.includes(h))) return v;
  }
  return 'general';
}

const args = parseArgs(process.argv.slice(2));

if (!args.slug || !/^[a-z0-9][a-z0-9-]*$/.test(args.slug)) {
  console.error('שימוש: npm run demo:new <slug> [vertical]');
  console.error('       ה-slug באנגלית, kebab-case (למשל: demo-dental)');
  console.error(`       ורטיקלים: ${VERTICALS.join(' | ')}`);
  process.exit(1);
}

const vertical = args.vertical || inferVertical(args.slug);
if (!VERTICALS.includes(vertical)) {
  console.error(`❌ ורטיקל לא מוכר: "${vertical}". מותר: ${VERTICALS.join(' | ')}`);
  process.exit(1);
}

const target = path.join(ROOT, 'tenants', `${args.slug}.json`);
if (fs.existsSync(target) && !args.force) {
  console.error(`❌ tenants/${args.slug}.json כבר קיים. להחלפה הוסיפו --force`);
  process.exit(1);
}

// טוענים את ה-preset של הוורטיקל; אם אין — נופלים לתבנית הכללית
const presetFile = path.join(PRESETS_DIR, `${vertical}.json`);
const sourceFile = fs.existsSync(presetFile)
  ? presetFile
  : path.join(ROOT, 'tenants', '_template.json');

const tenant = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
delete tenant._readme;

tenant.id = args.slug;
if (args.name) tenant.businessName = args.name;

// מצב דמו: יומן בזיכרון בלבד, בלי WhatsApp אמיתי
tenant.calendar = { provider: 'memory', calendarId: null, additionalBusyCalendars: [] };
tenant.whatsapp = { phoneNumberId: null };

const check = validateTenant(tenant);
if (check.errors.length) {
  console.error('❌ ה-preset יצר קובץ לא תקין (באג — דווחו):');
  check.errors.forEach((e) => console.error(`   ✗ ${e}`));
  process.exit(1);
}

fs.writeFileSync(target, JSON.stringify(tenant, null, 2) + '\n', 'utf8');

console.log(`✅ נוצר טננט דמו: tenants/${args.slug}.json`);
console.log(`   עסק: ${tenant.businessName} · ורטיקל: ${vertical} · יומן: memory`);
check.warnings.forEach((w) => console.log(`   ⚠️  ${w}`));
console.log('');
console.log('הצעדים הבאים:');
console.log(`   npm run sim ${args.slug}     ← שיחה בטרמינל`);
console.log(`   npm run demo ${args.slug}    ← נגן הדמו + אתר העסק בדפדפן`);
console.log('');
console.log(`להתאמה ללקוח: ערכו את tenants/${args.slug}.json — שם, שעות, מחירים ו-FAQ.`);
