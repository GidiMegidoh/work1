/**
 * בונה גרסת דמו בקובץ אחד: demo/sites/<slug>/standalone.html
 *
 *   node src/demo/build-standalone.js <slug>     (או: npm run demo:standalone <slug>)
 *
 * קובץ HTML יחיד, בלי אף קריאת רשת: אתר העסק + נגן הצ'אט (בתוך iframe
 * עם srcdoc) עם הסוכן והטננט מוטמעים בפנים. אפשר לארח אותו בכל אירוח
 * סטטי, לפתוח מקובץ מקומי, או לשלוח כקובץ — והדמו המלא עובד.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const buildSite = require('./build-site');

const ROOT = path.join(__dirname, '..', '..');

/** נטרול </script בתוך תוכן שמוטמע ב-<script> (בטוח במחרוזות וב-regex). */
function safeScript(js) {
  return js.replace(/<\/script/gi, '<\\/script');
}

/** JSON שבטוח להטמעה בתוך <script>: כל '<' הופך ל-<. */
function safeJson(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

/** קידוד תוכן מסמך שלם לערך מאפיין srcdoc. */
function escAttr(html) {
  return html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/* כל ההחלפות כאן עם פונקציה, לא מחרוזת — כדי שרצפי $ בתוכן מוטמע
   (CSS/JS/JSON) לעולם לא יפורשו כתבניות החלפה של String.replace. */

function inlineStylesheet(html, href, css) {
  const linkTag = `<link rel="stylesheet" href="${href}">`;
  if (!html.includes(linkTag)) throw new Error(`לא נמצא ${linkTag} להטמעה`);
  return html.replace(linkTag, () => `<style>\n${css}\n</style>`);
}

function buildStandalone(slug) {
  // בונים קודם את האתר הרגיל — הגרסה העצמאית נגזרת ממנו אחד-לאחד
  const siteDir = buildSite(slug);
  const read = (f) => fs.readFileSync(path.join(siteDir, f), 'utf8');

  const tenant = JSON.parse(read('tenant.json'));

  // --- מסמך הצ'אט: chat.html עם הכול בפנים ---
  let chatDoc = inlineStylesheet(read('chat.html'), 'chat.css', read('chat.css'));
  for (const tag of ['<script src="agent.js"></script>', '<script src="chat.js"></script>']) {
    if (!chatDoc.includes(tag)) throw new Error(`לא נמצא ${tag} להטמעה`);
  }
  chatDoc = chatDoc.replace(
    '<script src="agent.js"></script>',
    () => `<script>\n${safeScript(read('agent.js'))}\n</script>`
  );
  chatDoc = chatDoc.replace(
    '<script src="chat.js"></script>',
    () => `<script>window.__SHIBUTZ_TENANT__ = ${safeJson(tenant)}; window.__SHIBUTZ_EMBEDDED__ = true;</script>\n` +
      `<script>\n${safeScript(read('chat.js'))}\n</script>`
  );

  // --- עמוד העסק: מטמיעים CSS ומחליפים את ה-iframe לטעינת srcdoc ---
  let page = inlineStylesheet(read('index.html'), 'site.css', read('site.css'));

  const iframeRe = /<iframe title="([^"]*)" data-src="chat\.html\?embedded=1"><\/iframe>/;
  if (!iframeRe.test(page)) throw new Error('לא נמצא ה-iframe של הצ\'אט בעמוד העסק');
  page = page.replace(iframeRe, (_, title) =>
    `<iframe title="${title}" srcdoc="${escAttr(chatDoc)}"></iframe>`);

  // ה-srcdoc נטען מראש — מבטלים את הטעינה העצלה של גרסת הקבצים
  const lazyLine = 'if (!frame.src) frame.src = frame.dataset.src; // טעינה עצלה — שיחה חדשה מבודדת';
  if (!page.includes(lazyLine)) throw new Error('לא נמצאה שורת הטעינה העצלה של הצ\'אט');
  page = page.replace(lazyLine, () => '/* בגרסה העצמאית הצ\'אט מוטמע ב-srcdoc ונטען מראש */');

  const outFile = path.join(siteDir, 'standalone.html');
  fs.writeFileSync(outFile, page, 'utf8');
  return outFile;
}

module.exports = buildStandalone;

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('שימוש: node src/demo/build-standalone.js <slug>');
    process.exit(1);
  }
  const out = buildStandalone(slug);
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`✅ דמו בקובץ אחד: ${path.relative(ROOT, out)} (${kb}KB)`);
  console.log('   אפשר לארח בכל מקום, לפתוח מקומית או לשלוח כקובץ — עובד בלי שרת ובלי רשת.');
}
