/**
 * המוח של ה-webhook: אימות, פענוח, ניתוב לסוכן ושליחת התשובה.
 *
 * שלוש נקודות שקל לפספס והן מה שמפריד בין "עובד אצלי" ל"עובד באוויר":
 *
 *  1. **אימות חתימה** — Meta חותמת כל POST ב-X-Hub-Signature-256 (HMAC-SHA256
 *     של הגוף הגולמי עם ה-App Secret). חייבים לחשב על ה-Buffer הגולמי, לפני
 *     JSON.parse, אחרת החתימה לא תתאים לעולם.
 *  2. **דה-דופליקציה** — Meta שולחת שוב כל webhook שלא קיבל 200 מהר מספיק.
 *     בלי מפתח ייחודי (wamid) הלקוח מקבל את אותה תשובה פעמיים.
 *  3. **תמיד 200** — כל שגיאה פנימית שמחזירה 5xx גורמת לניסיונות חוזרים
 *     ובסוף להשבתת ה-webhook. שגיאה נרשמת, והתשובה נשארת 200.
 *
 * מזהה השיחה בסוכן הוא ה-wa_id, ולכן כל מספר טלפון מקבל שיחה מבודדת משלו.
 */

'use strict';

const crypto = require('crypto');
const { createAgent } = require('../core/agent');
const { parseWebhook } = require('./inbound');
const { replyToMessage, alertToTemplates } = require('./outbound');
const { createMeter } = require('./meter');

const MAX_SEEN = 500;

/** השוואה בזמן קבוע — לא נותנת לתוקף לגלות את החתימה בייט-בייט. */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifySignature(rawBody, header, appSecret) {
  if (!appSecret) return { ok: false, reason: 'no-secret' };
  if (!header) return { ok: false, reason: 'missing-header' };
  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    .digest('hex');
  return safeEqual(expected, header) ? { ok: true } : { ok: false, reason: 'mismatch' };
}

