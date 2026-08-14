/**
 * סימולטור שיחה מול הסוכן — בלי WhatsApp, בלי רשת.
 *
 *   npm run sim <slug>                 שיחה אינטראקטיבית בטרמינל
 *   npm run sim <slug> -- --now <iso>  קיבוע שעון (למועדים דטרמיניסטיים)
 *   echo "..." | npm run sim <slug>    מצב צינור — לבדיקות אוטומטיות
 *
 * פקודות מיוחדות: /state — הצגת מצב (תורים, לידים, התראות); exit — יציאה.
 * דגל --jsonl מדפיס גם שורות מכונה (@@ {...}) עבור מריץ הבדיקות.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { createAgent } = require('../core/agent');

function parseArgs(argv) {
  const args = { slug: null, now: null, jsonl: false, session: 'sim-1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--now') args.now = argv[++i];
    else if (a === '--jsonl') args.jsonl = true;
    else if (a === '--session') args.session = argv[++i];
    else if (!a.startsWith('--') && !args.slug) args.slug = a;
  }
  return args;
}

function loadTenant(slug) {
  const file = path.join(__dirname, '..', '..', 'tenants', `${slug}.json`);
  if (!fs.existsSync(file)) {
    console.error(`❌ לא נמצא קובץ טננט: tenants/${slug}.json`);
    const available = fs.readdirSync(path.join(__dirname, '..', '..', 'tenants'))
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .map((f) => f.replace(/\.json$/, ''));
    if (available.length) console.error(`   טננטים זמינים: ${available.join(', ')}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function renderReply(reply) {
  let out = `\n🤖 ${reply.text}\n`;
  if (reply.buttons && reply.buttons.length) {
    out += reply.buttons.map((b, i) => `   [${i + 1}] ${b.title}`).join('\n') + '\n';
  }
  return out;
}

function renderState(state) {
  const lines = [];
  lines.push('┌── 🎛  מצב הדמו ──────────────────────────');
  lines.push(`│ עסק: ${state.businessName} (${state.tenantId})`);
  lines.push(`│ תורים (${state.bookings.length}):`);
  state.bookings.forEach((b) => {
    const mark = b.status === 'active' ? '🟢' : '⚪';
    lines.push(`│   ${mark} ${b.id} · ${b.service} · ${b.slotLabel} · ${b.name} · ${b.status}`);
  });
  lines.push(`│ לידים (${state.leads.length}):`);
  state.leads.forEach((l) => {
    const hot = l.hot ? '🔥' : '  ';
    lines.push(`│   ${hot} ${l.name || '(ללא שם)'} · ניקוד ${l.score} · ${JSON.stringify(l.answers)}`);
  });
  lines.push(`│ התראות (${state.alerts.length}):`);
  state.alerts.forEach((a) => {
    lines.push(`│   🚨 [${a.type}] "${a.message}" → SMS אל ${a.notifyPhones.join(', ') || '(לא הוגדרו)'}`);
  });
  lines.push('└──────────────────────────────────────────');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.slug) {
    console.error('שימוש: npm run sim <slug>   (למשל: npm run sim test-dental)');
    process.exit(1);
  }

  const tenant = loadTenant(args.slug);
  const agent = createAgent(tenant, args.now ? { now: args.now } : {});

  agent.validation.warnings.forEach((w) => console.error(`⚠️  ${w}`));

  const interactive = process.stdin.isTTY;
  console.log('═══════════════════════════════════════════');
  console.log(`  💬 סימולטור שיבוץ — ${tenant.businessName}`);
  console.log(`  ורטיקל: ${tenant.vertical} · יומן: memory`);
  console.log('  פקודות: /state · exit · מספר = לחיצת כפתור');
  console.log('═══════════════════════════════════════════');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '👤 ', terminal: interactive });
  if (interactive) rl.prompt();

  for await (const line of rl) {
    const text = line.trim();
    if (!text) { if (interactive) rl.prompt(); continue; }
    if (text.toLowerCase() === 'exit') break;
    if (!interactive) console.log(`👤 ${text}`);

    if (text === '/state') {
      console.log(renderState(agent.getState()));
      if (interactive) rl.prompt();
      continue;
    }

    const reply = agent.handleMessage(args.session, text);
    console.log(renderReply(reply));
    if (reply.alert) {
      console.log(`🚨 התראה לצוות [${reply.alert.type}] → SMS אל ${reply.alert.notifyPhones.join(', ') || '(לא הוגדרו נמענים)'}`);
    }
    if (args.jsonl) console.log('@@ ' + JSON.stringify({ user: text, reply }));
    if (interactive) rl.prompt();
  }

  rl.close();
  console.log('\n' + renderState(agent.getState()));
  console.log('\n👋 להתראות!');
}

main();
