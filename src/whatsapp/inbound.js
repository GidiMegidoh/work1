/**
 * פענוח webhook נכנס של Cloud API לאירועים שהסוכן יודע לצרוך.
 *
 * מבנה המטען: entry[].changes[].value.messages[] (הודעות) או .statuses[]
 * (אישורי מסירה — נספרים ומתעלמים). נתמכים: טקסט חופשי, לחיצה על כפתור
 * (interactive.button_reply) ובחירה מרשימה (interactive.list_reply) —
 * שלושת הצורות שהסוכן מייצר בפועל.
 */

'use strict';

function asArray(v) { return Array.isArray(v) ? v : []; }

/** הודעה בודדת → אירוע אחיד, או null אם זה סוג שאיננו מטפלים בו. */
function parseMessage(msg, value) {
  const base = {
    waId: msg.from,
    messageId: msg.id,
    timestamp: msg.timestamp || null,
    phoneNumberId: (value.metadata && value.metadata.phone_number_id) || null,
    profileName: (asArray(value.contacts)[0] || {}).profile
      ? asArray(value.contacts)[0].profile.name : null,
  };

  if (msg.type === 'text' && msg.text) {
    return Object.assign(base, { kind: 'text', text: msg.text.body || '' });
  }
  if (msg.type === 'interactive' && msg.interactive) {
    const i = msg.interactive;
    const pick = i.button_reply || i.list_reply;
    if (pick) {
      return Object.assign(base, {
        kind: 'button',
        buttonId: pick.id,
        buttonTitle: pick.title || null,
        text: pick.title || '',
      });
    }
  }
  // כפתור מתבנית (type: 'button') — מגיע כטקסט הכפתור
  if (msg.type === 'button' && msg.button) {
    return Object.assign(base, { kind: 'text', text: msg.button.text || '' });
  }
  return Object.assign(base, { kind: 'unsupported', messageType: msg.type || 'unknown' });
}

/**
 * body — האובייקט שכבר פוענח מ-JSON.
 * מחזיר { events, statusCount, ignored } ולעולם לא זורק על מבנה לא צפוי:
 * webhook שנופל גורם ל-Meta לשלוח שוב ושוב.
 */
function parseWebhook(body) {
  const events = [];
  let statusCount = 0;
  let ignored = 0;

  if (!body || typeof body !== 'object') return { events, statusCount, ignored: 1 };

  // כל רמה מוגנת בנפרד: אלמנט פגום אחד לא יפיל את הבקשה ולא יבלע את שאר
  // ההודעות באותה חבילה — Meta שולחת כמה הודעות ב-entry אחד.
  asArray(body.entry).forEach((entry) => {
    asArray(entry && entry.changes).forEach((change) => {
      const value = (change && change.value) || {};
      statusCount += asArray(value.statuses).length;
      asArray(value.messages).forEach((msg) => {
        if (!msg || typeof msg !== 'object' || !msg.from) { ignored += 1; return; }
        try {
          const ev = parseMessage(msg, value);
          if (ev.kind === 'unsupported') ignored += 1;
          events.push(ev);
        } catch (err) {
          ignored += 1;
        }
      });
    });
  });

  return { events, statusCount, ignored };
}

module.exports = { parseWebhook, parseMessage };
