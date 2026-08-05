/**
 * Google Calendar ללא תלויות: הזדהות service-account (JWT RS256 דרך node:crypto),
 * freeBusy, ויצירה/עדכון/מחיקה של אירועים דרך REST.
 *
 * זמנים: הליבה עובדת ב-ISO מקומי נאיבי (YYYY-MM-DDTHH:mm) באזור הזמן של
 * הטננט. כתיבה נשלחת כ-dateTime מקומי + שדה timeZone (בלי חישובי אופסט);
 * טווחי busy חוזרים כ-RFC3339 ומומרים ל-epoch-ms עם Date.parse — לכן השרת
 * אוכף ש-TZ של התהליך שווה ל-timezone של הטננט לפני שהוא מפעיל טננט google.
 *
 * fetchImpl ניתן להזרקה — הבדיקות מריצות את כל המודול בלי רשת.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';

/** קורא service account מ-GOOGLE_SERVICE_ACCOUNT_JSON (תוכן) או _FILE (נתיב). */
function loadServiceAccount(env) {
  const inline = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const file = env.GOOGLE_SERVICE_ACCOUNT_FILE;
  let raw = null;
  if (inline && inline.trim()) raw = inline;
  else if (file && file.trim()) raw = fs.readFileSync(file, 'utf8');
  if (!raw) return null;
  const sa = JSON.parse(raw);
  if (!sa.client_email || !sa.private_key) {
    throw new Error('service account חסר client_email או private_key');
  }
  return sa;
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(serviceAccount, nowMs) {
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: serviceAccount.token_uri || TOKEN_URL,
    iat,
    exp: iat + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claims);
  const signature = signer.sign(serviceAccount.private_key).toString('base64url');
  return header + '.' + claims + '.' + signature;
}

