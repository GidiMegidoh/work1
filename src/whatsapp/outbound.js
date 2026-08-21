/**
 * תרגום תשובת הסוכן למטען Cloud API.
 *
 * הפער האמיתי שהמודול הזה סוגר: הסוכן מייצר עד 7 כפתורים (6 מועדים +
 * "מועדים נוספים"), ו-Cloud API מאפשר **3 כפתורים בלבד** בהודעת
 * interactive/button. לכן:
 *
 *   0 כפתורים      → text
 *   1–3 כפתורים    → interactive/button
 *   4–10 כפתורים   → interactive/list  (עד 10 שורות — מכסה 6 מועדים + "נוספים")
 *   מעל 10         → 10 הראשונים ברשימה; העודף מדווח ב-truncated ולא נבלע בשקט
 *
 * מגבלות האורך של Meta נאכפות כאן (כותרת כפתור 20, שורת רשימה 24, גוף 1024) —
 * חריגה מהן מחזירה שגיאת 400 מהשרת, לא קיצור אוטומטי.
 */

'use strict';

const LIMITS = {
  bodyText: 1024,
  textBody: 4096,
  buttonTitle: 20,
  rowTitle: 24,
  rowDescription: 72,
  listButtonLabel: 20,
  maxButtons: 3,
  maxRows: 10,
};

/** קיצור ידידותי: חותך על גבול מילה כשאפשר ומוסיף אליפסיס. */
function clamp(text, max) {
  const s = String(text == null ? '' : text).trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + '…';
}

function textMessage(to, body) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'text',
    text: { preview_url: false, body: clamp(body, LIMITS.textBody) },
  };
}

/** Meta דוחה הודעת interactive עם גוף ריק (400) — נופלים לטקסט ניטרלי. */
function nonEmpty(body) {
  const s = String(body == null ? '' : body).trim();
  return s.length ? s : '⁠—';
}

function buttonMessage(to, body, buttons) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clamp(nonEmpty(body), LIMITS.bodyText) },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: clamp(b.title, LIMITS.buttonTitle) },
        })),
      },
    },
  };
}

function listMessage(to, body, buttons, opts) {
  opts = opts || {};
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clamp(nonEmpty(body), LIMITS.bodyText) },
      action: {
        button: clamp(opts.listLabel || 'בחירה', LIMITS.listButtonLabel),
        sections: [{
          title: clamp(opts.sectionTitle || 'אפשרויות', LIMITS.rowTitle),
          rows: buttons.map((b) => ({
            id: b.id,
            title: clamp(b.title, LIMITS.rowTitle),
          })),
        }],
      },
    },
  };
}

/**
 * reply — {text, buttons:[{id,title}]} מהסוכן.
 * מחזיר { message, shape, truncated } — הודעה אחת, כי הסוכן תמיד מחזיר אחת.
 */
function replyToMessage(reply, to, opts) {
  opts = opts || {};
  const buttons = (reply && reply.buttons) || [];
  const body = (reply && reply.text) || '';

  if (!buttons.length) {
    return { message: textMessage(to, body), shape: 'text', truncated: 0 };
  }
  if (buttons.length <= LIMITS.maxButtons) {
    return { message: buttonMessage(to, body, buttons), shape: 'button', truncated: 0 };
  }
  const rows = buttons.slice(0, LIMITS.maxRows);
  const truncated = buttons.length - rows.length;
  return {
    message: listMessage(to, body, rows, opts),
    shape: 'list',
    truncated: truncated,
  };
}

/**
 * התראת צוות → הודעת תבנית.
 *
 * התראה יוצאת ביוזמת העסק אל מספר שלא בהכרח כתב לנו ב-24 השעות האחרונות,
 * ולכן היא **חייבת** להיות תבנית מאושרת ולא טקסט חופשי. התבנית `lead_alert`
 * מוגדרת עם משתנה אחד: «פנייה חדשה: {{1}}».
 */
function alertToTemplates(alert, cfg) {
  const name = (cfg.templates && cfg.templates.leadAlert) || 'lead_alert';
  const lang = cfg.templateLanguage || 'he';
  const who = alert.customerName ? `${alert.customerName} · ` : '';
  const kind = alert.type === 'handoff' ? 'בקשת נציג' : 'שאלה ללא מענה';
  const param = clamp(`${who}${kind}: ${alert.message}`, 300);

  return (alert.notifyPhones || []).map((phone) => ({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone,
    type: 'template',
    template: {
      name: name,
      language: { code: lang },
      components: [{
        type: 'body',
        parameters: [{ type: 'text', text: param }],
      }],
    },
  }));
}

module.exports = { replyToMessage, alertToTemplates, textMessage, clamp, LIMITS };