function createWebhookHandler(opts) {
  const cfg = opts.config;
  const tenant = opts.tenant;
  const transport = opts.transport;
  const log = opts.logger || function () {};
  const agent = opts.agent || createAgent(tenant, opts.agentOpts || {});
  const meter = opts.meter || createMeter();

  // נספר רק אחרי transport.send שהצליח — מה שנמסר הוא מה ש-Meta מחייבת
  function metered(waId, kind, note) {
    const m = meter.record(waId, kind);
    log(`📊 ${waId} ← ${kind}${note ? ` (${note})` : ''} · מצטבר בשיחה: ${m.reply} תשובות + ${m.template} תבניות`);
  }

  const seen = new Set();
  const seenOrder = [];
  // מטענים שנוצרו אך לא נמסרו — כדי שמשלוח חוזר של Meta ישלח שוב את *אותו*
  // מטען במקום להריץ שוב את הסוכן (הרצה חוזרת הייתה מקדמת את מצב השיחה בטעות)
  const undelivered = new Map();

  function remember(id) {
    seen.add(id);
    seenOrder.push(id);
    while (seenOrder.length > MAX_SEEN) {
      const drop = seenOrder.shift();
      seen.delete(drop);
      undelivered.delete(drop);
    }
  }

  /** GET /webhook — אימות הבעלות מול Meta בהגדרת הכתובת. */
  function verify(query) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (!cfg.verifyToken) {
      return { status: 500, body: 'WA_VERIFY_TOKEN לא מוגדר בסביבה' };
    }
    if (mode === 'subscribe' && token && safeEqual(token, cfg.verifyToken)) {
      return { status: 200, body: String(challenge == null ? '' : challenge) };
    }
    return { status: 403, body: 'Forbidden' };
  }

  /** POST /webhook — rawBody הוא Buffer/מחרוזת גולמית, לפני פענוח. */
  async function receive(rawBody, headers) {
    headers = headers || {};
    const sig = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
    const check = verifySignature(rawBody, sig, cfg.appSecret);

    // ללא App Secret מוגדר אין אימות אפשרי — מותר רק ב-sim, לעולם לא באוויר
    if (!check.ok) {
      // דילוג על אימות אפשרי רק ב-sim *וגם* עם הסכמה מפורשת. בלי שתי אלה
      // שרת שנחשף לאינטרנט לפני שהוגדר WA_MODE=live היה מקבל POST לא חתום.
      if (check.reason === 'no-secret' && cfg.mode !== 'live' && cfg.allowUnsigned) {
        log('⚠️  אין WA_APP_SECRET ו-WA_ALLOW_UNSIGNED=1 — דילוג על אימות חתימה (sim בלבד)');
      } else {
        log(`🚫 חתימה נדחתה (${check.reason})`);
        return { status: 403, body: 'invalid signature', sent: [], events: [] };
      }
    }

    let body;
    try {
      body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
    } catch (err) {
      log(`🚫 גוף לא-JSON: ${err.message}`);
      return { status: 400, body: 'bad json', sent: [], events: [] };
    }

    let events = [];
    let statusCount = 0;
    try {
      const parsed = parseWebhook(body);
      events = parsed.events;
      statusCount = parsed.statusCount;
    } catch (err) {
      log(`🚫 פענוח ה-webhook נכשל: ${err.message}`);
      return { status: 200, body: 'EVENT_RECEIVED', sent: [], events: [] };
    }
    if (statusCount) log(`ℹ️  ${statusCount} עדכוני סטטוס — מתעלמים`);

    const sent = [];
    let deliveryFailed = false;
    for (const ev of events) {
      if (ev.kind === 'unsupported') {
        log(`ℹ️  סוג הודעה לא נתמך (${ev.messageType}) מ-${ev.waId} — מתעלמים`);
        continue;
      }
      // הודעה שהגיעה למספר של טננט אחר — לא לענות לה בשם העסק הזה
      if (cfg.phoneNumberId && ev.phoneNumberId && ev.phoneNumberId !== cfg.phoneNumberId) {
        log(`↪️  הודעה עבור phone_number_id אחר (${ev.phoneNumberId}) — מתעלמים`);
        continue;
      }
      if (ev.messageId && seen.has(ev.messageId)) {
        const stuck = undelivered.get(ev.messageId);
        if (stuck && stuck.length) {
          log(`🔁 ${ev.messageId} טופל אך לא נמסר — שולחים שוב את אותו מטען`);
          const still = [];
          for (const item of stuck) {
            try {
              const res = await transport.send(item.payload);
              sent.push(Object.assign({}, item, { result: res }));
              metered(ev.waId, item.purpose === 'alert' ? 'template' : 'reply', 'משלוח חוזר');
            } catch (err) {
              log(`❌ משלוח חוזר נכשל: ${err.message}`);
              still.push(item);
            }
          }
          if (still.length) { undelivered.set(ev.messageId, still); deliveryFailed = true; }
          else undelivered.delete(ev.messageId);
        } else {
          log(`🔁 ${ev.messageId} כבר טופל — דילוג (משלוח חוזר של Meta)`);
        }
        continue;
      }
      if (ev.messageId) remember(ev.messageId);
      const stash = [];

      const input = ev.kind === 'button'
        ? { text: ev.text, buttonId: ev.buttonId, buttonTitle: ev.buttonTitle }
        : ev.text;

      let reply;
      try {
        reply = agent.handleMessage(ev.waId, input);
      } catch (err) {
        log(`❌ הסוכן נכשל על ${ev.messageId}: ${err.message}`);
        continue;
      }
      if (!reply) continue;

      const mapped = replyToMessage(reply, ev.waId);
      if (mapped.truncated) {
        log(`⚠️  ${mapped.truncated} כפתורים נחתכו מעבר למגבלת 10 השורות של Meta`);
      }
      const replyItem = { purpose: 'reply', shape: mapped.shape, to: ev.waId, payload: mapped.message };
      try {
        const res = await transport.send(mapped.message);
        sent.push(Object.assign({}, replyItem, { result: res }));
        metered(ev.waId, 'reply');
      } catch (err) {
        log(`❌ שליחת תשובה נכשלה: ${err.message}`);
        stash.push(replyItem);
        deliveryFailed = true;
      }

      // התראת צוות — תבנית, כי זו הודעה ביוזמת העסק
      if (reply.alert) {
        for (const tpl of alertToTemplates(reply.alert, cfg)) {
          const alertItem = { purpose: 'alert', shape: 'template', to: tpl.to, payload: tpl };
          try {
            const res = await transport.send(tpl);
            sent.push(Object.assign({}, alertItem, { result: res }));
            metered(ev.waId, 'template', tpl.to);
          } catch (err) {
            log(`❌ שליחת התראה ל-${tpl.to} נכשלה: ${err.message}`);
            stash.push(alertItem);
            deliveryFailed = true;
          }
        }
      }
      if (stash.length && ev.messageId) undelivered.set(ev.messageId, stash);
    }

    // 200 על שגיאה פנימית זו הבחירה הנכונה — אבל לא כששום דבר לא נמסר.
    // 503 גורם ל-Meta לשלוח שוב, והמשלוח החוזר ישגר את אותו מטען שמור.
    if (deliveryFailed) {
      log('⚠️  לפחות מטען אחד לא נמסר — מחזירים 503 כדי ש-Meta תשלח שוב');
      return { status: 503, body: 'DELIVERY_FAILED', sent, events };
    }
    return { status: 200, body: 'EVENT_RECEIVED', sent, events };
  }

  return { verify, receive, agent, verifySignature, meter };
}

module.exports = { createWebhookHandler, verifySignature, safeEqual };