function createCalendarClient(opts) {
  const sa = opts.serviceAccount;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const nowFn = opts.nowFn || Date.now;
  if (!sa) throw new Error('createCalendarClient: חסר serviceAccount');

  let cachedToken = null; // { accessToken, expiresAtMs }

  async function getToken() {
    if (cachedToken && cachedToken.expiresAtMs - 60000 > nowFn()) {
      return cachedToken.accessToken;
    }
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signJwt(sa, nowFn()),
    }).toString();
    const res = await fetchImpl(sa.token_uri || TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = await res.json();
    if (!res.ok || !json.access_token) {
      throw new Error('Google token: ' + res.status + ' ' + JSON.stringify(json).slice(0, 300));
    }
    cachedToken = {
      accessToken: json.access_token,
      expiresAtMs: nowFn() + (json.expires_in || 3600) * 1000,
    };
    return cachedToken.accessToken;
  }

  async function api(method, path, payload) {
    const token = await getToken();
    const res = await fetchImpl(CAL_BASE + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: payload == null ? undefined : JSON.stringify(payload),
    });
    if (res.status === 204) return { ok: true };
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const err = new Error('Google Calendar ' + method + ' ' + path + ': ' +
        res.status + ' ' + text.slice(0, 300));
      err.status = res.status;
      throw err;
    }
    return json;
  }

  /**
   * טווחים תפוסים מאוחדים מכל היומנים. מחזיר גם רשימת יומנים שלא נגישים —
   * יומן לא משותף לא נכשל בשקט (אחרת הסוכן יציע מועדים תפוסים).
   */
  async function freeBusy(calendarIds, timeMinRfc, timeMaxRfc, timeZone) {
    const json = await api('POST', '/freeBusy', {
      timeMin: timeMinRfc,
      timeMax: timeMaxRfc,
      timeZone,
      items: calendarIds.map((id) => ({ id })),
    });
    const busy = [];
    const inaccessible = [];
    for (const id of calendarIds) {
      const cal = (json.calendars || {})[id];
      if (!cal) { inaccessible.push({ id, error: 'לא הוחזר בתשובה' }); continue; }
      if (cal.errors && cal.errors.length) {
        inaccessible.push({ id, error: cal.errors.map((e) => e.reason).join(',') });
        continue;
      }
      for (const b of cal.busy || []) {
        busy.push({ startMs: Date.parse(b.start), endMs: Date.parse(b.end) });
      }
    }
    busy.sort((a, b) => a.startMs - b.startMs);
    return { busy, inaccessible };
  }

  function eventTimes(slotIso, durationMinutes, timeZone) {
    const [d, hm] = slotIso.split('T');
    const start = `${d}T${hm}:00`;
    // סיום שמגיע לחצות (עסק שסוגר ב-24:00) מתגלגל ליום הבא — לא זורקים
    const [y, mo, day] = d.split('-').map(Number);
    const [h, m] = hm.split(':').map(Number);
    const endDate = new Date(y, mo - 1, day, h, m + durationMinutes);
    const end = endDate.getFullYear() + '-' +
      String(endDate.getMonth() + 1).padStart(2, '0') + '-' +
      String(endDate.getDate()).padStart(2, '0') + 'T' +
      String(endDate.getHours()).padStart(2, '0') + ':' +
      String(endDate.getMinutes()).padStart(2, '0') + ':00';
    return {
      start: { dateTime: start, timeZone },
      end: { dateTime: end, timeZone },
    };
  }

  /** יוצר אירוע ביומן. privateProps נשמרים כ-extendedProperties.private לשחזור עתידי. */
  async function createEvent(calendarId, ev) {
    const times = eventTimes(ev.slotIso, ev.durationMinutes, ev.timeZone);
    const json = await api('POST', `/calendars/${encodeURIComponent(calendarId)}/events`, {
      summary: ev.summary,
      description: ev.description || '',
      start: times.start,
      end: times.end,
      extendedProperties: ev.privateProps ? { private: ev.privateProps } : undefined,
    });
    return json.id;
  }

  async function patchEventTime(calendarId, eventId, slotIso, durationMinutes, timeZone) {
    const times = eventTimes(slotIso, durationMinutes, timeZone);
    await api('PATCH',
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { start: times.start, end: times.end });
  }

  async function deleteEvent(calendarId, eventId) {
    try {
      await api('DELETE',
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
    } catch (err) {
      // כבר נמחק ידנית ביומן — לא כישלון
      if (err.status !== 404 && err.status !== 410) throw err;
    }
  }

  /**
   * "בדיקת יומן": קריאת freeBusy על כל היומנים + כתיבת אירוע בדיקה ומחיקתו.
   * זו הבדיקה שמריצים מול הלקוח בשיחת ההטמעה (סעיף 4 ב-SKILL).
   */
  async function calendarCheck(calendarId, additionalBusyCalendars, timeZone) {
    const report = {
      serviceAccount: sa.client_email,
      calendarId,
      readOk: false,
      writeOk: false,
      additional: [],
      errors: [],
    };
    const nowIso = new Date(nowFn()).toISOString();
    const maxIso = new Date(nowFn() + 7 * 86400000).toISOString();
    try {
      const fb = await freeBusy([calendarId, ...(additionalBusyCalendars || [])], nowIso, maxIso, timeZone);
      const mainBad = fb.inaccessible.find((c) => c.id === calendarId);
      report.readOk = !mainBad;
      if (mainBad) report.errors.push(`היומן הראשי לא נגיש (${mainBad.error}) — לשתף עם ${sa.client_email} בהרשאת "Make changes to events"`);
      report.additional = (additionalBusyCalendars || []).map((id) => {
        const bad = fb.inaccessible.find((c) => c.id === id);
        return { id, ok: !bad, error: bad ? bad.error : null };
      });
    } catch (err) {
      report.errors.push('freeBusy נכשל: ' + err.message);
      return report;
    }
    try {
      const probeStart = new Date(nowFn() + 3 * 86400000);
      const slotIso = probeStart.toISOString().slice(0, 10) + 'T07:00';
      const eventId = await createEvent(calendarId, {
        summary: 'בדיקת יומן — Shibutz (יימחק אוטומטית)',
        slotIso,
        durationMinutes: 15,
        timeZone,
        privateProps: { shibutzProbe: '1' },
      });
      await deleteEvent(calendarId, eventId);
      report.writeOk = true;
    } catch (err) {
      report.errors.push('כתיבת אירוע נכשלה: ' + err.message +
        ` — לוודא שיתוף בהרשאת "Make changes to events" עם ${sa.client_email}`);
    }
    return report;
  }

  return { getToken, freeBusy, createEvent, patchEventTime, deleteEvent, calendarCheck };
}

module.exports = { loadServiceAccount, createCalendarClient, signJwt, TOKEN_URL, CAL_BASE };
