/**
 * ששת תרחישי הקבלה של הטננט החי `demo-dental` (אור-דנט) — נטענים לתוך
 * ה-harness של run-probes.js כ-factory שמקבל את כלי העזר שלו, כך ש-npm test
 * מכסה גם את הטננט הזה בלי לשנות את package.json.
 *
 * כל האסרטות נגזרות מ-tenants/demo-dental.json עצמו — בלי מחרוזות שהועתקו
 * מהטננט test-dental.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SLUG = 'demo-dental';
const tenant = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'tenants', `${SLUG}.json`), 'utf8'));

function faqByQ(substr) {
  const entry = tenant.faq.find((f) => f.q.includes(substr));
  if (!entry) throw new Error(`FAQ עם "${substr}" לא נמצא ב-${SLUG}`);
  return entry;
}

module.exports = function buildDemoProbes({ assert, findReply, slotButtonsOf, slotWithinHours }) {
  const within = (iso, dur) => slotWithinHours(iso, dur, tenant);
  const probes = [];

  // ---- ד1: שאלת מחיר — מחיר אמיתי מהטננט + הצהרת המחירים ----
  probes.push({
    name: 'ד1. demo-dental: שאלת מחיר עם הצהרה',
    slug: SLUG,
    file: 'probe-demo-1',
    inputs: ['כמה עולה סתימה?'],
    check({ exchanges }) {
      const r = exchanges[0].reply;
      const svc = tenant.services.find((s) => s.aliases.includes('סתימה'));
      const priceCore = String(svc.price).replace(/\s*₪.*$/, '');
      assert(r.text.includes(priceCore), `התשובה מכילה את המחיר מהטננט (${priceCore})`);
      assert(r.text.includes('₪'), 'התשובה נוקבת במטבע (₪)');
      assert(r.text.includes(svc.name), `התשובה נוקבת בשם השירות (${svc.name})`);
      assert(r.text.includes(tenant.priceDisclaimer), 'הצהרת המחירים (priceDisclaimer) מופיעה בתשובה');
    },
  });

  // ---- ד2: הצעת מועדים בתוך שעות הפעילות (בלי שישי אחה"צ, בלי שבת) ----
  probes.push({
    name: 'ד2. demo-dental: מועדים ככפתורים בתוך שעות הפעילות',
    slug: SLUG,
    file: 'probe-demo-2',
    inputs: ['אני רוצה לקבוע תור לניקוי'],
    check({ exchanges }) {
      const offer = exchanges.find((e) => slotButtonsOf(e.reply).length > 0);
      assert(!!offer, 'הסוכן הציע מועדים ככפתורים אינטראקטיביים');
      if (!offer) return;
      const svc = tenant.services.find((s) => s.aliases.includes('ניקוי'));
      const slots = slotButtonsOf(offer.reply).map((b) => b.id.slice(5));
      assert(slots.length >= 3, `הוצעו לפחות 3 מועדים (הוצעו ${slots.length})`);
      assert(slots.every((iso) => within(iso, svc.durationMinutes)),
        'כל המועדים בתוך שעות הפעילות של demo-dental (שישי עד 13:00, שבת סגור)');
    },
  });

  // ---- ד3: הזמנה → העברה → ביטול בשיחה אחת ----
  probes.push({
    name: 'ד3. demo-dental: הזמנה, העברה וביטול בשיחה אחת',
    slug: SLUG,
    file: 'probe-demo-3',
    inputs: [
      'אני רוצה לקבוע תור לניקוי', '1', 'דנה כהן', 'בדיקה שגרתית', 'לא כואב', 'כן',
      'אני רוצה להזיז את התור', '2', 'כן',
      'אני רוצה לבטל את התור', 'כן',
    ],
    check({ exchanges }) {
      const iBook = exchanges.findIndex((e) => e.reply.text.includes('התור נקבע'));
      const iMove = exchanges.findIndex((e) => e.reply.text.includes('התור עודכן'));
      const iCancel = exchanges.findIndex((e) => e.reply.text.includes('התור בוטל'));
      assert(iBook !== -1, 'ההזמנה הושלמה ("התור נקבע")');
      assert(iMove !== -1 && iMove > iBook, 'ההעברה הושלמה אחרי ההזמנה ("התור עודכן")');
      assert(iCancel !== -1 && iCancel > iMove, 'הביטול הושלם אחרי ההעברה ("התור בוטל")');
      const moveText = iMove !== -1 ? exchanges[iMove].reply.text : '';
      assert(moveText.includes('במקום'), 'הודעת ההעברה מציינת את המועד הישן והחדש');
      assert(/APT-\d+/.test(moveText), 'מספר האסמכתא נשמר לאורך השיחה');
    },
  });

  // ---- ד4: שאלה מחוץ ל-FAQ — הסלמה במקום המצאה ----
  probes.push({
    name: 'ד4. demo-dental: שאלה מחוץ ל-FAQ מוסלמת ולא מומצאת',
    slug: SLUG,
    file: 'probe-demo-4',
    inputs: ['מה הייתה תוצאת משחק הכדורגל אתמול?'],
    check({ exchanges }) {
      const r = exchanges[0].reply;
      assert(r.text.includes('אני לא בטוח'), 'הסוכן מודה שאינו בטוח');
      assert(r.text.includes(tenant.businessName), 'ההסלמה מפנה לעסק בשמו');
      assert(!!r.alert && r.alert.type === 'escalation', 'נוצרה התראת הסלמה לצוות');
      assert((r.alert && r.alert.notifyPhones || []).length > 0, 'ההתראה כוללת נמעני SMS מהטננט');
      assert(!/כדורגל|תוצאה|משחק/.test(r.text.replace(/משחק הכדורגל/g, '')),
        'הסוכן לא המציא תשובה עניינית');
    },
  });

  // ---- ד5: גדר רפואית — סירוב לייעוץ + הצעת תור ----
  probes.push({
    name: 'ד5. demo-dental: גדר רפואית — סירוב לייעוץ + הצעת תור',
    slug: SLUG,
    file: 'probe-demo-5',
    inputs: ['יש לי כאב שן', 'יש לי נפיחות בחניכיים, מה כדאי לקחת?'],
    check({ exchanges }) {
      for (const e of exchanges) {
        const t = e.reply.text;
        assert(t.includes('ייעוץ רפואי'), `הסירוב מציין שאין ייעוץ רפואי בצ'אט ("${e.user}")`);
        assert(slotButtonsOf(e.reply).length > 0, `מוצעים מועדים לתור במקום עצה ("${e.user}")`);
        assert(!/אני מציע|מומלץ לקחת|כדאי לקחת|קחי|קח |תיקח|אקמול|נורופן|משכך/.test(t),
          `אין שום עצה רפואית בתשובה ("${e.user}")`);
      }
    },
  });

  // ---- ד6: "נציג" — העברה לאדם + התראת lead_alert לנמענים המדויקים ----
  probes.push({
    name: 'ד6. demo-dental: בקשת נציג — העברה + התראה',
    slug: SLUG,
    file: 'probe-demo-6',
    inputs: ['נציג'],
    check({ exchanges }) {
      const r = exchanges[0].reply;
      assert(!!r.alert && r.alert.type === 'handoff', 'נוצרה התראת העברה לאדם (handoff)');
      assert(JSON.stringify((r.alert || {}).notifyPhones) === JSON.stringify(tenant.escalation.notifyPhones),
        'נמעני ההתראה הם בדיוק escalation.notifyPhones מהטננט');
      assert(r.text.includes(tenant.businessName), 'הודעת ההעברה נוקבת בשם העסק');
    },
  });

  // ---- ד7: התנגשות KW.HOURS — «אתם עובדים עם כללית?» חייב להגיע ל-FAQ הקופות ----
  //     (טבלת GO-LIVE-DEMO.md «מגבלות ידועות» §1 — שני הכיוונים)
  probes.push({
    name: 'ד7. demo-dental: «אתם עובדים עם…» → FAQ קופות, ניסוחי שעות → שעות',
    slug: SLUG,
    file: 'probe-demo-7',
    inputs: [
      'אתם עובדים עם כללית?',       // 0: ❌ בטבלה — חייב קופות
      'אתם עובדים עם מכבי?',        // 1: ❌ בטבלה — חייב קופות
      'עובדים עם קופות חולים?',      // 2: ✅ בטבלה — נשאר קופות
      'יש לכם הסדר עם כללית?',      // 3: ✅ בטבלה — נשאר קופות
      'אתם עובדים היום?',           // 4: רגרסיה — חייב שעות
      'אתם עובדים בשישי?',          // 5: רגרסיה — חייב שעות
      'מתי אתם פתוחים?',            // 6: רגרסיה — חייב שעות
    ],
    check({ exchanges }) {
      const hmo = faqByQ('קופות חולים');
      const isHours = (t) => t.includes('שעות הפעילות');
      const isHmo = (t) => t.includes(hmo.answer);
      [0, 1, 2, 3].forEach((i) => {
        assert(isHmo(exchanges[i].reply.text) && !isHours(exchanges[i].reply.text),
          `"${exchanges[i].user}" → תשובת הקופות ולא שעות פעילות`);
      });
      [4, 5, 6].forEach((i) => {
        assert(isHours(exchanges[i].reply.text) && !isHmo(exchanges[i].reply.text),
          `"${exchanges[i].user}" → שעות פעילות ולא FAQ`);
      });
    },
  });

  // ---- ד8: התנגשות KW.POLICY — «יש דמי ביטול?» חייב להגיע ל-FAQ המדיניות ----
  //     (טבלת GO-LIVE-DEMO.md «מגבלות ידועות» §2 — שני הכיוונים)
  probes.push({
    name: 'ד8. demo-dental: «דמי ביטול» → FAQ מדיניות, בקשת ביטול אמיתית → זרימת ביטול',
    slug: SLUG,
    file: 'probe-demo-8',
    inputs: [
      'יש דמי ביטול?',            // 0: ❌ בטבלה — חייב את המדיניות
      'מה דמי הביטול?',           // 1: ❌ בטבלה — חייב את המדיניות
      'מה מדיניות הביטולים?',      // 2: ✅ בטבלה — נשאר מדיניות
      'יש קנס על ביטולים?',       // 3: ✅ בטבלה — נשאר מדיניות
      'ביטול',                    // 4: רגרסיה — מילת פעולה לבדה נשארת זרימת ביטול
      'אני רוצה לבטל את התור',    // 5: רגרסיה — בקשת ביטול נשארת זרימת ביטול
    ],
    check({ exchanges }) {
      const policy = faqByQ('מדיניות הביטולים');
      const isPolicy = (t) => t.includes(policy.answer);
      const isCancelFlow = (t) => t.includes('לא מצאתי תור פעיל');
      [0, 1, 2, 3].forEach((i) => {
        assert(isPolicy(exchanges[i].reply.text) && !isCancelFlow(exchanges[i].reply.text),
          `"${exchanges[i].user}" → תשובת המדיניות ולא זרימת ביטול`);
      });
      [4, 5].forEach((i) => {
        assert(isCancelFlow(exchanges[i].reply.text) && !isPolicy(exchanges[i].reply.text),
          `"${exchanges[i].user}" → זרימת ביטול (אין תור פעיל) ולא FAQ`);
      });
    },
  });

  // ---- ד9: התנגשות KW.MORE — «מאחר» בבחירת מועד חייב להגיע ל-FAQ המדיניות ----
  //     (טבלת GO-LIVE-DEMO.md «מגבלות ידועות» §3 — שני הכיוונים, כולל דפדוף)
  probes.push({
    name: 'ד9. demo-dental: «מאחר» בבחירת מועד → מדיניות, «אחרים/אחרת» → עוד מועדים',
    slug: SLUG,
    file: 'probe-demo-9',
    inputs: [
      'אני רוצה לקבוע תור לניקוי',   // 0: פתיחת בחירת מועד (עמוד 1)
      'מה קורה אם אני מאחר?',       // 1: ❌ בטבלה — חייב את המדיניות, לא עוד מועדים
      'זמנים אחרים',                // 2: רגרסיה — דפדוף לעמוד מועדים נוסף
      'אפשרות אחרת',                // 3: רגרסיה — גם צורת הנקבה מדפדפת
      'מועד אחר',                   // 4: רגרסיה — "אחר" עצמאי ומדויק עדיין מדפדף
      'מה קורה אם אני מאחרת?',      // 5: ✅ בטבלה — נשאר מדיניות
      '1',                          // 6: הזרימה שרדה — בחירת מועד ממשיכה לשאלת השם
    ],
    check({ exchanges }) {
      const policy = faqByQ('מדיניות הביטולים');
      const isPolicy = (t) => t.includes(policy.answer);
      assert(slotButtonsOf(exchanges[0].reply).length > 0, 'נפתחה בחירת מועד עם כפתורי מועדים');
      // באמצע זרימה הסוכן מוסיף לתשובה צדדית תזכורת-שלב עם כפתורי המועדים —
      // לכן בודקים שתשובת המדיניות עצמה נמצאת, לא שאין כפתורים
      [1, 5].forEach((i) => {
        assert(isPolicy(exchanges[i].reply.text),
          `"${exchanges[i].user}" → תשובת המדיניות (ולא עמוד מועדים בלבד)`);
      });
      [2, 3, 4].forEach((i) => {
        assert(slotButtonsOf(exchanges[i].reply).length > 0,
          `"${exchanges[i].user}" → הוצע עמוד מועדים (דפדוף)`);
        assert(!exchanges[i].reply.text.includes('לא זיהיתי'),
          `"${exchanges[i].user}" → דפדוף אמיתי ולא נפילה ל"לא זיהיתי את המועד"`);
      });
      assert(exchanges[6].reply.text.includes('על שם מי'),
        'אחרי שאלת הביניים אפשר עדיין לבחור מועד ולהמשיך לשאלת השם');
    },
  });

  return probes;
};

module.exports.tenant = tenant;
module.exports.faqByQ = faqByQ;
