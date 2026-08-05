/**
 * ============================================================================
 *  בוט WhatsApp לקביעת תורים — דמו ללקוח
 *  Node.js + Express + Twilio WhatsApp Sandbox
 * ============================================================================
 *
 *  זרימת השיחה:
 *    1. המטופל שולח הודעה ("אני רוצה תור" / "תור" / "הזמנה")
 *    2. הבוט מבקש שם מלא
 *    3. הבוט מציג רשימת זמינות קשיחה (4 אפשרויות לדמו)
 *    4. המטופל בוחר מספר (1-4)
 *    5. הבוט מבקש אישור (כן/לא)
 *    6. הבוט שומר ל-JSON, שולח הודעת סיום
 *    7. אחרי דקה נשלחת "תזכורת למחר" (סימולציה)
 *
 *  כל המצב נשמר בזיכרון + מגובה לקובץ JSON — אין צורך ב-DB לדמו.
 * ============================================================================
 */

require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const twilio = require('twilio');

// ============================================================================
//  1. הגדרות (הכל דרך process.env — ראה .env.example)
// ============================================================================

const CONFIG = {
  port: process.env.PORT || 3000,
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  // מספר ה-WhatsApp של Twilio. בסנדבוקס זה תמיד +14155238886
  whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
  // כמה זמן עד התזכורת. ברירת מחדל: דקה אחת (סימולציה של "תזכורת למחרת")
  reminderDelayMs: Number(process.env.REMINDER_DELAY_MS || 60_000),
  // אימות חתימת Twilio על הוובהוק. כבוי בדמו כדי לא לחסום בדיקות מקומיות.
  validateSignature: process.env.VALIDATE_TWILIO_SIGNATURE === 'true',
  // כתובת ציבורית (ngrok וכו') — נדרשת רק כשמפעילים אימות חתימה
  publicUrl: process.env.PUBLIC_URL || '',
  clinicName: process.env.CLINIC_NAME || 'מרפאת ד"ר כהן',
  dataFile: path.join(__dirname, 'data', 'appointments.json'),
};

// לקוח Twilio נוצר רק אם יש credentials.
// בלעדיהם הבוט עדיין עובד — הודעות יוצאות פשוט נדפסות לקונסול (מצב דמו).
const twilioClient =
  CONFIG.accountSid && CONFIG.authToken
    ? twilio(CONFIG.accountSid, CONFIG.authToken)
    : null;

if (!twilioClient) {
  console.warn(
    '⚠️  לא נמצאו TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN — ' +
      'רץ במצב דמו: הודעות יוצאות (תזכורות) יודפסו לקונסול בלבד.'
  );
}

// ============================================================================
//  2. "מסד הנתונים" — זיכרון + קובץ JSON
// ============================================================================

/**
 * sessions: מצב השיחה הפעילה לכל מספר טלפון.
 * מפתח = מספר WhatsApp (whatsapp:+972...), ערך = { step, name, slotId, updatedAt }
 */
const sessions = new Map();

/** appointments: כל התורים שנקבעו (נטען מהדיסק בעליית השרת) */
let appointments = [];

