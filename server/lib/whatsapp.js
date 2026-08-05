/**
 * WhatsApp Cloud API ללא תלויות: אימות חתימת webhook, פירוק הודעות נכנסות
 * לפי מבנה ה-payload המתועד של Meta, ושליחת תשובות (טקסט / כפתורים / רשימה /
 * תבנית).
 *
 * מצב dry-run: כשאין WHATSAPP_TOKEN (לפני אישור Meta) — שום קריאת רשת לא
 * יוצאת; ה-payload המדויק שהיה נשלח נרשם ללוג ומוחזר לקורא. כך כל הצנרת
 * נבדקת מקצה לקצה בלי קרדנצ'לס.
 */

'use strict';

const crypto = require('crypto');

const GRAPH_BASE = 'https://graph.facebook.com';
const DEFAULT_GRAPH_VERSION = 'v21.0';

// מגבלות מתועדות של Cloud API
const MAX_REPLY_BUTTONS = 3;      // interactive type=button
const MAX_LIST_ROWS = 10;         // interactive type=list, שורות בסקשן
const BUTTON_TITLE_MAX = 20;
const LIST_ROW_TITLE_MAX = 24;
const INTERACTIVE_BODY_MAX = 1024;

/** אימות X-Hub-Signature-256: HMAC-SHA256 של גוף הבקשה הגולמי עם ה-App Secret. */
function verifySignature(appSecret, rawBody, signatureHeader) {
  if (!appSecret || !signatureHeader || typeof signatureHeader !== 'string') return false;
  if (!signatureHeader.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const given = signatureHeader.slice('sha256='.length);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(given, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function clip(text, max) {
  const s = String(text == null ? '' : text);
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * מפרק webhook נכנס של Cloud API לרשימת הודעות שטוחות.
 * מחזיר { messages: [{phoneNumberId, from, profileName, messageId, input}] }.
 * input תואם ל-handleMessage של הסוכן: {text} או {buttonId, buttonTitle}.
 */
function parseWebhook(body) {
  const messages = [];
  if (!body || body.object !== 'whatsapp_business_account') return { messages };
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages' || !change.value) continue;
      const v = change.value;
      const phoneNumberId = v.metadata && v.metadata.phone_number_id;
      const profileName = v.contacts && v.contacts[0] && v.contacts[0].profile
        ? v.contacts[0].profile.name : null;
      for (const msg of v.messages || []) {
        const base = {
          phoneNumberId,
          from: msg.from,
          profileName,
          messageId: msg.id,
          timestamp: msg.timestamp,
        };
        if (msg.type === 'text' && msg.text) {
          messages.push({ ...base, input: { text: msg.text.body } });
        } else if (msg.type === 'interactive' && msg.interactive) {
          const ir = msg.interactive.button_reply || msg.interactive.list_reply;
          if (ir) {
            messages.push({ ...base, input: { buttonId: ir.id, buttonTitle: ir.title } });
          }
        } else if (msg.type === 'button' && msg.button) {
          // תשובת quick-reply של תבנית — מטופלת כטקסט
          messages.push({ ...base, input: { text: msg.button.text } });
        } else {
          // מדיה/מיקום/סטיקר — אין נתיב תוכן; הסוכן יסלים לפי הכללים שלו
          messages.push({ ...base, input: { text: '' }, unsupportedType: msg.type });
        }
      }
    }
  }
  return { messages };
}

function createWhatsAppSender(opts) {
  const token = opts.token || null;
  const graphVersion = opts.graphVersion || DEFAULT_GRAPH_VERSION;
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const log = opts.log || (() => {});
  const dryRun = !token;

  /** לעולם לא זורק: גם נפילת רשת (fetch reject) חוזרת כ-{error} — כך כשל
   *  שליחה לא מדלג על סנכרון יומן, התראות ושמירת מצב אצל הקורא. */
  async function post(phoneNumberId, payload) {
    const url = `${GRAPH_BASE}/${graphVersion}/${phoneNumberId}/messages`;
    if (dryRun) {
      log('DRY-RUN → ' + url + '\n' + JSON.stringify(payload, null, 2));
      return { dryRun: true, url, payload };
    }
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        log(`שגיאת שליחה ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
        return { error: true, status: res.status, body: json, url, payload };
      }
      return { ok: true, body: json, url, payload };
    } catch (err) {
      log(`שגיאת רשת בשליחה: ${err.message}`);
      return { error: true, network: true, message: err.message, url, payload };
    }
  }

  function textPayload(to, text) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: String(text).slice(0, 4096) },
    };
  }

  function interactivePayload(to, text, buttons) {
    const body = { text: clip(text, INTERACTIVE_BODY_MAX) };
    if (buttons.length <= MAX_REPLY_BUTTONS) {
      return {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body,
          action: {
            buttons: buttons.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: clip(b.title, BUTTON_TITLE_MAX) },
            })),
          },
        },
      };
    }
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body,
        action: {
          button: 'לבחירה 📋',
          sections: [{
            title: 'אפשרויות',
            rows: buttons.slice(0, MAX_LIST_ROWS).map((b) => ({
              id: b.id,
              title: clip(b.title, LIST_ROW_TITLE_MAX),
            })),
          }],
        },
      },
    };
  }

  function templatePayload(to, name, bodyParams, lang) {
    return {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name,
        language: { code: lang || 'he' },
        components: bodyParams && bodyParams.length ? [{
          type: 'body',
          // Meta דוחה פרמטרים עם שורות חדשות/טאבים/רווחים עוקבים — מנקים
          parameters: bodyParams.map((p) => ({
            type: 'text',
            text: String(p).replace(/\s+/g, ' ').trim().slice(0, 1024),
          })),
        }] : [],
      },
    };
  }

  /**
   * שולח תשובת סוכן שלמה: טקסט בלבד, או אינטראקטיב (עד 3 כפתורים / רשימה).
   * טקסט ארוך מ-1024 עם כפתורים נשלח כשתי הודעות (הטקסט המלא + בחירה).
   */
  async function sendAgentReply(phoneNumberId, to, reply) {
    const results = [];
    const buttons = reply.buttons || [];
    if (!buttons.length) {
      results.push(await post(phoneNumberId, textPayload(to, reply.text)));
    } else if (reply.text.length > INTERACTIVE_BODY_MAX) {
      results.push(await post(phoneNumberId, textPayload(to, reply.text)));
      results.push(await post(phoneNumberId, interactivePayload(to, 'לבחירה:', buttons)));
    } else {
      results.push(await post(phoneNumberId, interactivePayload(to, reply.text, buttons)));
    }
    return results;
  }

  async function sendTemplate(phoneNumberId, to, name, bodyParams, lang) {
    return post(phoneNumberId, templatePayload(to, name, bodyParams, lang));
  }

  return { dryRun, post, sendAgentReply, sendTemplate, textPayload, interactivePayload, templatePayload };
}

module.exports = {
  verifySignature,
  parseWebhook,
  createWhatsAppSender,
  GRAPH_BASE,
  DEFAULT_GRAPH_VERSION,
};
