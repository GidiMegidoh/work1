/**
 * שכבת השליחה. שני מימושים מאחורי אותו ממשק `send(payload)`:
 *
 *   sim  — ברירת המחדל. רושם את המטען שהיה נשלח ומחזיר תשובה מזויפת.
 *          אפס קריאות רשת, ולכן אפשר להוכיח את כל הזרימה בלי Meta.
 *   live — POST אמיתי אל ה-Graph API. מסרב לפעול אם חסר מארח / טוקן /
 *          phoneNumberId, כך שבלי קונפיג וסודות אין בכלל מסלול לרשת.
 */

'use strict';

const https = require('https');
const { messagesUrl, missingForLive } = require('./config');

function createSimTransport(cfg) {
  const sent = [];
  let seq = 0;
  return {
    mode: 'sim',
    sent,
    send(payload) {
      seq += 1;
      const record = { seq, to: payload.to, payload };
      sent.push(record);
      return Promise.resolve({
        simulated: true,
        messaging_product: 'whatsapp',
        contacts: [{ wa_id: payload.to }],
        messages: [{ id: `wamid.SIM-${String(seq).padStart(4, '0')}` }],
      });
    },
    reset() { sent.length = 0; seq = 0; },
  };
}

function createLiveTransport(cfg) {
  const missing = missingForLive(cfg);
  if (missing.length) {
    throw new Error('אי אפשר לעלות ל-live, חסר:\n- ' + missing.join('\n- '));
  }
  const url = messagesUrl(cfg);
  return {
    mode: 'live',
    sent: [],
    send(payload) {
      return new Promise((resolve, reject) => {
        const body = Buffer.from(JSON.stringify(payload), 'utf8');
        const req = https.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
            Authorization: 'Bearer ' + cfg.token,
          },
        }, (res) => {
          const chunks = [];
          res.on('data', (c) => { chunks.push(c); });
          res.on('end', () => {
            // Buffer.concat ולא שרשור מחרוזות — תו UTF-8 עלול להתפצל בין chunks
            const raw = Buffer.concat(chunks).toString('utf8');
            let parsed = null;
            try { parsed = JSON.parse(raw); } catch (e) { /* גוף לא-JSON — נשמר כטקסט */ }
            if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed || { raw });
            else reject(new Error(`שליחה נכשלה (HTTP ${res.statusCode}): ${raw.slice(0, 400)}`));
          });
        });
        // בלי timeout סוקט תקוע מחזיק את ה-webhook פתוח עד ש-Meta מוותרת
        req.setTimeout(cfg.requestTimeoutMs || 15000, () => {
          req.destroy(new Error(`שליחה נכשלה: timeout אחרי ${cfg.requestTimeoutMs || 15000}ms`));
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    },
  };
}

function createTransport(cfg) {
  return cfg.mode === 'live' ? createLiveTransport(cfg) : createSimTransport(cfg);
}

module.exports = { createTransport, createSimTransport, createLiveTransport };
