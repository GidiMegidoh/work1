/**
 * שמירת מצב לכל טננט כקובץ JSON יחיד ב-data/ — כתיבה אטומית (tmp+rename)
 * כך שריסטרט באמצע כתיבה לא משאיר קובץ חצי-כתוב.
 *
 * המבנה: { agentState: <exportState של הסוכן>, gcalEventIds: {bookingId: eventId},
 *          seenMessageIds: [..] }
 */

'use strict';

const fs = require('fs');
const path = require('path');

function stateFile(dir, tenantId) {
  // ה-id מגיע מתוכן קובץ הטננט — מסננים לפני שהוא הופך לשם קובץ
  const safe = String(tenantId).replace(/[^a-z0-9-]/gi, '_');
  return path.join(dir, `state-${safe}.json`);
}

function loadState(dir, tenantId) {
  const file = stateFile(dir, tenantId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    // קובץ פגום לא מפיל את השרת — מתחילים ממצב נקי ושומרים את הפגום בצד
    const backup = file + '.corrupt-' + Date.now();
    fs.renameSync(file, backup);
    return null;
  }
}

function saveState(dir, tenantId, state) {
  fs.mkdirSync(dir, { recursive: true });
  const file = stateFile(dir, tenantId);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1), 'utf8');
  fs.renameSync(tmp, file);
}

module.exports = { loadState, saveState, stateFile };
