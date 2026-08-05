/**
 * ============================================================================
 *  שרת שיבוץ החי — WhatsApp Cloud API ↔ הסוכן ↔ Google Calendar
 * ============================================================================
 *
 *  ליבת הסוכן (src/core/agent.js) נשארת טהורה וסינכרונית; כל ה-I/O כאן:
 *
 *    Meta webhook ─→ אימות חתימה ─→ פירוק ─→ agent.handleMessage ─→ שליחה
 *                                        │                    │
 *                        רענון busy מ-Google לפני   reply.event → כתיבה ליומן
 *
 *  עקרונות:
 *  - בלי WHATSAPP_TOKEN אין שום קריאה יוצאת ל-Meta — מצב dry-run שרושם את
 *    ה-payload המדויק שהיה נשלח. כך בונים ובודקים לפני אישור החשבון.
 *  - POST בלי חתימת X-Hub-Signature-256 תקפה נדחה ב-403, תמיד.
 *  - מצב (שיחות, תורים, מיפוי אירועי יומן) נשמר ב-data/state-<tenant>.json
 *    אחרי כל הודעה — ריסטרט לא מאבד כלום.
 *  - SIGHUP טוען מחדש את קבצי הטננטים בלי להפיל את השרת ובלי לאבד שיחות.
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const { createAgent, validateTenant } = require('../src/core/agent');
const { loadEnv } = require('./lib/env');
const { loadServiceAccount, createCalendarClient } = require('./lib/google-calendar');
const { verifySignature, parseWebhook, createWhatsAppSender } = require('./lib/whatsapp');
const { loadState, saveState } = require('./lib/state');

const ROOT = path.join(__dirname, '..');
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const SEEN_IDS_CAP = 500;

function createApp(opts) {
  opts = opts || {};
  const env = opts.env || loadEnv(path.join(ROOT, '.env'));
  const log = opts.log || ((line) => console.log(`[${new Date().toISOString()}] ${line}`));
  const nowFn = opts.nowFn || Date.now;
  const tenantsDir = opts.tenantsDir || path.join(ROOT, 'tenants');
  const dataDir = opts.dataDir || path.join(ROOT, 'data');

  const appSecret = env.WHATSAPP_APP_SECRET || '';
  const verifyToken = env.WHATSAPP_VERIFY_TOKEN || '';
  const adminSecret = env.ADMIN_SECRET || '';

  const sender = createWhatsAppSender({
    token: env.WHATSAPP_TOKEN || null,
    graphVersion: env.GRAPH_API_VERSION || undefined,
    fetchImpl: opts.whatsappFetch,
    log,
  });

  let serviceAccount = null;
  let serviceAccountError = null;
  try {
    serviceAccount = loadServiceAccount(env);
  } catch (err) {
    serviceAccountError = err.message;
  }

  const processTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // tenantId → runtime: { tenant, agent, calendar, busyCache, gcalEventIds, seenMessageIds, queue, issues }
  const runtimes = new Map();
  // phoneNumberId-ים שמופיעים ביותר מטננט אחד — תנועה אליהם לא מנותבת בכלל
  let duplicatePhoneIds = new Set();

  function computeParts(tenant) {
    const issues = [];
    const provider = (tenant.calendar && tenant.calendar.provider) === 'google' ? 'google' : 'memory';
    let calendar = null;

    if (provider === 'google') {
      if (!serviceAccount) {
        issues.push('calendar.provider=google אבל אין service account' +
          (serviceAccountError ? ` (${serviceAccountError})` : ' (GOOGLE_SERVICE_ACCOUNT_JSON/_FILE)'));
      } else if (!tenant.calendar.calendarId) {
        issues.push('calendar.provider=google בלי calendarId');
      } else if (processTz !== tenant.timezone) {
        issues.push(`אזור הזמן של התהליך (${processTz}) שונה מ-timezone של הטננט (${tenant.timezone}) — ` +
          'מועדים היו נכתבים שגוי ליומן. יש להריץ עם TZ=' + tenant.timezone);
      } else {
        calendar = opts.calendarClient || createCalendarClient({
          serviceAccount,
          fetchImpl: opts.calendarFetch,
          nowFn,
        });
      }
    }
    return { provider, calendar, calendarActive: provider === 'google' && !!calendar, issues };
  }

  function agentOptsFor(runtime, restoreState) {
    const agentOpts = {
      now: nowFn === Date.now ? undefined : nowFn,
      restoreState,
    };
    if (runtime.calendarActive) {
      // סוגר על אובייקט ה-runtime עצמו — המטמון שרואה הסוכן תמיד העדכני
      agentOpts.getExternalBusy = () => runtime.busyCache;
    }
    return agentOpts;
  }

  // גדר עלייה לאוויר: טננט google עם בעיה לא מקבל תנועת webhook — עדיף
  // להשתיק אותו בקול רם מאשר לקבוע תורים בלי יומן (דאבל-בוקינג).
  function computeWebhookActive(runtime) {
    return !!(runtime.tenant.whatsapp && runtime.tenant.whatsapp.phoneNumberId) &&
      (runtime.provider === 'memory' || runtime.calendarActive);
  }

  function createRuntime(tenant) {
    const parts = computeParts(tenant);
    const persisted = loadState(dataDir, tenant.id);
    const runtime = {
      tenant,
      ...parts,
      busyCache: [],
      busyFetchedAt: null,
      gcalEventIds: (persisted && persisted.gcalEventIds) || {},
      seenMessageIds: (persisted && persisted.seenMessageIds) || [],
      queue: Promise.resolve(),
    };
    runtime.agent = createAgent(tenant, agentOptsFor(runtime, (persisted && persisted.agentState) || undefined));
    runtime.webhookActive = computeWebhookActive(runtime);
    return runtime;
  }

  /** החלפת קונפיגורציה של טננט רץ — משורשרת בתור ההודעות שלו, כך שהיא לעולם
   *  לא מתחרה בהודעה שבטיפול (אחרת מצב השיחה מתפצל והעדכונים אובדים). */
  function swapRuntime(runtime, tenant) {
    runtime.queue = runtime.queue.then(() => {
      const parts = computeParts(tenant);
      const state = runtime.agent.exportState();
      runtime.tenant = tenant;
      runtime.provider = parts.provider;
      runtime.calendar = parts.calendar;
      runtime.calendarActive = parts.calendarActive;
      runtime.issues = parts.issues;
      runtime.agent = createAgent(tenant, agentOptsFor(runtime, state));
      runtime.webhookActive = computeWebhookActive(runtime);
      parts.issues.forEach((i) => log(`⚠️  [${tenant.id}] ${i}`));
    }).catch((err) => {
      log(`❌ [${tenant.id}] החלפת קונפיגורציה נכשלה — הטננט ממשיך עם הקונפיגורציה הקודמת: ${err.message}`);
    });
  }

  function loadAllTenants() {
    const results = [];
    const seenIds = new Set();
    const phoneCounts = new Map();
    const files = fs.readdirSync(tenantsDir)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      .sort();
    for (const file of files) {
      const slug = file.replace(/\.json$/, '');
      try {
        const tenant = JSON.parse(fs.readFileSync(path.join(tenantsDir, file), 'utf8'));
        const check = validateTenant(tenant);
        if (check.errors.length) {
          throw new Error('קובץ טננט לא תקין: ' + check.errors.join(' | '));
        }
        seenIds.add(tenant.id);
        const pid = tenant.whatsapp && tenant.whatsapp.phoneNumberId;
        if (pid) phoneCounts.set(String(pid), (phoneCounts.get(String(pid)) || 0) + 1);
        const previous = runtimes.get(tenant.id);
        if (previous) {
          swapRuntime(previous, tenant);
          results.push({ slug, ok: true, reloaded: true });
        } else {
          const runtime = createRuntime(tenant);
          runtimes.set(tenant.id, runtime);
          results.push({ slug, ok: true, issues: runtime.issues });
          runtime.issues.forEach((i) => log(`⚠️  [${tenant.id}] ${i}`));
        }
      } catch (err) {
        // קובץ פגום: הטננט הקודם (אם יש) ממשיך לרוץ — לא מפילים שירות חי
        results.push({ slug, ok: false, error: err.message });
        log(`❌ טעינת ${file} נכשלה: ${err.message}`);
      }
    }
    // טננט שהקובץ שלו נמחק מפסיק לקבל תנועה
    for (const id of [...runtimes.keys()]) {
      if (!seenIds.has(id)) {
        runtimes.delete(id);
        log(`🗑  הטננט ${id} הוסר (הקובץ נמחק)`);
      }
    }
    duplicatePhoneIds = new Set([...phoneCounts.entries()]
      .filter(([, n]) => n > 1).map(([pid]) => pid));
    for (const pid of duplicatePhoneIds) {
      log(`❌ phoneNumberId ${pid} מופיע ביותר מטננט אחד — תנועה אליו לא תנותב עד שזה יתוקן`);
    }
    return results;
  }

  function persist(runtime) {
    saveState(dataDir, runtime.tenant.id, {
      agentState: runtime.agent.exportState(),
      gcalEventIds: runtime.gcalEventIds,
      seenMessageIds: runtime.seenMessageIds.slice(-SEEN_IDS_CAP),
      savedAt: new Date(nowFn()).toISOString(),
    });
  }

  function findByPhoneNumberId(phoneNumberId) {
    if (duplicatePhoneIds.has(String(phoneNumberId))) {
      log(`❌ הודעה ל-phone_number_id כפול ${phoneNumberId} — לא מנותבת`);
      return null;
    }
    for (const runtime of runtimes.values()) {
      if (runtime.tenant.whatsapp &&
          String(runtime.tenant.whatsapp.phoneNumberId) === String(phoneNumberId)) {
        return runtime;
      }
    }
    return null;
  }

  function findBySlug(slug) {
    for (const runtime of runtimes.values()) {
      if (runtime.tenant.id === slug) return runtime;
    }
    return null;
  }

  async function refreshBusy(runtime) {
    if (!runtime.calendarActive) return;
    const t = runtime.tenant;
    const horizonDays = (t.booking && t.booking.horizonDays) != null ? t.booking.horizonDays : 14;
    const ids = [t.calendar.calendarId, ...(t.calendar.additionalBusyCalendars || [])];
    try {
      const fb = await runtime.calendar.freeBusy(
        ids,
        new Date(nowFn()).toISOString(),
        new Date(nowFn() + (horizonDays + 2) * 86400000).toISOString(),
        t.timezone
      );
      runtime.busyCache = fb.busy;
      runtime.busyFetchedAt = nowFn();
      if (fb.inaccessible.length) {
        log(`⚠️  [${t.id}] יומנים לא נגישים: ${fb.inaccessible.map((c) => c.id).join(', ')}`);
      }
    } catch (err) {
      // ממשיכים עם המטמון הקיים — אבל בקול: מטמון מיושן = סיכון דאבל-בוקינג
      log(`⚠️  [${t.id}] רענון busy נכשל, ממשיכים עם מטמון קיים: ${err.message}`);
    }
  }

  async function syncCalendar(runtime, event) {
    if (!runtime.calendarActive || !event) return;
    const t = runtime.tenant;
    const calendarId = t.calendar.calendarId;
    try {
      if (event.type === 'booking_created') {
        const eventId = await runtime.calendar.createEvent(calendarId, {
          summary: `${event.serviceName} — ${event.customerName}`,
          description: `נקבע דרך שיבוץ · אסמכתא ${event.bookingId} · לקוח ${event.sessionId}`,
          slotIso: event.slotIso,
          durationMinutes: event.durationMinutes,
          timeZone: t.timezone,
          privateProps: {
            shibutzBookingId: event.bookingId,
            shibutzTenant: t.id,
            shibutzSession: event.sessionId,
          },
        });
        runtime.gcalEventIds[event.bookingId] = eventId;
      } else if (event.type === 'booking_rescheduled') {
        const eventId = runtime.gcalEventIds[event.bookingId];
        if (eventId) {
          await runtime.calendar.patchEventTime(calendarId, eventId,
            event.slotIso, event.durationMinutes, t.timezone);
        } else {
          await syncCalendar(runtime, { ...event, type: 'booking_created' });
        }
      } else if (event.type === 'booking_cancelled') {
        const eventId = runtime.gcalEventIds[event.bookingId];
        if (eventId) {
          await runtime.calendar.deleteEvent(calendarId, eventId);
          delete runtime.gcalEventIds[event.bookingId];
        }
      }
    } catch (err) {
      log(`❌ [${t.id}] סנכרון יומן נכשל (${event.type} ${event.bookingId}): ${err.message}`);
    }
  }

  async function notifyTeam(runtime, alert) {
    const t = runtime.tenant;
    const phones = (t.escalation && t.escalation.notifyPhones) || [];
    const summary = `${alert.type} · ${alert.customerName || alert.sessionId} · ${String(alert.message).slice(0, 120)}`;
    for (const phone of phones) {
      // הודעה יזומה של העסק מחייבת תבנית מאושרת — lead_alert (סעיף 5 ב-SKILL)
      await sender.sendTemplate(t.whatsapp.phoneNumberId, phone, 'lead_alert', [summary]);
    }
  }

  /** מטפל בהודעה נכנסת אחת, בתור-לכל-טננט כדי שלא יתערבבו שמירות מצב. */
  function enqueueMessage(runtime, msg) {
    runtime.queue = runtime.queue.then(async () => {
      if (runtime.seenMessageIds.includes(msg.messageId)) return; // משלוח חוזר של Meta
      runtime.seenMessageIds.push(msg.messageId);
      if (runtime.seenMessageIds.length > SEEN_IDS_CAP) {
        runtime.seenMessageIds = runtime.seenMessageIds.slice(-SEEN_IDS_CAP);
      }

      try {
        await refreshBusy(runtime);
        if (runtime.calendarActive && runtime.busyFetchedAt == null) {
          // היומן מעולם לא נקרא בהצלחה — לא קובעים תורים "על עיוור".
          // הלקוח מקבל התנצלות והצוות התראה, במקום דאבל-בוקינג שקט.
          log(`❌ [${runtime.tenant.id}] אין גישה ליומן ואין מטמון — ההודעה נענית בהתנצלות`);
          await sender.sendAgentReply(runtime.tenant.whatsapp.phoneNumberId, msg.from, {
            text: 'סליחה, יש אצלנו תקלה טכנית זמנית 🙏 נחזור אליך בהקדם — אפשר גם לנסות שוב עוד כמה דקות.',
            buttons: [],
          });
          try {
            await notifyTeam(runtime, {
              type: 'system', sessionId: msg.from, customerName: msg.profileName,
              message: 'היומן לא נגיש — הודעת לקוח נענתה בהתנצלות בלבד',
            });
          } catch (err) { log(`⚠️  [${runtime.tenant.id}] התראת צוות נכשלה: ${err.message}`); }
          return;
        }
        const reply = runtime.agent.handleMessage(msg.from, msg.input);
        await sender.sendAgentReply(runtime.tenant.whatsapp.phoneNumberId, msg.from, reply);
        if (reply.event) await syncCalendar(runtime, reply.event);
        if (reply.alert) {
          try { await notifyTeam(runtime, reply.alert); }
          catch (err) { log(`⚠️  [${runtime.tenant.id}] התראת צוות נכשלה: ${err.message}`); }
        }
      } finally {
        // גם אם שלב כלשהו נפל — מה שהסוכן כבר עדכן נשמר לדיסק
        persist(runtime);
      }
    }).catch((err) => {
      log(`❌ [${runtime.tenant.id}] טיפול בהודעה ${msg.messageId} נכשל: ${err.stack || err.message}`);
    });
    return runtime.queue;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY_BYTES) { reject(new Error('body too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  function send(res, status, body, type) {
    const data = typeof body === 'string' ? body : JSON.stringify(body, null, 1);
    res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8' });
    res.end(data);
  }

  function adminAuthorized(req) {
    if (!adminSecret) return false; // בלי ADMIN_SECRET אין ממשק ניהול בכלל
    return req.headers.authorization === `Bearer ${adminSecret}`;
  }

  async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');

    // --- אימות ה-webhook של Meta (נעשה פעם אחת, בהגדרת האפליקציה) ---
    if (req.method === 'GET' && url.pathname === '/webhook/whatsapp') {
      if (verifyToken &&
          url.searchParams.get('hub.mode') === 'subscribe' &&
          url.searchParams.get('hub.verify_token') === verifyToken) {
        return send(res, 200, url.searchParams.get('hub.challenge') || '', 'text/plain');
      }
      return send(res, 403, { error: 'verify token שגוי' });
    }

    // --- הודעות נכנסות ---
    if (req.method === 'POST' && url.pathname === '/webhook/whatsapp') {
      const raw = await readBody(req);
      if (!verifySignature(appSecret, raw, req.headers['x-hub-signature-256'])) {
        log('נדחה POST ל-webhook: חתימה חסרה/שגויה' + (appSecret ? '' : ' (WHATSAPP_APP_SECRET לא מוגדר)'));
        return send(res, 403, { error: 'bad signature' });
      }
      let body;
      try { body = JSON.parse(raw.toString('utf8')); } catch (err) {
        return send(res, 400, { error: 'bad json' });
      }
      const { messages } = parseWebhook(body);
      // עונים ל-Meta מיד; העיבוד ממשיך ברקע בתור של כל טננט
      send(res, 200, { received: messages.length });
      for (const msg of messages) {
        const runtime = findByPhoneNumberId(msg.phoneNumberId);
        if (!runtime) { log(`הודעה ל-phone_number_id לא מוכר: ${msg.phoneNumberId}`); continue; }
        if (!runtime.webhookActive) { log(`⚠️  [${runtime.tenant.id}] הודעה נכנסת אבל הטננט לא פעיל (ראו issues)`); continue; }
        enqueueMessage(runtime, msg);
      }
      return undefined;
    }

    // --- בריאות (ל-docker healthcheck; בלי סודות) ---
    if (req.method === 'GET' && url.pathname === '/health') {
      const tenants = [...runtimes.values()].map((r) => ({
        id: r.tenant.id,
        provider: r.provider,
        webhookActive: r.webhookActive,
        calendarActive: r.calendarActive,
        issues: r.issues,
      }));
      return send(res, 200, { ok: true, dryRun: sender.dryRun, processTz, tenants });
    }

    // --- ממשק ניהול (סוד יחיד — מפעיל סולו) ---
    if (url.pathname.startsWith('/admin/')) {
      if (!adminAuthorized(req)) return send(res, adminSecret ? 403 : 503,
        { error: adminSecret ? 'unauthorized' : 'ADMIN_SECRET לא מוגדר' });

      if (req.method === 'POST' && url.pathname === '/admin/reload') {
        return send(res, 200, { reloaded: loadAllTenants() });
      }

      if (req.method === 'POST' && url.pathname === '/admin/calendar-check') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const runtime = body.tenant ? findBySlug(body.tenant) : null;
        if (body.tenant && !runtime) return send(res, 404, { error: `אין טננט ${body.tenant}` });
        const calendarId = body.calendarId ||
          (runtime && runtime.tenant.calendar && runtime.tenant.calendar.calendarId);
        if (!calendarId) return send(res, 400, { error: 'חסר calendarId (בגוף הבקשה או בטננט)' });
        if (!serviceAccount) return send(res, 400, { error: 'אין service account מוגדר' });
        const client = (runtime && runtime.calendar) || createCalendarClient({
          serviceAccount, fetchImpl: opts.calendarFetch, nowFn,
        });
        const report = await client.calendarCheck(
          calendarId,
          (runtime && runtime.tenant.calendar.additionalBusyCalendars) || [],
          (runtime && runtime.tenant.timezone) || 'Asia/Jerusalem'
        );
        return send(res, report.readOk && report.writeOk ? 200 : 502, report);
      }

      // הרצה יבשה של הודעה דרך הסוכן — על עותק, כדי שבדיקת-עשן לא תיצור
      // תורים אמיתיים בזיכרון החי (שלעולם לא היו מסתנכרנים ליומן)
      if (req.method === 'POST' && url.pathname === '/admin/dry-run') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const runtime = findBySlug(body.tenant);
        if (!runtime) return send(res, 404, { error: `אין טננט ${body.tenant}` });
        await refreshBusy(runtime);
        const clone = createAgent(runtime.tenant,
          agentOptsFor(runtime, runtime.agent.exportState()));
        const reply = clone.handleMessage(body.sessionId || 'dry-run',
          body.buttonId ? { buttonId: body.buttonId, buttonTitle: body.buttonTitle } : String(body.text || ''));
        return send(res, 200, { reply, note: 'הרצה על עותק — המצב החי לא השתנה' });
      }

      return send(res, 404, { error: 'not found' });
    }

    return send(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      log(`❌ שגיאת שרת: ${err.stack || err.message}`);
      if (!res.headersSent) send(res, 500, { error: 'internal' });
    });
  });

  loadAllTenants();

  return { server, env, sender, runtimes, loadAllTenants, enqueueMessage, refreshBusy, findBySlug, log };
}

function main() {
  const app = createApp();
  const port = Number(app.env.PORT || 8080);

  process.on('SIGHUP', () => {
    app.log('SIGHUP — טוען מחדש את קבצי הטננטים (בלי להפיל חיבורים)');
    app.loadAllTenants();
  });
  process.on('SIGTERM', () => { app.log('SIGTERM — נסגרים'); app.server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { app.server.close(() => process.exit(0)); });

  app.server.listen(port, () => {
    app.log('═'.repeat(46));
    app.log(`🚀 שרת שיבוץ החי מאזין על פורט ${port}`);
    app.log(`   מצב שליחה: ${app.sender.dryRun ? 'DRY-RUN (אין WHATSAPP_TOKEN — שום דבר לא נשלח)' : 'חי'}`);
    for (const r of app.runtimes.values()) {
      app.log(`   טננט ${r.tenant.id}: יומן=${r.provider}` +
        ` · webhook=${r.webhookActive ? 'פעיל' : 'כבוי'}` +
        (r.issues.length ? ` · ⚠️ ${r.issues.join(' | ')}` : ''));
    }
    app.log('═'.repeat(46));
  });
}

if (require.main === module) main();

module.exports = { createApp };
