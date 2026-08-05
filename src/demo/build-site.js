/**
 * בונה את אתר הדמו הסטטי של טננט: demo/sites/<slug>/
 *
 *   node src/demo/build-site.js <slug>
 *
 * הפלט עומד בפני עצמו וניתן לאירוח סטטי בכל מקום: הסוכן (agent.js) רץ
 * בדפדפן, כך שאין צורך בשרת — והקריאה היחידה לרשת היא טעינת tenant.json.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(__dirname, 'assets');

const VERTICALS = {
  dental: { emoji: '🦷', accent: '#0284c7', accentDark: '#075985', tagline: 'חיוך בריא מתחיל בתור אחד פשוט' },
  medical: { emoji: '🩺', accent: '#059669', accentDark: '#065f46', tagline: 'רפואה אישית, קרובה וזמינה' },
  aesthetics: { emoji: '✨', accent: '#c026d3', accentDark: '#86198f', tagline: 'הגרסה הזוהרת ביותר שלך' },
  legal: { emoji: '⚖️', accent: '#b45309', accentDark: '#78350f', tagline: 'ליווי משפטי שאפשר לסמוך עליו' },
  fitness: { emoji: '💪', accent: '#ea580c', accentDark: '#9a3412', tagline: 'הכושר שלך, הקצב שלך' },
  general: { emoji: '📅', accent: '#4f46e5', accentDark: '#3730a3', tagline: 'קובעים תור בהודעה אחת' },
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderIndex(tenant, v) {
  const services = tenant.services.map((s) => `
      <div class="service-card">
        <div>
          <div class="name">${esc(s.name)}</div>
          <div class="dur">כ-${s.durationMinutes} דק'</div>
        </div>
        <div class="price">${s.price != null ? esc(typeof s.price === 'number' ? s.price + ' ₪' : s.price) : ''}</div>
      </div>`).join('');

  const hours = DAY_KEYS.map((k, i) => {
    const ranges = (tenant.hours && tenant.hours[k]) || [];
    const label = ranges.length
      ? `<td>${ranges.map((r) => `${r[0]}–${r[1]}`).join(', ')}</td>`
      : '<td class="closed">סגור</td>';
    return `        <tr data-day="${i}"><td>יום ${DAY_NAMES[i]}</td>${label}</tr>`;
  }).join('\n');

  const faq = (tenant.faq || []).map((f) => `
      <details>
        <summary>${esc(f.q)}</summary>
        <div class="answer">${esc(f.answer)}</div>
      </details>`).join('');

  const info = tenant.extraInfo || {};
  const contactRows = [
    info.address ? `<div>📍 ${esc(info.address)}</div>` : '',
    info.phone ? `<div>📞 ${esc(info.phone)}</div>` : '',
    info.paymentMethods ? `<div>💳 ${esc(info.paymentMethods)}</div>` : '',
    info.insurance ? `<div>🏥 ${esc(info.insurance)}</div>` : '',
    info.cancellationPolicy ? `<div>ℹ️ ${esc(info.cancellationPolicy)}</div>` : '',
  ].filter(Boolean).join('\n        ');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(tenant.businessName)}</title>
  <meta name="description" content="${esc(tenant.businessName)} — קביעת תורים מהירה בוואטסאפ">
  <link rel="stylesheet" href="site.css">
  <style>:root { --accent: ${v.accent}; --accent-dark: ${v.accentDark}; --accent-soft: color-mix(in srgb, ${v.accent} 12%, white); }</style>
</head>
<body>
  <header class="hero">
    <div class="container">
      <span class="emoji">${v.emoji}</span>
      <h1>${esc(tenant.businessName)}</h1>
      <p>${esc(v.tagline)} — עונים לך בוואטסאפ תוך שניות, גם עכשיו.</p>
      <button class="cta" data-open-chat>💬 דברו איתנו בוואטסאפ</button>
    </div>
  </header>

  <main class="container">
    <section id="services">
      <h2>${v.emoji} השירותים שלנו</h2>
      <div class="services">${services}
      </div>
      ${tenant.priceDisclaimer ? `<div class="disclaimer">ℹ️ ${esc(tenant.priceDisclaimer)}</div>` : ''}
    </section>

    <section id="hours">
      <h2>🕘 שעות פעילות</h2>
      <table class="hours-table">
${hours}
      </table>
    </section>

    <section id="faq">
      <h2>❓ שאלות נפוצות</h2>
      <div class="faq">${faq}
      </div>
    </section>

    <section id="contact">
      <h2>📍 יצירת קשר והגעה</h2>
      <div class="contact-card">
        ${contactRows}
      </div>
    </section>
  </main>

  <footer>
    עמוד דמו · ${esc(tenant.businessName)} · נבנה עם שיבוץ — סוכן WhatsApp בעברית
  </footer>

  <button class="chat-fab" data-open-chat aria-label="פתיחת צ'אט">
    💬<span class="hint">יש שאלה? דברו איתנו 👋</span>
  </button>

  <div class="chat-overlay" id="chat-overlay">
    <div class="chat-frame-wrap">
      <button class="chat-close" id="chat-close" aria-label="סגירה">✕</button>
      <iframe title="צ'אט ${esc(tenant.businessName)}" data-src="chat.html?embedded=1"></iframe>
    </div>
  </div>

  <script>
    (function () {
      var overlay = document.getElementById('chat-overlay');
      var frame = overlay.querySelector('iframe');
      document.querySelectorAll('[data-open-chat]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!frame.src) frame.src = frame.dataset.src; // טעינה עצלה — שיחה חדשה מבודדת
          overlay.classList.add('open');
        });
      });
      document.getElementById('chat-close').addEventListener('click', function () {
        overlay.classList.remove('open');
      });
      // הדגשת היום הנוכחי בטבלת השעות
      var row = document.querySelector('tr[data-day="' + new Date().getDay() + '"]');
      if (row) row.classList.add('today');
    })();
  </script>
</body>
</html>
`;
}

function buildSite(slug) {
  const tenantFile = path.join(ROOT, 'tenants', `${slug}.json`);
  if (!fs.existsSync(tenantFile)) {
    throw new Error(`לא נמצא קובץ טננט: tenants/${slug}.json`);
  }
  const tenant = JSON.parse(fs.readFileSync(tenantFile, 'utf8'));
  const v = VERTICALS[tenant.vertical] || VERTICALS.general;

  const outDir = path.join(ROOT, 'demo', 'sites', slug);
  fs.mkdirSync(outDir, { recursive: true });

  // עמוד העסק — מיוצר מהטננט
  fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(tenant, v), 'utf8');

  // נגן הצ'אט — תבנית עם השלמת מיתוג
  const chatHtml = fs.readFileSync(path.join(ASSETS, 'chat.html'), 'utf8')
    .replace(/{{BUSINESS_NAME}}/g, esc(tenant.businessName))
    .replace(/{{ACCENT}}/g, v.accent)
    .replace(/{{ACCENT_DARK}}/g, v.accentDark);
  fs.writeFileSync(path.join(outDir, 'chat.html'), chatHtml, 'utf8');

  // נכסים סטטיים + הסוכן עצמו + הטננט
  fs.copyFileSync(path.join(ASSETS, 'chat.css'), path.join(outDir, 'chat.css'));
  fs.copyFileSync(path.join(ASSETS, 'chat.js'), path.join(outDir, 'chat.js'));
  fs.copyFileSync(path.join(ASSETS, 'site.css'), path.join(outDir, 'site.css'));
  fs.copyFileSync(path.join(ROOT, 'src', 'core', 'agent.js'), path.join(outDir, 'agent.js'));
  fs.copyFileSync(tenantFile, path.join(outDir, 'tenant.json'));

  return outDir;
}

module.exports = buildSite;

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('שימוש: node src/demo/build-site.js <slug>');
    process.exit(1);
  }
  const out = buildSite(slug);
  console.log(`✅ אתר הדמו נבנה: ${path.relative(ROOT, out)}/`);
}
