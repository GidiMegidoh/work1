/**
 * טוען .env מינימלי (KEY=VALUE, # הערות, מרכאות אופציונליות) בלי תלות חיצונית.
 * ערכים שכבר קיימים ב-process.env גוברים — כך docker-compose והסביבה שולטים.
 */

'use strict';

const fs = require('fs');

function loadEnv(file) {
  const merged = { ...process.env };
  if (!fs.existsSync(file)) return merged;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) merged[key] = value;
  }
  return merged;
}

module.exports = { loadEnv };
