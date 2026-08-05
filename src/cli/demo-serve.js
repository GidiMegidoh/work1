/**
 * אולפן הדמו: בונה את אתר הטננט ומגיש אותו מקומית.
 *
 *   npm run demo <slug>          (ברירת מחדל: פורט 3000, או PORT מהסביבה)
 *
 * שרת סטטי ב-Node בלבד, בלי תלויות. הסוכן רץ בדפדפן — השרת רק מגיש קבצים,
 * ולכן כל טאב הוא שיחת דמו מבודדת.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const buildSite = require('../demo/build-site');

const slug = process.argv[2];
if (!slug) {
  console.error('שימוש: npm run demo <slug>   (למשל: npm run demo demo-dental)');
  process.exit(1);
}

let siteDir;
try {
  siteDir = buildSite(slug);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.normalize(path.join(siteDir, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(siteDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('לא נמצא');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store', // דמו — תמיד טרי
  });
  fs.createReadStream(file).pipe(res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log('═══════════════════════════════════════════');
  console.log(`  🎬 אולפן הדמו של שיבוץ — ${slug}`);
  console.log(`  אתר העסק:   http://localhost:${port}/`);
  console.log(`  נגן הצ'אט:  http://localhost:${port}/chat.html`);
  console.log('  (כל טאב בדפדפן = שיחת דמו חדשה ומבודדת)');
  console.log('═══════════════════════════════════════════');
});