/** טעינת התורים מהקובץ. אם אין קובץ — מתחילים מרשימה ריקה. */
function loadAppointments() {
  try {
    const raw = fs.readFileSync(CONFIG.dataFile, 'utf8');
    appointments = JSON.parse(raw);
    console.log(`📂 נטענו ${appointments.length} תורים מ-${CONFIG.dataFile}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('שגיאה בקריאת קובץ התורים, מתחילים מחדש:', err.message);
    }
    appointments = [];
  }
}

/** שמירת כל התורים לדיסק (כתיבה מלאה — מספיק בהחלט לדמו) */
function saveAppointments() {
  fs.mkdirSync(path.dirname(CONFIG.dataFile), { recursive: true });
  fs.writeFileSync(
    CONFIG.dataFile,
    JSON.stringify(appointments, null, 2),
    'utf8'
  );
}

// ============================================================================
//  3. רשימת הזמינות הקשיחה (לדמו — בפרודקשן זה יגיע מיומן המרפאה)
// ============================================================================

const AVAILABLE_SLOTS = [
  { id: 1, label: 'יום ראשון, 09:00', doctor: 'ד"ר כהן' },
  { id: 2, label: 'יום ראשון, 11:30', doctor: 'ד"ר כהן' },
  { id: 3, label: 'יום שני, 16:00', doctor: 'ד"ר לוי' },
  { id: 4, label: 'יום רביעי, 08:15', doctor: 'ד"ר לוי' },
];

// ============================================================================
//  4. זיהוי כוונה (Intent) — התאמה פשוטה על מילות מפתח
// ============================================================================

/** ניקוי טקסט: אותיות סופיות נשארות, מסירים ניקוד/סימני פיסוק ורווחים כפולים */
function normalize(text) {
  return String(text || '')
    .replace(/[֑-ׇ]/g, '') // ניקוד וטעמים
    .replace(/[!?.,،؛:'"״׳()\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const INTENT_KEYWORDS = {
  // "אני רוצה תור" / "תור" / "הזמנה" וגם ניסוחים קרובים
  BOOK: [
    'תור',
    'הזמנה',
    'להזמין',
    'לקבוע',
    'קביעת',
    'פגישה',
    'ביקור',
    'appointment',
    'book',
  ],
  CANCEL: ['ביטול', 'בטל', 'לבטל', 'עצור', 'cancel', 'stop'],
  HELP: ['עזרה', 'תפריט', 'מה אפשר', 'help', 'menu'],
  GREET: ['היי', 'שלום', 'הי', 'אהלן', 'בוקר טוב', 'ערב טוב', 'hi', 'hello'],
};

/** מחזיר את הכוונה של ההודעה: BOOK / CANCEL / HELP / GREET / UNKNOWN */
function detectIntent(text) {
  const clean = normalize(text);
  // הסדר חשוב: ביטול ועזרה גוברים על בקשת תור
  for (const intent of ['CANCEL', 'HELP', 'BOOK', 'GREET']) {
    if (INTENT_KEYWORDS[intent].some((kw) => clean.includes(kw))) {
      return intent;
    }
  }
  return 'UNKNOWN';
}

/**
 * פיצול למילים בודדות.
 * שימו לב: לא משתמשים ב-\b של regex — הוא מבוסס על \w שהוא ASCII בלבד,
 * ולכן פשוט לא עובד על עברית. השוואת מילים מלאות היא הדרך הנכונה כאן.
 */
function tokenize(text) {
  return normalize(text).split(' ').filter(Boolean);
}

/** זיהוי בחירת מספר: "2", "אפשרות 2", "שתיים" */
function parseSlotChoice(text) {
  const tokens = tokenize(text);

  const digit = tokens.find((t) => /^[1-9]$/.test(t));
  if (digit) return Number(digit);

  const words = {
    ראשונה: 1, ראשון: 1, אחת: 1, אחד: 1,
    שנייה: 2, שניה: 2, שתיים: 2, שניים: 2,
    שלישית: 3, שלישי: 3, שלוש: 3, שלושה: 3,
    רביעית: 4, רביעי: 4, ארבע: 4, ארבעה: 4,
  };
  for (const token of tokens) {
    if (words[token]) return words[token];
  }
  return null;
}

/** זיהוי כן/לא לאישור התור */
const YES_WORDS = ['כן', 'אישור', 'אשר', 'מאשר', 'מאשרת', 'אוקיי', 'אוקי', 'בסדר', 'סבבה', 'yes', 'y', 'ok'];
const NO_WORDS = ['לא', 'שנה', 'להחליף', 'אחר', 'no', 'n'];

function parseYesNo(text) {
  const tokens = tokenize(text);
  if (tokens.some((t) => YES_WORDS.includes(t))) return 'YES';
  if (tokens.some((t) => NO_WORDS.includes(t))) return 'NO';
  return null;
}

// ============================================================================
//  5. תבניות ההודעות
// ============================================================================

const MESSAGES = {
  welcome: () =>
    `שלום! 👋 הגעת ל*${CONFIG.clinicName}*.\n` +
    `אפשר לקבוע תור בקלות דרך WhatsApp.\n\n` +
    `כתבו *"אני רוצה תור"* כדי להתחיל.`,

  help: () =>
    `אני יכול לעזור עם:\n` +
    `• *תור* — קביעת תור חדש\n` +
    `• *ביטול* — יציאה מהתהליך והתחלה מחדש\n` +
    `• *עזרה* — התפריט הזה`,

  askName: () => `מצוין! 😊 מה השם המלא שלך?`,

  slotsList: (name) => {
    const lines = AVAILABLE_SLOTS.map(
      (s) => `*${s.id}.* ${s.label} — ${s.doctor}`
    ).join('\n');
    return (
      `תודה ${name}! אלו התורים הפנויים הקרובים:\n\n${lines}\n\n` +
      `השיבו במספר האפשרות (1-${AVAILABLE_SLOTS.length}).`
    );
  },

  confirmSlot: (slot) =>
    `לאישור: תור ל־*${slot.label}* אצל ${slot.doctor}.\n\n` +
    `להשלמת ההזמנה השיבו *כן*, או *לא* לבחירה מחדש.`,

  booked: (appointment) =>
    `✅ *התור נקבע בהצלחה!*\n\n` +
    `👤 שם: ${appointment.patientName}\n` +
    `🗓️ מועד: ${appointment.slotLabel}\n` +
    `🩺 רופא: ${appointment.doctor}\n` +
    `🔖 מספר אסמכתא: ${appointment.id}\n\n` +
    `נשלח לכם תזכורת לפני התור. יום נעים! 🌿`,

  invalidSlot: () =>
    `לא זיהיתי את הבחירה 🤔\n` +
    `אנא השיבו במספר בין 1 ל-${AVAILABLE_SLOTS.length}, או כתבו *ביטול* להתחלה מחדש.`,

  invalidYesNo: () => `אנא השיבו *כן* לאישור או *לא* לבחירה מחדש.`,

  invalidName: () => `אשמח לשם מלא (לפחות 2 תווים) כדי לרשום את התור 🙏`,

  cancelled: () => `התהליך בוטל. כשתרצו לקבוע תור — פשוט כתבו *תור* 🙂`,

  fallback: () =>
    `לא בטוח שהבנתי 🤔\n` +
    `כדי לקבוע תור כתבו *"אני רוצה תור"*, או *עזרה* לתפריט.`,

  reminder: (appointment) =>
    `⏰ *תזכורת לתור*\n\n` +
    `שלום ${appointment.patientName}, זו תזכורת לתור שלך מחר:\n` +
    `🗓️ ${appointment.slotLabel}\n` +
    `🩺 ${appointment.doctor}\n` +
    `📍 ${CONFIG.clinicName}\n\n` +
    `נא להגיע 10 דקות לפני. לביטול השיבו *ביטול*.`,
};

// ============================================================================
//  6. שליחת הודעה יוצאת (לתזכורת) — דרך Twilio REST API
// ============================================================================

/**
 * שולח הודעת WhatsApp יזומה.
 * ללא credentials — מדפיס לקונסול כדי שהדמו ירוץ גם בלי חשבון Twilio.
 */
async function sendWhatsApp(to, body) {
  if (!twilioClient) {
    console.log(`\n📤 [מצב דמו] הודעה יוצאת אל ${to}:\n${body}\n`);
    return;
  }
  try {
    const message = await twilioClient.messages.create({
      from: CONFIG.whatsappNumber,
      to,
      body,
    });
    console.log(`📤 נשלחה הודעה אל ${to} (SID: ${message.sid})`);
  } catch (err) {
    console.error(`❌ שליחת הודעה אל ${to} נכשלה:`, err.message);
  }
}

/**
 * מתזמן תזכורת. בדמו — דקה אחת מרגע קביעת התור.
 * בפרודקשן היינו משתמשים ב-cron/queue במקום setTimeout שנעלם בהפעלה מחדש.
 */
function scheduleReminder(appointment) {
  const minutes = (CONFIG.reminderDelayMs / 60_000).toFixed(1);
  console.log(
    `⏳ תזכורת לתור ${appointment.id} תישלח בעוד ${minutes} דקות`
  );

  const timer = setTimeout(async () => {
    await sendWhatsApp(appointment.phone, MESSAGES.reminder(appointment));

    // מסמנים שהתזכורת נשלחה ומגבים לדיסק
    const record = appointments.find((a) => a.id === appointment.id);
    if (record) {
      record.reminderSentAt = new Date().toISOString();
      saveAppointments();
    }
  }, CONFIG.reminderDelayMs);

  // שלא ימנע מהתהליך להיסגר בסיום
  if (typeof timer.unref === 'function') timer.unref();
}

// ============================================================================
//  7. ניהול מצב השיחה (State Machine)
// ============================================================================

const STEPS = {
  IDLE: 'IDLE',                 // אין שיחה פעילה
  AWAITING_NAME: 'AWAITING_NAME',   // מחכים לשם המטופל
  AWAITING_SLOT: 'AWAITING_SLOT',   // מחכים לבחירת מועד
  AWAITING_CONFIRM: 'AWAITING_CONFIRM', // מחכים ל"כן/לא"
};

function getSession(phone) {
  if (!sessions.has(phone)) {
    sessions.set(phone, { step: STEPS.IDLE, name: null, slotId: null });
  }
  return sessions.get(phone);
}

function resetSession(phone) {
  sessions.set(phone, { step: STEPS.IDLE, name: null, slotId: null });
}

/** יוצר מזהה אסמכתא קצר וקריא, למשל APT-4821 */
function generateAppointmentId() {
  return `APT-${Math.floor(1000 + Math.random() * 9000)}`;
}

/**
 * הלב של הבוט: מקבל הודעה נכנסת ומחזיר את טקסט התשובה.
 * פונקציה טהורה מבחינת HTTP — לכן קל לבדוק אותה גם מה-CLI (demo-cli.js).
 */
async function handleIncomingMessage(phone, rawText) {
  const session = getSession(phone);
  const text = String(rawText || '').trim();
  const intent = detectIntent(text);

  // ביטול ועזרה עובדים בכל שלב בשיחה
  if (intent === 'CANCEL') {
    resetSession(phone);
    return MESSAGES.cancelled();
  }
  if (intent === 'HELP') {
    return MESSAGES.help();
  }

  switch (session.step) {
    // ---- שלב 0: אין שיחה פעילה — מחכים לכוונה ----
    case STEPS.IDLE: {
      if (intent === 'BOOK') {
        session.step = STEPS.AWAITING_NAME;
        return MESSAGES.askName();
      }
      if (intent === 'GREET') return MESSAGES.welcome();
      return MESSAGES.fallback();
    }

    // ---- שלב 1: קליטת שם המטופל ----
    case STEPS.AWAITING_NAME: {
      if (text.length < 2) return MESSAGES.invalidName();
      session.name = text;
      session.step = STEPS.AWAITING_SLOT;
      return MESSAGES.slotsList(session.name);
    }

    // ---- שלב 2: בחירת מועד מהרשימה ----
    case STEPS.AWAITING_SLOT: {
      const choice = parseSlotChoice(text);
      const slot = AVAILABLE_SLOTS.find((s) => s.id === choice);
      if (!slot) return MESSAGES.invalidSlot();

      session.slotId = slot.id;
      session.step = STEPS.AWAITING_CONFIRM;
      return MESSAGES.confirmSlot(slot);
    }

    // ---- שלב 3: אישור סופי, שמירה ותזמון תזכורת ----
    case STEPS.AWAITING_CONFIRM: {
      const answer = parseYesNo(text);

      if (answer === 'NO') {
        session.step = STEPS.AWAITING_SLOT;
        session.slotId = null;
        return MESSAGES.slotsList(session.name);
      }
      if (answer !== 'YES') return MESSAGES.invalidYesNo();

      const slot = AVAILABLE_SLOTS.find((s) => s.id === session.slotId);
      const appointment = {
        id: generateAppointmentId(),
        patientName: session.name,
        phone,
        slotId: slot.id,
        slotLabel: slot.label,
        doctor: slot.doctor,
        createdAt: new Date().toISOString(),
        reminderSentAt: null,
      };

      appointments.push(appointment);
      saveAppointments();
      scheduleReminder(appointment); // ⏰ תזכורת בעוד דקה

      resetSession(phone);
      return MESSAGES.booked(appointment);
    }

    default:
      resetSession(phone);
      return MESSAGES.fallback();
  }
}

// ============================================================================
//  8. שרת Express + וובהוק Twilio
// ============================================================================

const app = express();

// Twilio שולח את הוובהוק כ-form-urlencoded
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/**
 * אימות חתימת Twilio — מוודא שהבקשה באמת הגיעה מ-Twilio.
 * בדמו כבוי כברירת מחדל (VALIDATE_TWILIO_SIGNATURE=true כדי להפעיל).
 */
function verifyTwilioSignature(req, res, next) {
  if (!CONFIG.validateSignature) return next();

  const signature = req.headers['x-twilio-signature'];
  const url = CONFIG.publicUrl
    ? `${CONFIG.publicUrl.replace(/\/$/, '')}${req.originalUrl}`
    : `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  const valid = twilio.validateRequest(
    CONFIG.authToken,
    signature,
    url,
    req.body
  );
  if (!valid) {
    console.warn('🚫 בקשה נדחתה: חתימת Twilio לא תקינה');
    return res.status(403).send('Invalid Twilio signature');
  }
  return next();
}

/**
 * הוובהוק הראשי — כאן נכנסות הודעות WhatsApp.
 * ב-Twilio Console מגדירים: "WHEN A MESSAGE COMES IN" → POST https://<ngrok>/whatsapp
 */
app.post('/whatsapp', verifyTwilioSignature, async (req, res) => {
  const from = req.body.From; // לדוגמה: whatsapp:+972501234567
  const body = req.body.Body || '';

  console.log(`📥 ${from}: ${body}`);

  let reply;
  try {
    reply = await handleIncomingMessage(from, body);
  } catch (err) {
    console.error('שגיאה בטיפול בהודעה:', err);
    reply = 'אירעה תקלה זמנית 🙏 נסו שוב בעוד רגע.';
  }

  console.log(`🤖 → ${from}: ${reply.split('\n')[0]}...`);

  // מחזירים TwiML — Twilio ישלח את זה חזרה כתשובה ב-WhatsApp
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(reply);
  res.type('text/xml').send(twiml.toString());
});

/**
 * נקודת קצה לבדיקה מהירה בלי WhatsApp בכלל:
 *   curl -X POST localhost:3000/simulate -H 'Content-Type: application/json' \
 *        -d '{"from":"whatsapp:+972500000000","body":"אני רוצה תור"}'
 */
app.post('/simulate', async (req, res) => {
  const from = req.body.from || 'whatsapp:+972500000000';
  const body = req.body.body || '';
  const reply = await handleIncomingMessage(from, body);
  res.json({ from, body, reply });
});

/** צפייה בכל התורים שנשמרו (נוח להראות ללקוח בדמו) */
app.get('/appointments', (req, res) => {
  res.json({ count: appointments.length, appointments });
});

/** בדיקת בריאות */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    clinic: CONFIG.clinicName,
    twilio: twilioClient ? 'connected' : 'demo-mode',
    appointments: appointments.length,
    activeSessions: sessions.size,
  });
});

// ============================================================================
//  9. הפעלה
// ============================================================================

loadAppointments();

// מריצים שרת רק כשהקובץ מורץ ישירות (כדי ש-demo-cli.js יוכל לייבא את הלוגיקה)
if (require.main === module) {
  app.listen(CONFIG.port, () => {
    console.log(`\n🚀 הבוט רץ על http://localhost:${CONFIG.port}`);
    console.log(`   וובהוק: POST /whatsapp`);
    console.log(`   סימולציה: POST /simulate`);
    console.log(`   תורים: GET /appointments`);
    console.log(
      `   תזכורת מתוזמנת ל-${(CONFIG.reminderDelayMs / 1000).toFixed(0)} שניות אחרי אישור\n`
    );
  });
}

module.exports = {
  app,
  handleIncomingMessage,
  detectIntent,
  AVAILABLE_SLOTS,
  getAppointments: () => appointments,
};
