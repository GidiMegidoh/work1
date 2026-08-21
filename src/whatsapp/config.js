/**
 * קונפיגורציית WhatsApp Cloud API.
 *
 * שני מקורות, בכוונה נפרדים:
 *   1. קובץ `whatsapp.config.json` בשורש הריפו — ערכים שאינם סודות
 *      (מארח ה-Graph API, גרסה, phoneNumberId, שם הטננט, שמות התבניות).
 *   2. משתני סביבה — הסודות בלבד: WA_TOKEN, WA_VERIFY_TOKEN, WA_APP_SECRET.
 *
 * מארח ה-Graph API מגיע מהקונפיג ולעולם לא מקודד כאן: `test/network-guard.js`
 * סורק את src/ ו-demo/ ומפיל את הבדיקות אם המארח מופיע בקוד. זה גם מה שמבטיח
 * שהדמו נשאר חסר-רשת — בלי קובץ קונפיג ובלי סודות אין בכלל אפשרות לצאת החוצה.
 *
 * ראו `whatsapp.config.example.json` ואת GO-LIVE-DEMO.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_CONFIG_FILE = path.join(ROOT, 'whatsapp.config.json');

const DEFAULTS = {
  graphHost: null,
  graphVersion: 'v21.0',
  phoneNumberId: null,
  tenantSlug: 'demo-dental',
  templateLanguage: 'he',
  templates: { leadAlert: 'lead_alert', followup: 'followup_he' },
};

function readConfigFile(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`קובץ הקונפיג ${path.relative(ROOT, file)} אינו JSON תקין: ${err.message}`);
  }
}

/**
 * opts.overrides גובר על הכול — משמש בבדיקות כדי לא להיות תלוי בסביבה.
 * mode: 'sim' (ברירת מחדל, אפס רשת) או 'live'.
 */
function loadConfig(opts) {
  opts = opts || {};
  const file = opts.file || process.env.WA_CONFIG || DEFAULT_CONFIG_FILE;
  const fromFile = readConfigFile(file);

  const cfg = Object.assign({}, DEFAULTS, fromFile, opts.overrides || {});
  cfg.templates = Object.assign({}, DEFAULTS.templates, fromFile.templates, (opts.overrides || {}).templates);

  // סודות — מהסביבה בלבד, אף פעם לא מהקובץ שנשמר בגיט
  cfg.token = opts.token || process.env.WA_TOKEN || null;
  cfg.verifyToken = opts.verifyToken || process.env.WA_VERIFY_TOKEN || null;
  cfg.appSecret = opts.appSecret || process.env.WA_APP_SECRET || null;

  cfg.mode = opts.mode || process.env.WA_MODE || 'sim';
  // דילוג על אימות חתימה דורש הסכמה מפורשת, ולעולם לא ב-live
  cfg.allowUnsigned = opts.allowUnsigned != null
    ? opts.allowUnsigned
    : process.env.WA_ALLOW_UNSIGNED === '1';
  cfg.requestTimeoutMs = cfg.requestTimeoutMs || 15000;
  cfg.configFile = file;
  cfg.configFileExists = fs.existsSync(file);
  return cfg;
}

/** מה חסר כדי לרוץ מול המספר החי. רשימה ריקה = מוכן. */
function missingForLive(cfg) {
  const missing = [];
  if (!cfg.graphHost) missing.push('graphHost (whatsapp.config.json)');
  if (!cfg.phoneNumberId) missing.push('phoneNumberId (whatsapp.config.json)');
  if (!cfg.token) missing.push('WA_TOKEN (משתנה סביבה)');
  if (!cfg.verifyToken) missing.push('WA_VERIFY_TOKEN (משתנה סביבה)');
  if (!cfg.appSecret) missing.push('WA_APP_SECRET (משתנה סביבה)');
  return missing;
}

/** כתובת היעד לשליחה — מורכבת מהקונפיג, לא ממחרוזת קבועה בקוד. */
function messagesUrl(cfg) {
  if (!cfg.graphHost) throw new Error('אין graphHost בקונפיג — ראו whatsapp.config.example.json');
  if (!cfg.phoneNumberId) throw new Error('אין phoneNumberId בקונפיג — מעתיקים אותו מ-WhatsApp Manager');
  return 'https://' + cfg.graphHost + '/' + cfg.graphVersion + '/' + cfg.phoneNumberId + '/messages';
}

function loadTenant(slug) {
  const file = path.join(ROOT, 'tenants', `${slug}.json`);
  if (!fs.existsSync(file)) throw new Error(`לא נמצא קובץ טננט: tenants/${slug}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { loadConfig, missingForLive, messagesUrl, loadTenant, DEFAULTS, ROOT };
