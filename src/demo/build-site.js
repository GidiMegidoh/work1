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
  dental: { emoji: '🦷', accent: '#2f8fbe', accentDark: '#1d5f80', tagline: 'חיוך בריא מתחיל בתור אחד פשוט', kicker: 'מרפאת שיניים' },
  medical: { emoji: '🩺', accent: '#3f9678', accentDark: '#276451', tagline: 'רפואה אישית, קרובה וזמינה', kicker: 'מרפאה' },
  aesthetics: { emoji: '✨', accent: '#b0629c', accentDark: '#7c3f6d', tagline: 'הגרסה הזוהרת ביותר שלך', kicker: 'קליניקת אסתטיקה' },
  legal: { emoji: '⚖️', accent: '#a3763a', accentDark: '#6f4e22', tagline: 'ליווי משפטי שאפשר לסמוך עליו', kicker: 'משרד עורכי דין' },
  fitness: { emoji: '💪', accent: '#c26a3d', accentDark: '#8a4526', tagline: 'הכושר שלך, הקצב שלך', kicker: 'סטודיו כושר' },
  general: { emoji: '📅', accent: '#996b2f', accentDark: '#6e4a1c', tagline: 'קובעים תור בהודעה אחת, בוואטסאפ', kicker: 'קביעת תורים בוואטסאפ' },
};

/* אייקוני SVG קטנים במקום אימוג'י — קו אחיד, צבע מהקונטקסט */
const ICONS = {
  wa: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3Z"/><path d="M8.8 9.2c.3 2.7 3.2 5.6 5.9 5.9l1.5-1.5-2.1-1.2-1 .7c-.8-.4-1.5-1.1-1.9-1.9l.7-1-1.2-2.1-1.9 1.1Z"/></svg>',
  clock: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  pin: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-5.4-6.5-10a6.5 6.5 0 0 1 13 0c0 4.6-6.5 10-6.5 10Z"/><circle cx="12" cy="10.6" r="2.3"/></svg>',
  phone: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5C5 3.7 5.7 3 6.5 3h2L10 7l-1.7 1.7a12.5 12.5 0 0 0 7 7L17 14l4 1.5v2c0 .8-.7 1.5-1.5 1.5C10.6 19 5 13.4 5 4.5Z"/></svg>',
  card: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18"/></svg>',
  info: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.8v.4"/></svg>',
  chevron: '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
};

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPrice(price) {
  if (price == null) return '';
  if (typeof price !== 'number') return `<div class="price">${esc(price)}</div>`;
  if (price === 0) return '<div class="price free">ללא עלות</div>';
  return `<div class="price">${price}<span class="cur">₪</span></div>`;
}

function renderIndex(tenant, v) {
  const services = tenant.services.map((s) => `
      <div class="service-card">
        <div class="name">${esc(s.name)}</div>
        <span class="dur">${ICONS.clock} כ-${s.durationMinutes} דק'</span>
        ${renderPrice(s.price)}
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
        <summary>${esc(f.q)} ${ICONS.chevron}</summary>
        <div class="answer">${esc(f.answer)}</div>
      </details>`).join('');

  const info = tenant.extraInfo || {};
  const contactRows = [
    info.address ? `<div>${ICONS.pin} <span>${esc(info.address)}</span></div>` : '',
    info.phone ? `<div>${ICONS.phone} <span>${esc(info.phone)}</span></div>` : '',
    info.paymentMethods ? `<div>${ICONS.card} <span>${esc(info.paymentMethods)}</span></div>` : '',
    info.insurance ? `<div>${ICONS.info} <span>${esc(info.insurance)}</span></div>` : '',
    info.cancellationPolicy ? `<div>${ICONS.info} <span>${esc(info.cancellationPolicy)}</span></div>` : '',
  ].filter(Boolean).join('\n        ');

  // הדגמת שיחה בהירו — נבנית מהשירות הראשון של העסק, כך שכל עמוד מרגיש תפור
  const firstService = tenant.services[0] ? tenant.services[0].name : 'תור';
  const initial = tenant.businessName.trim().charAt(0);
  const chatMock = `
      <div class="chat-mock" aria-hidden="true">
        <div class="cm-head">
          <span class="cm-avatar">${esc(initial)}</span>
          <div>
            <strong>${esc(tenant.businessName)}</strong>
            <span class="cm-status">מקוון עכשיו</span>
          </div>
        </div>
        <div class="cm-body">
          <div class="cm-msg out">היי, אפשר לקבוע תור ל${esc(firstService)}?</div>
          <div class="cm-msg in">בשמחה! נשארו השבוע: חמישי 10:00 או ראשון 14:30 — מה נוח לך?</div>
          <div class="cm-msg out">חמישי 10:00</div>
          <div class="cm-msg in">נקבע ✓ שריינתי לך את המועד. תזכורת תגיע יום לפני.</div>
        </div>
      </div>`;

  const tagline = esc(tenant.tagline || v.tagline);
  const favicon = `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${v.accentDark}"/><text x="32" y="43" font-size="34" font-family="serif" font-weight="700" fill="#fff" text-anchor="middle">${initial}</text></svg>`
  )}`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(tenant.businessName)}</title>
  <meta name="description" content="${esc(tenant.businessName)} — ${tagline}">
  <meta name="theme-color" content="#1d1a14">
  <link rel="icon" href="${favicon}">
  <link rel="stylesheet" href="site.css">
  <style>:root { --accent: ${v.accent}; --accent-dark: ${v.accentDark}; --accent-soft: color-mix(in srgb, ${v.accent} 12%, white); }</style>
</head>
<body>
  <header class="hero">
    <div class="container">
      <div>
        <span class="eyebrow">${esc(v.kicker)}</span>
        <h1>${esc(tenant.businessName)}</h1>
        <p class="lede">${tagline}</p>
        <div class="cta-row">
          <button class="cta" data-open-chat>${ICONS.wa} דברו איתנו בוואטסאפ</button>
          <a class="cta-ghost" href="#services">לשירותים ולמחירים</a>
        </div>
      </div>${chatMock}
    </div>
  </header>

  <main class="container">
    <section id="services">
      <div class="sec-head">
        <span class="eyebrow">מה אנחנו מציעים</span>
        <h2>שירותים ומחירים</h2>
      </div>
      <div class="services">${services}
      </div>
      ${tenant.priceDisclaimer ? `<div class="disclaimer">${esc(tenant.priceDisclaimer)}</div>` : ''}
    </section>

    <section id="hours">
      <div class="sec-head">
        <span class="eyebrow">מתי אנחנו כאן</span>
        <h2>שעות פעילות</h2>
      </div>
      <div class="hours-card">
      <table class="hours-table">
${hours}
      </table>
      </div>
    </section>

    <section id="faq">
      <div class="sec-head">
        <span class="eyebrow">לפני שמתקשרים</span>
        <h2>שאלות נפוצות</h2>
      </div>
      <div class="faq">${faq}
      </div>
    </section>

    <section id="contact">
      <div class="sec-head">
        <span class="eyebrow">מוצאים אותנו</span>
        <h2>יצירת קשר והגעה</h2>
      </div>
      <div class="contact-card">
        ${contactRows}
      </div>
    </section>
  </main>

  <footer>
    ${esc(tenant.businessName)} · המענה בוואטסאפ פועל 24/7 ·
    <span class="brand">Veltrum</span> — סוכני WhatsApp לעסקים
  </footer>

  <button class="chat-fab" data-open-chat aria-label="פתיחת צ'אט">
    ${ICONS.wa} וואטסאפ<span class="hint">יש שאלה? עונים תוך שניות</span>
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
