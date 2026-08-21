/**
 * ============================================================================
 *  Shibutz — ליבת סוכן הזמנות בעברית ל-WhatsApp
 * ============================================================================
 *
 *  מודול טהור, ללא תלויות וללא I/O: אותו קובץ רץ ב-Node (סימולטור, שרת דמו)
 *  ובדפדפן (נגן הדמו). כל מה שהסוכן יודע מגיע מקובץ הטננט — תשובה היא תמיד
 *  או מידע מהטננט או הסלמה לאדם. הסוכן לא ממציא תשובות.
 *
 *  סדר העדיפויות של הכוונות אינו מקרי והוא חוזה המוצר:
 *    הסרה → נציג אנושי → גדרות ורטיקל (רפואי/משפטי) → טריגרים של הסלמה →
 *    המשך זרימה פעילה → מחיר → קביעה/שינוי/ביטול → שעות → FAQ → ברכה →
 *    הסלמה (ברירת מחדל)
 *
 *  גדרות הוורטיקל נבדקות לפני הכול ואינן ניתנות לכיבוי דרך הטננט.
 * ============================================================================
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ShibutzAgent = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  // ==========================================================================
  //  1. עזרי טקסט עברי
  // ==========================================================================

  /** ניקוי: הסרת ניקוד, פיסוק ורווחים כפולים. אותיות סופיות נשארות. */
  function normalize(text) {
    return String(text == null ? '' : text)
      .replace(/[֑-ׇ]/g, '')
      .replace(/["'״׳`!?.,;:()\[\]{}<>\-–—_*~\/\\+=|№#%^&$@]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function tokenize(text) {
    return normalize(text).split(' ').filter(Boolean);
  }

  var HEB_PARTICLES = ['ו', 'ש', 'ה', 'ב', 'ל', 'כ', 'מ'];
  var HEB_SUFFIXES = ['ים', 'ות'];

  /**
   * התאמת מילה בודדת עם קידומות שימוש (ו/ש/ה/ב/ל/כ/מ) וריבוי (ים/ות).
   * במכוון לא startsWith כללי — "תורה" איננה "תור".
   */
  function wordHit(token, kw) {
    // בודקים את הטוקן המקורי וכל שלב של הסרת קידומת — כולל צורת ריבוי בכל שלב
    // (אחרת "מדממות" מאבדת את ה-מ' כקידומת ולא נבדקת מול "מדמם"+"ות")
    var candidates = [token];
    var t = token;
    for (var i = 0; i < 2; i++) {
      if (t.length > kw.length && HEB_PARTICLES.indexOf(t[0]) !== -1) {
        t = t.slice(1);
        candidates.push(t);
      } else break;
    }
    for (var c = 0; c < candidates.length; c++) {
      if (candidates[c] === kw) return true;
      for (var s = 0; s < HEB_SUFFIXES.length; s++) {
        if (candidates[c] === kw + HEB_SUFFIXES[s]) return true;
      }
    }
    return false;
  }

  /** התאמת ביטוי: ביטוי רב-מילים כתת-מחרוזת מנורמלת, מילה בודדת דרך wordHit. */
  function textHasKeyword(norm, tokens, kw) {
    if (kw.indexOf(' ') !== -1) return norm.indexOf(kw) !== -1;
    for (var i = 0; i < tokens.length; i++) {
      if (wordHit(tokens[i], kw)) return true;
    }
    return false;
  }

  function textHasAny(norm, tokens, kws) {
    for (var i = 0; i < kws.length; i++) {
      if (textHasKeyword(norm, tokens, kws[i])) return kws[i];
    }
    return null;
  }

  /**
   * האם הטקסט נראה כמו שאלת ייעוץ (ולא סתם אזכור)? משמש רק בשלבי איסוף
   * נתונים: "כאב" כתשובה ל"מה הסיבה לפנייה?" הוא נתון לשמירה, לא בקשת עצה —
   * אבל "יש לי כאב, מה לקחת?" היא בקשת עצה גם באמצע טופס.
   */
  var ADVICE_MARKERS = ['מה', 'האם', 'איך', 'למה', 'כדאי', 'אפשר', 'צריך',
    'מסוכן', 'לקחת', 'לעשות', 'יעבור', 'נורמלי', 'ממליץ', 'ממליצה', 'תמליץ', 'עדיף'];

  function looksLikeAdviceQuestion(raw, norm, tokens) {
    if (String(raw).indexOf('?') !== -1) return true;
    return !!textHasAny(norm, tokens, ADVICE_MARKERS);
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ==========================================================================
  //  2. אוצר מילים לכוונות
  // ==========================================================================

  var KW = {
    BOOK: ['לקבוע תור', 'רוצה תור', 'צריך תור', 'צריכה תור', 'להזמין תור',
      'לתאם תור', 'זימון תור', 'תור חדש', 'לקבוע פגישה', 'לתאם פגישה',
      'לקבוע', 'לתאם', 'להזמין', 'תור', 'פגישה'],
    RESCHEDULE: ['להזיז', 'תזיזו', 'להקדים', 'לדחות', 'לשנות את התור', 'לשנות תור',
      'להעביר את התור', 'להעביר תור', 'לשנות מועד', 'להחליף מועד', 'מועד אחר',
      'לשנות את השעה', 'לשנות שעה', 'זמן אחר', 'שעה אחרת', 'יום אחר'],
    CANCEL: ['לבטל', 'ביטול', 'בטל', 'בטלי', 'תבטלו', 'מבטל', 'מבטלת'],
    PRICE: ['כמה עולה', 'כמה זה עולה', 'כמה יעלה', 'מה המחיר', 'מה העלות',
      'מחיר', 'מחירים', 'מחירון', 'עלות', 'תעריף', 'תעריפים', 'עולה'],
    HOURS: ['שעות פעילות', 'שעות הפעילות', 'שעות פתיחה', 'שעות הפתיחה',
      'שעות קבלה', 'שעות הקבלה', 'מה השעות', 'מתי אתם פתוחים',
      'מתי פתוח', 'עד איזו שעה', 'עד איזה שעה', 'באילו שעות', 'באיזה שעות',
      'מתי עובדים', 'אתם עובדים', 'פתוחים', 'פתוח', 'פתוחה', 'סגור', 'סגורים'],
    // "עובדים עם X" זו שאלת שיתוף-פעולה (קופות/ביטוחים), לא שאלת שעות —
    // בלי ההחרגה "אתם עובדים עם כללית?" היה נתפס ב-'אתם עובדים' שמעל
    HOURS_EXCLUDE: ['עובדים עם'],
    HANDOFF: ['נציג', 'נציגה', 'נציג שירות', 'בן אדם', 'בנאדם', 'אנושי', 'אנושית',
      'ייצוג אנושי', 'יצוג אנושי', 'לדבר עם מישהו', 'לדבר עם בן אדם',
      'שיחה טלפונית', 'שיחת טלפון', 'תתקשרו אליי', 'תתקשרו אלי', 'שיתקשרו',
      'מנהל', 'מנהלת', 'בעלים', 'אדם אמיתי'],
    GREET: ['שלום', 'היי', 'הי', 'אהלן', 'הלו', 'בוקר טוב', 'ערב טוב',
      'צהריים טובים', 'מה נשמע', 'מה שלומך'],
    STOP: ['הסר', 'הסירו', 'להסיר', 'תסירו', 'הסרה'],
    START: ['התחל', 'להתחיל', 'חזרה', 'המשך'],
    YES: ['כן', 'אישור', 'מאשר', 'מאשרת', 'אשר', 'אוקיי', 'אוקי', 'בסדר',
      'סבבה', 'יאללה', 'מעולה', 'סגור', 'מתאים', 'לאשר', 'בטח', 'כמובן'],
    NO: ['לא', 'לא מתאים', 'עזוב', 'עזבי', 'לא תודה'],
    MORE: ['עוד', 'נוספים', 'אחרים', 'מאוחר יותר', 'מוקדם יותר', 'הבא'],
    // "אחר" ונטיותיו רק כטוקן מדויק (בלי קילוף קידומות) — אחרת "מאחר"
    // מקולף ל"אחר" ושאלת איחור באמצע בחירת מועד נבלעת כדפדוף
    MORE_EXACT: ['אחר', 'אחרת', 'אחרים', 'אחרות'],
    MY_BOOKING: ['מתי התור', 'התור שלי', 'איזה תור יש לי', 'פרטי התור',
      'מה המועד שלי', 'לאיזו שעה התור', 'באיזו שעה התור', 'יש לי תור'],
    SKIP: ['דלג', 'לדלג', 'דלגי', 'הבא', 'לא משנה', 'העדף לא', 'מעדיף לא', 'מעדיפה לא'],
    POLICY: ['מדיניות', 'ביטולים', 'ביטול', 'דמי ביטול', 'קנס'],
  };

  /** כוונת שעות פעילות — התאמה ל-KW.HOURS בלי אף ביטוי מוחרג. */
  function wantsHours(norm, tokens) {
    return !!textHasAny(norm, tokens, KW.HOURS) &&
      !textHasAny(norm, tokens, KW.HOURS_EXCLUDE);
  }

  /** התאמת טוקן מדויקת — בלי קילוף קידומות ובלי סיומות ריבוי. */
  function hasExactToken(tokens, kws) {
    for (var i = 0; i < tokens.length; i++) {
      if (kws.indexOf(tokens[i]) !== -1) return true;
    }
    return false;
  }

  // ==========================================================================
  //  3. גדרות ורטיקל — לא ניתנות לכיבוי או ריכוך דרך הטננט
  // ==========================================================================

  var MEDICAL_SYMPTOMS = [
    'כאב', 'כאבים', 'כואב', 'כואבת', 'כואבות', 'מציק', 'מציקה',
    'רגישות', 'רגיש', 'רגישה', 'דימום', 'מדמם', 'מדממת', 'נפיחות', 'נפוח',
    'נפוחה', 'התנפח', 'התנפחה', 'זיהום', 'דלקת', 'מוגלה', 'פצע', 'שבר',
    'נשבר', 'נשברה', 'שבור', 'שבורה', 'סדק', 'נסדק', 'נסדקה', 'פגוע',
    'פגועה', 'נפגע', 'נפגעה', 'סחרחורת', 'בחילה', 'בחילות', 'תסמין',
    'תסמינים', 'סימפטום', 'סימפטומים', 'אבחנה', 'לאבחן', 'תרופה', 'תרופות',
    'אנטיביוטיקה', 'מרשם', 'אקמול', 'נורופן', 'משכך', 'משככי', 'אלרגיה',
    'אלרגי', 'אלרגית', 'הריון', 'בהריון', 'מניקה', 'חום גבוה', 'יש לי חום',
    'מה לקחת', 'איזה כדור', 'זה מסוכן', 'האם זה מסוכן', 'זה נורמלי',
    'האם זה נורמלי', 'זה בסדר ש', 'מה לעשות עם', 'נפלה לי', 'נפל לי',
    'יצא לי', 'ירד לי', 'נשרה לי', 'התעוררתי עם', 'זה יעבור', 'מסוכן',
    'מי מלח', 'לשטוף', 'שטיפות', 'ריח רע', 'ריח מהפה', 'תרופת סבתא', 'טיפול ביתי',
  ];

  var LEGAL_ADVICE = [
    'יש לי קייס', 'יש לי תיק', 'יש לי עילה', 'עילה', 'קייס',
    'האם מגיע לי', 'מגיע לי פיצוי', 'מה הסיכויים', 'מה הסיכוי', 'סיכויי',
    'שווה לתבוע', 'כדאי לתבוע', 'אפשר לתבוע', 'לתבוע את', 'להגיש תביעה',
    'האם לחתום', 'כדאי לחתום', 'לחתום', 'מה אומר החוק', 'חוקי', 'חוקית',
    'מה החוק אומר', 'האם אני חייב', 'האם אני חייבת', 'יכולים לפטר',
    'מותר למעסיק', 'אסור למעסיק', 'מותר לו', 'מותר לה', 'מותר להם',
    'מבחינה משפטית', 'משפטית', 'עוול', 'זכויותיי', 'הזכויות שלי',
  ];

  var FITNESS_INJURY = [
    'פציעה', 'פציעות', 'נפצעתי', 'נקע', 'נקעתי', 'כאב גב', 'כאבי גב',
    'כאב ברך', 'כאבי ברכיים', 'פריצת דיסק', 'דלקת', 'מתיחה', 'נמתח',
    'כאב', 'כואב', 'כואבת', 'שבר', 'צליעה', 'צולע', 'צולעת', 'הריון', 'בהריון',
  ];

  /** אילו רשימות גדר חלות על כל ורטיקל, ואיזה משפט סירוב מוצג. */
  var GUARDRAILS = {
    dental: {
      keywords: MEDICAL_SYMPTOMS,
      decline: 'חשוב לי להגיד בכנות: אני לא יכול לתת ייעוץ רפואי בצ\'אט, ' +
        'ושאלות כאלה באמת מצריכות בדיקה של רופא.',
    },
    medical: {
      keywords: MEDICAL_SYMPTOMS,
      decline: 'חשוב לי להגיד בכנות: אני לא יכול לתת ייעוץ רפואי בצ\'אט, ' +
        'ושאלות כאלה באמת מצריכות בדיקה של רופא.',
    },
    aesthetics: {
      keywords: MEDICAL_SYMPTOMS,
      decline: 'אני לא יכול לתת ייעוץ רפואי או אסתטי בצ\'אט — התאמה של טיפול ' +
        'נקבעת רק בבדיקה מקצועית פנים אל פנים.',
    },
    legal: {
      keywords: LEGAL_ADVICE,
      decline: 'אני לא יכול לענות על שאלות משפטיות או להעריך סיכויי תיק בצ\'אט — ' +
        'הערכה כזאת דורשת שיחת ייעוץ עם עורך דין.',
    },
    fitness: {
      keywords: FITNESS_INJURY,
      decline: 'כשמדובר בכאב או בפציעה אני לא נותן עצות אימון בצ\'אט — ' +
        'הכי נכון שאיש מקצוע יראה אותך מקרוב לפני שממשיכים.',
    },
    general: { keywords: [], decline: null },
  };

  // ==========================================================================
  //  4. תאריכים ולוח זמנים
  // ==========================================================================

  var DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  var DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

  function toIsoLocal(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fromIsoLocal(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function parseHHMM(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
    return m ? { h: +m[1], m: +m[2] } : null;
  }

  function slotLongLabel(iso) {
    var d = fromIsoLocal(iso);
    return 'יום ' + DAY_NAMES[d.getDay()] + ' ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) +
      ' בשעה ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function slotButtonLabel(iso) {
    var d = fromIsoLocal(iso);
    return DAY_NAMES[d.getDay()] + ' ' + pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) +
      ' · ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // ==========================================================================
  //  5. ולידציית טננט — בדיקות ה-preflight מה-SKILL
  // ==========================================================================

  var MEDICAL_VERTICALS = ['dental', 'medical', 'aesthetics'];

  function validateTenant(tenant) {
    var errors = [];
    var warnings = [];
    if (!tenant || typeof tenant !== 'object') return { errors: ['הטננט אינו אובייקט JSON'], warnings: [] };

    if (!tenant.id) errors.push('חסר שדה id');
    if (!tenant.businessName) errors.push('חסר שדה businessName');
    if (!GUARDRAILS[tenant.vertical]) {
      errors.push('vertical לא מוכר: "' + tenant.vertical + '" (מותר: ' + Object.keys(GUARDRAILS).join('|') + ')');
    }
    if (!tenant.services || !tenant.services.length) errors.push('אין services — אין מה להזמין');
    (tenant.services || []).forEach(function (s) {
      if (!s.id || !s.name) errors.push('שירות בלי id או name');
      if (!s.durationMinutes) errors.push('לשירות "' + (s.name || s.id) + '" אין durationMinutes');
      if (s.price == null) warnings.push('לשירות "' + (s.name || s.id) + '" אין מחיר — שאלת מחיר תוסלם');
    });

    if (!tenant.hours) errors.push('חסר hours');
    else {
      DAY_KEYS.forEach(function (k) {
        var day = tenant.hours[k];
        if (day == null) { warnings.push('חסר יום ' + k + ' ב-hours (יטופל כסגור)'); return; }
        if (!Array.isArray(day)) { errors.push('hours.' + k + ' חייב להיות מערך טווחים'); return; }
        day.forEach(function (range) {
          if (!Array.isArray(range) || range.length !== 2 || !parseHHMM(range[0]) || !parseHHMM(range[1])) {
            errors.push('טווח לא תקין ב-hours.' + k + ': ' + JSON.stringify(range));
          }
        });
      });
      if (Array.isArray(tenant.hours.sat) && tenant.hours.sat.length) {
        errors.push('יש שעות בשבת (hours.sat) — אסור');
      }
    }

    if (MEDICAL_VERTICALS.indexOf(tenant.vertical) !== -1 && !tenant.priceDisclaimer) {
      errors.push('priceDisclaimer חובה בוורטיקל ' + tenant.vertical);
    }
    (tenant.closedDates || []).forEach(function (d) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) errors.push('closedDates: תאריך לא בפורמט YYYY-MM-DD: ' + d);
    });
    var phones = (tenant.escalation && tenant.escalation.notifyPhones) || [];
    if (!phones.length) warnings.push('escalation.notifyPhones ריק — אין לאן לשלוח התראות');
    phones.forEach(function (p) {
      if (!/^\d{10,15}$/.test(String(p))) errors.push('notifyPhones: "' + p + '" אינו E.164 בלי + (למשל 972501234567)');
    });
    if (tenant.calendar && tenant.calendar.provider && tenant.calendar.provider !== 'memory') {
      warnings.push('calendar.provider="' + tenant.calendar.provider + '" — בדמו נתמך רק memory, מתעלמים');
    }
    if (!tenant.faq || tenant.faq.length < 3) warnings.push('פחות מ-3 שאלות FAQ — הסוכן יסלים הרבה');
    return { errors: errors, warnings: warnings };
  }

  // ==========================================================================
  //  6. יצירת סוכן
  // ==========================================================================

  var STEPS = {
    IDLE: 'IDLE',
    AWAITING_SERVICE: 'AWAITING_SERVICE',
    AWAITING_SLOT: 'AWAITING_SLOT',
    AWAITING_NAME: 'AWAITING_NAME',
    AWAITING_QUAL: 'AWAITING_QUAL',
    AWAITING_CONFIRM: 'AWAITING_CONFIRM',
    AWAITING_RESLOT: 'AWAITING_RESLOT',
    AWAITING_RECONFIRM: 'AWAITING_RECONFIRM',
    AWAITING_CANCEL_CONFIRM: 'AWAITING_CANCEL_CONFIRM',
    HUMAN: 'HUMAN',
  };

  var STOPWORDS = ['מה', 'מי', 'איך', 'איפה', 'מתי', 'למה', 'האם', 'יש', 'אין',
    'של', 'את', 'אתם', 'אתן', 'אני', 'לי', 'זה', 'זו', 'על', 'עם', 'אם', 'או',
    'גם', 'כמה', 'אצלכם', 'שלכם', 'אפשר', 'בבקשה', 'רוצה', 'לדעת', 'שאלה',
    'הייתה', 'היה', 'אתמול', 'היום', 'מחר', 'לכם', 'לכן', 'הכי', 'עוד'];

  function createAgent(tenant, opts) {
    opts = opts || {};

    var check = validateTenant(tenant);
    if (check.errors.length) {
      throw new Error('קובץ הטננט לא תקין:\n- ' + check.errors.join('\n- '));
    }

    // שעון ניתן להזרקה — הסימולטור והבדיקות מקבעים אותו לקבלת מועדים דטרמיניסטיים
    var nowFn = typeof opts.now === 'function' ? opts.now
      : opts.now != null ? function () { return new Date(opts.now).getTime(); }
        : function () { return Date.now(); };

    var booking = tenant.booking || {};
    var minLeadMin = booking.minLeadTimeMinutes != null ? booking.minLeadTimeMinutes : 60;
    var bufferMin = booking.bufferMinutes != null ? booking.bufferMinutes : 0;
    var horizonDays = booking.horizonDays != null ? booking.horizonDays : 14;
    var maxSlots = booking.maxSlotsPerReply != null ? booking.maxSlotsPerReply : 6;

    var guardrail = GUARDRAILS[tenant.vertical];
    var extraBlocked = (tenant.guardrails && tenant.guardrails.extraBlockedTopics) || [];
    var extraTriggers = (tenant.escalation && tenant.escalation.extraTriggers) || [];
    var notifyPhones = (tenant.escalation && tenant.escalation.notifyPhones) || [];

    // ---- מצב בזיכרון בלבד (אין DB, אין רשת) ----
    var sessions = {};   // sessionId → session
    var bookings = [];   // כל התורים (active | cancelled)
    var alerts = [];     // התראות לצוות (handoff / escalation / trigger)
    var bookingSeq = 1000;
    var alertSeq = 0;

    function getSession(id) {
      if (!sessions[id]) {
        sessions[id] = {
          id: id, step: STEPS.IDLE, serviceId: null, slotIso: null,
          offered: [], slotOffset: 0, qualIndex: 0, name: null, answers: {},
          ctx: null, rescheduleBookingId: null, lastButtons: [], optedOut: false,
          greeted: false,
        };
      }
      return sessions[id];
    }

    function serviceById(id) {
      for (var i = 0; i < tenant.services.length; i++) {
        if (tenant.services[i].id === id) return tenant.services[i];
      }
      return null;
    }

    function defaultService() {
      return serviceById(booking.defaultServiceId) || tenant.services[0];
    }

    // ------------------------------------------------------------------
    //  לוח זמנים בזיכרון: גזירת מועדים פנויים משעות הפעילות של הטננט
    // ------------------------------------------------------------------

    function activeBookings(excludeId) {
      return bookings.filter(function (b) {
        return b.status === 'active' && b.id !== excludeId;
      });
    }

    function overlapsBooked(startMs, endMs, excludeId) {
      var list = activeBookings(excludeId);
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        var bStart = fromIsoLocal(b.slotIso).getTime();
        var bEnd = bStart + (b.durationMinutes + bufferMin) * 60000;
        if (startMs < bEnd && endMs > bStart) return true;
      }
      return false;
    }

    /**
     * כל המועדים הפתוחים לשירות, לפי שעות הטננט, בלי מועדים תפוסים.
     * skipIso — מועד להסתרה (בהעברת תור לא מציעים את המועד הנוכחי עצמו).
     */
    function listOpenSlots(serviceId, offset, limit, excludeBookingId, skipIso) {
      var svc = serviceById(serviceId) || defaultService();
      var dur = svc.durationMinutes;
      var stepMin = dur + bufferMin;
      var now = new Date(nowFn());
      var minStart = nowFn() + minLeadMin * 60000;
      var out = [];
      var need = offset + limit + 1; // אחד מעבר — כדי לדעת אם יש "עוד"

      for (var day = 0; day <= horizonDays && out.length < need; day++) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day);
        if ((tenant.closedDates || []).indexOf(dateKey(d)) !== -1) continue;
        var ranges = (tenant.hours && tenant.hours[DAY_KEYS[d.getDay()]]) || [];
        for (var r = 0; r < ranges.length && out.length < need; r++) {
          var from = parseHHMM(ranges[r][0]);
          var to = parseHHMM(ranges[r][1]);
          if (!from || !to) continue;
          var t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), from.h, from.m);
          var endOfRange = new Date(d.getFullYear(), d.getMonth(), d.getDate(), to.h, to.m).getTime();
          while (t.getTime() + dur * 60000 <= endOfRange && out.length < need) {
            var startMs = t.getTime();
            var endMs = startMs + stepMin * 60000;
            if (startMs >= minStart && !overlapsBooked(startMs, endMs, excludeBookingId)) {
              var iso = toIsoLocal(t);
              if (iso !== skipIso) out.push(iso);
            }
            t = new Date(startMs + stepMin * 60000);
          }
        }
      }
      return {
        slots: out.slice(offset, offset + limit),
        hasMore: out.length > offset + limit,
      };
    }

    // ------------------------------------------------------------------
    //  לידים והתראות
    // ------------------------------------------------------------------

    function leadScore(session) {
      var score = 0;
      (tenant.qualification || []).forEach(function (q) {
        var ans = session.answers[q.id];
        if (!ans) return;
        var normAns = normalize(ans);
        var hit = (q.highValueAnswers || []).some(function (hv) {
          return normAns.indexOf(normalize(hv)) !== -1;
        });
        if (hit) score += q.weight || 1;
      });
      return score;
    }

    function pushAlert(type, session, message) {
      alertSeq += 1;
      var alert = {
        id: 'ALR-' + alertSeq,
        type: type, // 'handoff' | 'escalation' | 'trigger'
        sessionId: session.id,
        customerName: session.name || null,
        message: message,
        notifyPhones: notifyPhones.slice(),
        at: toIsoLocal(new Date(nowFn())),
      };
      alerts.push(alert);
      return alert;
    }

    // ------------------------------------------------------------------
    //  בניית תשובות
    // ------------------------------------------------------------------

    function reply(text, buttons, extra) {
      var r = { text: text, buttons: buttons || [] };
      if (extra) for (var k in extra) r[k] = extra[k];
      return r;
    }

    function menuButtons() {
      return [
        { id: 'menu:book', title: 'קביעת תור 📅' },
        { id: 'menu:prices', title: 'מחירון 💰' },
        { id: 'menu:hours', title: 'שעות פעילות 🕘' },
      ];
    }

    function formatPrice(svc) {
      if (svc.price == null) return null;
      return typeof svc.price === 'number' ? svc.price + ' ₪' : String(svc.price);
    }

    function priceListText() {
      var lines = tenant.services
        .filter(function (s) { return s.price != null; })
        .map(function (s) { return '• ' + s.name + ' — ' + formatPrice(s); });
      var text = 'המחירון של ' + tenant.businessName + ':\n' + lines.join('\n');
      if (tenant.priceDisclaimer) text += '\n\n' + tenant.priceDisclaimer;
      return text;
    }

    function hoursText() {
      var lines = DAY_KEYS.map(function (k, i) {
        var ranges = (tenant.hours && tenant.hours[k]) || [];
        if (!ranges.length) return 'יום ' + DAY_NAMES[i] + ': סגור';
        var parts = ranges.map(function (r) { return r[0] + '–' + r[1]; });
        return 'יום ' + DAY_NAMES[i] + ': ' + parts.join(', ');
      });
      return 'שעות הפעילות של ' + tenant.businessName + ':\n' + lines.join('\n');
    }

    // ------------------------------------------------------------------
    //  זרימת קביעת תור
    // ------------------------------------------------------------------

    function startBooking(session, serviceId) {
      session.ctx = 'book';
      session.slotOffset = 0;
      if (!serviceId && tenant.services.length > 1) {
        session.step = STEPS.AWAITING_SERVICE;
        var buttons = tenant.services.slice(0, 6).map(function (s) {
          return { id: 'svc:' + s.id, title: s.name };
        });
        return reply('בשמחה! לאיזה טיפול לקבוע תור?', buttons);
      }
      session.serviceId = serviceId || tenant.services[0].id;
      return offerSlots(session, null);
    }

    /** מציג עמוד מועדים ככפתורים. prefix — טקסט שמקדים את הרשימה (למשל סירוב גדר). */
    function offerSlots(session, prefix) {
      var svc = serviceById(session.serviceId) || defaultService();
      session.serviceId = svc.id;
      var excludeId = session.ctx === 'reschedule' ? session.rescheduleBookingId : null;
      var currentIso = null;
      if (excludeId) {
        bookings.forEach(function (b) { if (b.id === excludeId) currentIso = b.slotIso; });
      }
      var page = listOpenSlots(svc.id, session.slotOffset, maxSlots, excludeId, currentIso);

      if (!page.slots.length && session.slotOffset > 0) {
        // נגמרו העמודים — חוזרים לעמוד הראשון
        session.slotOffset = 0;
        page = listOpenSlots(svc.id, 0, maxSlots, excludeId, currentIso);
      }
      if (!page.slots.length) {
        pushAlert('escalation', session, 'אין מועדים פנויים להצעה (' + svc.name + ')');
        return reply(
          'לא מצאתי כרגע מועד פנוי ל' + svc.name + ' ביומן. 🙏\n' +
          'העברתי את הפנייה לצוות של ' + tenant.businessName + ' — יחזרו אליך עם מועד בהקדם.',
          [{ id: 'handoff', title: 'דברו איתי 🙋' }]
        );
      }

      session.offered = page.slots;
      session.step = session.ctx === 'reschedule' ? STEPS.AWAITING_RESLOT : STEPS.AWAITING_SLOT;

      var head = session.ctx === 'reschedule'
        ? 'לאיזה מועד להעביר את התור?'
        : 'אלו המועדים הקרובים ל' + svc.name + ' (' + svc.durationMinutes + ' דק\'):';
      var text = (prefix ? prefix + '\n\n' : '') + head + '\nאפשר ללחוץ על מועד או להשיב במספר.';

      var buttons = page.slots.map(function (iso) {
        return { id: 'slot:' + iso, title: slotButtonLabel(iso) };
      });
      if (page.hasMore) buttons.push({ id: 'more', title: 'מועדים נוספים ⏩' });
      return reply(text, buttons);
    }

    function chooseSlot(session, iso) {
      session.slotIso = iso;
      if (session.ctx === 'reschedule') {
        session.step = STEPS.AWAITING_RECONFIRM;
        return reply(
          'להעביר את התור ל' + slotLongLabel(iso) + '?',
          [{ id: 'reconfirm', title: 'כן, להעביר ✔' }, { id: 'keep', title: 'לא, להשאיר' }]
        );
      }
      if (!session.name) {
        session.step = STEPS.AWAITING_NAME;
        return reply('מעולה, שמרתי את ' + slotLongLabel(iso) + '. על שם מי לרשום את התור? (שם מלא)');
      }
      return nextQualOrConfirm(session);
    }

    function nextQualOrConfirm(session) {
      var quals = tenant.qualification || [];
      while (session.qualIndex < quals.length) {
        var q = quals[session.qualIndex];
        if (session.answers[q.id] == null) {
          session.step = STEPS.AWAITING_QUAL;
          var buttons = q.required ? [] : [{ id: 'skip', title: 'דלג ⏭' }];
          return reply(q.question, buttons);
        }
        session.qualIndex += 1;
      }
      return confirmSummary(session);
    }

    function confirmSummary(session) {
      var svc = serviceById(session.serviceId) || defaultService();
      session.step = STEPS.AWAITING_CONFIRM;
      return reply(
        'רגע לפני שסוגרים:\n' +
        '• ' + svc.name + '\n' +
        '• ' + slotLongLabel(session.slotIso) + '\n' +
        '• על שם: ' + session.name + '\n' +
        'לאשר את התור?',
        [
          { id: 'confirm', title: 'אישור ✔' },
          { id: 'changeslot', title: 'מועד אחר' },
          { id: 'abort', title: 'ביטול' },
        ]
      );
    }

    /** המועד עלול להיתפס בין ההצעה לאישור (או דרך כפתור ישן) — בודקים שוב. */
    function slotStillFree(session, excludeBookingId) {
      var svc = serviceById(session.serviceId) || defaultService();
      var startMs = fromIsoLocal(session.slotIso).getTime();
      var endMs = startMs + (svc.durationMinutes + bufferMin) * 60000;
      return !overlapsBooked(startMs, endMs, excludeBookingId);
    }

    function slotTakenReoffer(session) {
      session.slotOffset = 0;
      return offerSlots(session,
        'אוי, המועד הזה בדיוק נתפס. 🙏 אלו המועדים שעדיין פנויים:');
    }

    function finalizeBooking(session) {
      if (!slotStillFree(session, null)) return slotTakenReoffer(session);
      var svc = serviceById(session.serviceId) || defaultService();
      bookingSeq += 1;
      var b = {
        id: 'APT-' + bookingSeq,
        sessionId: session.id,
        serviceId: svc.id,
        serviceName: svc.name,
        durationMinutes: svc.durationMinutes,
        slotIso: session.slotIso,
        customerName: session.name,
        answers: JSON.parse(JSON.stringify(session.answers)),
        status: 'active',
        createdAt: toIsoLocal(new Date(nowFn())),
      };
      bookings.push(b);
      session.step = STEPS.IDLE;
      session.ctx = null;
      var text = '✅ התור נקבע!\n' +
        '• ' + svc.name + '\n' +
        '• ' + slotLongLabel(b.slotIso) + '\n' +
        '• על שם: ' + b.customerName + '\n' +
        '• מס\' אסמכתא: ' + b.id;
      if (svc.prep) text += '\n\nלתשומת לבך: ' + svc.prep;
      var info = tenant.extraInfo || {};
      if (info.address) text += '\n\n📍 איך מגיעים: ' + info.address;
      text += '\n\nאפשר לכתוב לי "לשנות תור" או "לבטל תור" בכל שלב.';
      return reply(text);
    }

    function latestActiveBooking(session) {
      for (var i = bookings.length - 1; i >= 0; i--) {
        if (bookings[i].sessionId === session.id && bookings[i].status === 'active') {
          return bookings[i];
        }
      }
      return null;
    }

    function startReschedule(session) {
      var b = latestActiveBooking(session);
      if (!b) {
        return reply('לא מצאתי תור פעיל על השיחה הזאת. רוצה לקבוע תור חדש?',
          [{ id: 'menu:book', title: 'קביעת תור 📅' }]);
      }
      session.ctx = 'reschedule';
      session.rescheduleBookingId = b.id;
      session.serviceId = b.serviceId;
      session.slotOffset = 0;
      return offerSlots(session,
        'אין בעיה, נעביר את התור (' + b.serviceName + ', ' + slotLongLabel(b.slotIso) + ').');
    }

    function finalizeReschedule(session) {
      var b = null;
      for (var i = 0; i < bookings.length; i++) {
        if (bookings[i].id === session.rescheduleBookingId) b = bookings[i];
      }
      if (!b || b.status !== 'active') {
        session.step = STEPS.IDLE; session.ctx = null;
        return reply('התור המקורי כבר לא פעיל. רוצה לקבוע תור חדש?',
          [{ id: 'menu:book', title: 'קביעת תור 📅' }]);
      }
      if (!slotStillFree(session, b.id)) return slotTakenReoffer(session);
      var oldLabel = slotLongLabel(b.slotIso);
      b.slotIso = session.slotIso;
      b.updatedAt = toIsoLocal(new Date(nowFn()));
      session.step = STEPS.IDLE;
      session.ctx = null;
      session.rescheduleBookingId = null;
      return reply(
        '🔁 התור עודכן!\n' +
        '• במקום ' + oldLabel + '\n' +
        '• נקבע ל' + slotLongLabel(b.slotIso) + '\n' +
        '• מס\' אסמכתא: ' + b.id
      );
    }

    function startCancel(session) {
      var b = latestActiveBooking(session);
      if (!b) {
        return reply('לא מצאתי תור פעיל לביטול. אפשר לעזור במשהו אחר?', menuButtons());
      }
      session.step = STEPS.AWAITING_CANCEL_CONFIRM;
      session.rescheduleBookingId = b.id;
      return reply(
        'לבטל את התור?\n• ' + b.serviceName + '\n• ' + slotLongLabel(b.slotIso) + '\n• מס\' אסמכתא: ' + b.id,
        [{ id: 'cancel:confirm', title: 'כן, לבטל' }, { id: 'cancel:keep', title: 'לא, להשאיר' }]
      );
    }

    function finalizeCancel(session) {
      var b = null;
      for (var i = 0; i < bookings.length; i++) {
        if (bookings[i].id === session.rescheduleBookingId) b = bookings[i];
      }
      session.step = STEPS.IDLE;
      session.rescheduleBookingId = null;
      if (!b || b.status !== 'active') return reply('התור כבר לא פעיל.');
      b.status = 'cancelled';
      b.cancelledAt = toIsoLocal(new Date(nowFn()));
      var text = '❌ התור בוטל.\n• ' + b.serviceName + '\n• ' + slotLongLabel(b.slotIso);
      text += '\n\nאם מתחשק מועד חדש — אפשר לכתוב "לקבוע תור" בכל רגע. 🙂';
      return reply(text);
    }

    function abortFlow(session) {
      session.step = STEPS.IDLE;
      session.ctx = null;
      session.slotIso = null;
      session.rescheduleBookingId = null;
      return reply('בסדר גמור, עצרנו את התהליך. אפשר לעזור במשהו אחר?', menuButtons());
    }

    // ------------------------------------------------------------------
    //  גדרות, נציג והסלמות
    // ------------------------------------------------------------------

    function guardrailReply(session) {
      var decline = guardrail.decline;
      if (tenant.guardrails && tenant.guardrails.extraDecline) {
        decline += '\n' + tenant.guardrails.extraDecline;
      }
      var svc = defaultService();
      session.ctx = 'book';
      session.serviceId = svc.id;
      session.slotOffset = 0;
      var offerHead = 'מה שכן — אשמח לקבוע לך ' + svc.name + ' אצל ' + tenant.businessName +
        ', ושם יטפלו בזה כמו שצריך.';
      return offerSlots(session, decline + '\n' + offerHead);
    }

    function handoffReply(session, sourceText) {
      session.step = STEPS.HUMAN;
      var alert = pushAlert('handoff', session, sourceText);
      return reply(
        'כמובן. העברתי את השיחה לצוות של ' + tenant.businessName +
        ' — נציג אנושי יחזור אליך כאן בהקדם. 🙋\n' +
        'ההודעות הבאות שלך יגיעו ישירות לצוות.',
        [{ id: 'resume', title: 'חזרה לבוט 🤖' }],
        { alert: alert }
      );
    }

    function escalateUnknown(session, text) {
      var alert = pushAlert('escalation', session, text);
      return reply(
        'אני לא בטוח שאדע לענות על זה כמו שצריך, אז אני מעביר את השאלה לצוות של ' +
        tenant.businessName + ' — יחזרו אליך כאן בהקדם. 🙏\n' +
        'בינתיים אפשר:',
        menuButtons().concat([{ id: 'handoff', title: 'נציג אנושי 🙋' }]),
        { alert: alert }
      );
    }

    // ------------------------------------------------------------------
    //  זיהוי שירות, FAQ ושאלות מידע
    // ------------------------------------------------------------------

    function findServiceInText(norm, tokens) {
      var best = null;
      var bestLen = 0;
      tenant.services.forEach(function (svc) {
        var names = [svc.name].concat(svc.aliases || []);
        names.forEach(function (n) {
          var kn = normalize(n);
          if (!kn) return;
          var hit = kn.indexOf(' ') !== -1
            ? norm.indexOf(kn) !== -1
            : tokens.some(function (t) { return wordHit(t, kn); });
          if (hit && kn.length > bestLen) { best = svc; bestLen = kn.length; }
        });
      });
      return best;
    }

    /** FAQ מהטננט + ערכי מידע נגזרים מ-extraInfo (עדיפות נמוכה יותר). */
    function effectiveFaq() {
      var list = (tenant.faq || []).slice();
      var info = tenant.extraInfo || {};
      if (info.address) list.push({
        q: 'איך מגיעים?', answer: info.address,
        tags: ['כתובת', 'איפה', 'להגיע', 'הגעה', 'מיקום', 'חניה', 'חנייה', 'חניון'],
      });
      if (info.paymentMethods) list.push({
        q: 'אמצעי תשלום', answer: info.paymentMethods,
        tags: ['תשלום', 'תשלומים', 'אשראי', 'מזומן', 'ביט'],
      });
      if (info.insurance) list.push({
        q: 'ביטוח וקופות', answer: info.insurance,
        tags: ['ביטוח', 'קופה', 'קופת', 'קופות', 'התחייבות'],
      });
      if (info.cancellationPolicy) list.push({
        q: 'מדיניות ביטולים', answer: info.cancellationPolicy,
        tags: ['מדיניות', 'ביטולים', 'קנס'],
      });
      return list;
    }

    function faqMatch(norm, tokens) {
      var best = null;
      var bestScore = 0;
      effectiveFaq().forEach(function (entry) {
        var score = 0;
        (entry.tags || []).forEach(function (tag) {
          if (textHasKeyword(norm, tokens, normalize(tag))) score += 2;
        });
        tokenize(entry.q).forEach(function (w) {
          if (STOPWORDS.indexOf(w) !== -1) return;
          if (tokens.some(function (t) { return wordHit(t, w) || wordHit(w, t); })) score += 1;
        });
        if (score > bestScore) { best = entry; bestScore = score; }
      });
      return bestScore >= 2 ? best : null;
    }

    // ------------------------------------------------------------------
    //  טיפול בלחיצת כפתור
    // ------------------------------------------------------------------

    function handleButton(session, id, rawTitle) {
      if (id === 'resume') {
        session.step = STEPS.IDLE;
        return reply('חזרנו! 🙂 איך אפשר לעזור?', menuButtons());
      }
      if (session.step === STEPS.HUMAN) return humanModeReply(session);

      if (id === 'menu:book') return startBooking(session, null);
      if (id === 'menu:prices') return reply(priceListText(), [{ id: 'menu:book', title: 'קביעת תור 📅' }]);
      if (id === 'menu:hours') return reply(hoursText(), [{ id: 'menu:book', title: 'קביעת תור 📅' }]);
      if (id === 'handoff') return handoffReply(session, rawTitle || 'בקשת נציג (כפתור)');
      if (id === 'reschedule:start') return startReschedule(session);
      if (id === 'cancel:start') return startCancel(session);
      if (id.indexOf('svc:') === 0) {
        session.ctx = session.ctx || 'book';
        session.serviceId = id.slice(4);
        session.slotOffset = 0;
        return offerSlots(session, null);
      }
      if (id.indexOf('book:svc:') === 0) {
        session.ctx = 'book';
        return startBooking(session, id.slice(9));
      }
      if (id.indexOf('slot:') === 0) {
        var iso = id.slice(5);
        if (session.step === STEPS.AWAITING_SLOT || session.step === STEPS.AWAITING_RESLOT) {
          return chooseSlot(session, iso);
        }
        // כפתור ישן — מתחילים קביעה נקייה עם המועד המבוקש אם עדיין פנוי
        session.ctx = session.ctx || 'book';
        return chooseSlot(session, iso);
      }
      if (id === 'more') {
        session.slotOffset += maxSlots;
        return offerSlots(session, null);
      }
      if (id === 'skip') {
        if (session.step === STEPS.AWAITING_QUAL) {
          var q = (tenant.qualification || [])[session.qualIndex];
          if (q) session.answers[q.id] = '(דילג)';
          session.qualIndex += 1;
          return nextQualOrConfirm(session);
        }
        return fallbackForStep(session);
      }
      if (id === 'confirm' && session.step === STEPS.AWAITING_CONFIRM) return finalizeBooking(session);
      if (id === 'changeslot') { session.step = STEPS.AWAITING_SLOT; return offerSlots(session, null); }
      if (id === 'abort') return abortFlow(session);
      if (id === 'reconfirm' && session.step === STEPS.AWAITING_RECONFIRM) return finalizeReschedule(session);
      if (id === 'keep' && session.step === STEPS.AWAITING_RECONFIRM) {
        session.step = STEPS.IDLE; session.ctx = null;
        return reply('בסדר גמור, התור נשאר במועד המקורי. 🙂', menuButtons());
      }
      if (id === 'cancel:confirm' && session.step === STEPS.AWAITING_CANCEL_CONFIRM) return finalizeCancel(session);
      if (id === 'cancel:keep' && session.step === STEPS.AWAITING_CANCEL_CONFIRM) {
        session.step = STEPS.IDLE;
        return reply('מעולה, התור נשאר על כנו. 🙂', menuButtons());
      }
      return fallbackForStep(session);
    }

    function humanModeReply(session) {
      return reply(
        'ההודעה הועברה לצוות של ' + tenant.businessName + ' — אנחנו כבר לא במצב בוט. 🙋\n' +
        'אם רוצים לחזור אליי בינתיים:',
        [{ id: 'resume', title: 'חזרה לבוט 🤖' }]
      );
    }

    function fallbackForStep(session) {
      switch (session.step) {
        case STEPS.AWAITING_SERVICE:
          return reply('לא זיהיתי את הטיפול. אפשר לבחור מהכפתורים:',
            tenant.services.slice(0, 6).map(function (s) { return { id: 'svc:' + s.id, title: s.name }; }));
        case STEPS.AWAITING_SLOT:
        case STEPS.AWAITING_RESLOT:
          return offerSlots(session, 'לא זיהיתי את המועד, הנה האפשרויות שוב:');
        case STEPS.AWAITING_NAME:
          return reply('אשמח לשם מלא (לפחות 2 תווים) כדי לרשום את התור. 🙏');
        case STEPS.AWAITING_QUAL:
          return nextQualOrConfirm(session);
        case STEPS.AWAITING_CONFIRM:
          return confirmSummary(session);
        case STEPS.AWAITING_RECONFIRM:
          return reply('להעביר את התור ל' + slotLongLabel(session.slotIso) + '?',
            [{ id: 'reconfirm', title: 'כן, להעביר ✔' }, { id: 'keep', title: 'לא, להשאיר' }]);
        case STEPS.AWAITING_CANCEL_CONFIRM:
          return reply('לבטל את התור? אפשר להשיב כן או לא.',
            [{ id: 'cancel:confirm', title: 'כן, לבטל' }, { id: 'cancel:keep', title: 'לא, להשאיר' }]);
        default:
          return null;
      }
    }

    // ------------------------------------------------------------------
    //  טיפול בטקסט לפי השלב הנוכחי בזרימה
    // ------------------------------------------------------------------

    function matchOfferedSlot(session, norm, tokens) {
      // מספר סידורי מתוך הרשימה
      for (var i = 0; i < tokens.length; i++) {
        if (/^\d{1,2}$/.test(tokens[i])) {
          var n = parseInt(tokens[i], 10);
          if (n >= 1 && n <= session.offered.length) return session.offered[n - 1];
        }
      }
      // שעה מפורשת ("ב-9:00", "16:00")
      var tm = /(\d{1,2}):(\d{2})/.exec(norm);
      if (tm) {
        var hh = pad2(+tm[1]) + ':' + tm[2];
        for (var j = 0; j < session.offered.length; j++) {
          if (session.offered[j].slice(11) === hh) return session.offered[j];
        }
      }
      // שם יום ("ביום רביעי")
      for (var d = 0; d < DAY_NAMES.length; d++) {
        if (norm.indexOf(DAY_NAMES[d]) !== -1) {
          for (var k = 0; k < session.offered.length; k++) {
            if (fromIsoLocal(session.offered[k]).getDay() === d) return session.offered[k];
          }
        }
      }
      return null;
    }

    function hasStrongIntent(norm, tokens) {
      return !!(textHasAny(norm, tokens, KW.PRICE) || textHasAny(norm, tokens, KW.CANCEL) ||
        textHasAny(norm, tokens, KW.RESCHEDULE) || wantsHours(norm, tokens) ||
        textHasAny(norm, tokens, KW.BOOK));
    }

    function handleStepText(session, raw, norm, tokens) {
      switch (session.step) {
        case STEPS.AWAITING_SERVICE: {
          var svc = findServiceInText(norm, tokens);
          if (svc) { session.serviceId = svc.id; session.slotOffset = 0; return offerSlots(session, null); }
          return null;
        }
        case STEPS.AWAITING_SLOT:
        case STEPS.AWAITING_RESLOT: {
          var iso = matchOfferedSlot(session, norm, tokens);
          if (iso) return chooseSlot(session, iso);
          if (textHasAny(norm, tokens, KW.MORE) || hasExactToken(tokens, KW.MORE_EXACT)) {
            session.slotOffset += maxSlots;
            return offerSlots(session, null);
          }
          return null;
        }
        case STEPS.AWAITING_NAME: {
          if (hasStrongIntent(norm, tokens)) return null; // שיטופל גלובלית
          var name = raw.replace(/^(קוראים לי|שמי|השם שלי|אני)\s+/u, '').trim();
          var soloYesNo = tokens.length === 1 &&
            (KW.YES.indexOf(norm) !== -1 || KW.NO.indexOf(norm) !== -1);
          if (name.length < 2 || /^\d+$/.test(name) || soloYesNo) {
            return reply('אשמח לשם מלא (לפחות 2 תווים) כדי לרשום את התור. 🙏');
          }
          session.name = name;
          return nextQualOrConfirm(session);
        }
        case STEPS.AWAITING_QUAL: {
          var q = (tenant.qualification || [])[session.qualIndex];
          if (!q) return nextQualOrConfirm(session);
          if (!q.required && textHasAny(norm, tokens, KW.SKIP)) {
            session.answers[q.id] = '(דילג)';
            session.qualIndex += 1;
            return nextQualOrConfirm(session);
          }
          if (hasStrongIntent(norm, tokens) && tokens.length > 2) return null;
          session.answers[q.id] = raw.trim();
          session.qualIndex += 1;
          return nextQualOrConfirm(session);
        }
        case STEPS.AWAITING_CONFIRM: {
          if (textHasAny(norm, tokens, KW.YES)) return finalizeBooking(session);
          if (textHasAny(norm, tokens, KW.NO) || textHasAny(norm, tokens, KW.RESCHEDULE)) {
            session.step = STEPS.AWAITING_SLOT;
            return offerSlots(session, 'אין בעיה, נבחר מועד אחר:');
          }
          return null;
        }
        case STEPS.AWAITING_RECONFIRM: {
          if (textHasAny(norm, tokens, KW.YES)) return finalizeReschedule(session);
          if (textHasAny(norm, tokens, KW.NO)) {
            session.step = STEPS.IDLE; session.ctx = null;
            return reply('בסדר גמור, התור נשאר במועד המקורי. 🙂', menuButtons());
          }
          return null;
        }
        case STEPS.AWAITING_CANCEL_CONFIRM: {
          if (textHasAny(norm, tokens, KW.YES)) return finalizeCancel(session);
          if (textHasAny(norm, tokens, KW.NO)) {
            session.step = STEPS.IDLE;
            return reply('מעולה, התור נשאר על כנו. 🙂', menuButtons());
          }
          return null;
        }
        default:
          return null;
      }
    }

    /** אחרי מענה גלובלי באמצע זרימה — מזכירים איפה היינו. */
    function stepReprompt(session) {
      var r = fallbackForStep(session);
      return r;
    }

    var inBookingFlow = [STEPS.AWAITING_SERVICE, STEPS.AWAITING_SLOT, STEPS.AWAITING_NAME,
      STEPS.AWAITING_QUAL, STEPS.AWAITING_CONFIRM, STEPS.AWAITING_RESLOT, STEPS.AWAITING_RECONFIRM];

    // ------------------------------------------------------------------
    //  נקודת הכניסה
    // ------------------------------------------------------------------

    /**
     * input: מחרוזת חופשית או {text, buttonId, buttonTitle}
     * מחזיר {text, buttons: [{id,title}], alert?}
     */
    function handleMessage(sessionId, input) {
      var session = getSession(sessionId);
      var raw = '';
      var buttonId = null;
      var buttonTitle = null;
      if (typeof input === 'string') raw = input;
      else if (input && typeof input === 'object') {
        raw = input.text || '';
        buttonId = input.buttonId || null;
        buttonTitle = input.buttonTitle || null;
      }

      var out;
      if (buttonId) {
        out = handleButton(session, buttonId, buttonTitle);
      } else {
        out = handleText(session, String(raw));
      }
      session.lastButtons = (out && out.buttons) || [];
      return out;
    }

    function handleText(session, raw) {
      var norm = normalize(raw);
      var tokens = norm.split(' ').filter(Boolean);
      if (!norm) return reply('לא הגיעה הודעה. איך אפשר לעזור?', menuButtons());

      // מספר בודד = לחיצה על כפתור מהתשובה האחרונה
      if (/^\d{1,2}$/.test(norm) && session.lastButtons.length) {
        var n = parseInt(norm, 10);
        if (n >= 1 && n <= session.lastButtons.length) {
          var btn = session.lastButtons[n - 1];
          return handleButton(session, btn.id, btn.title);
        }
      }

      // ---- הסרה מרשימת תפוצה ----
      if (session.optedOut) {
        if (textHasAny(norm, tokens, KW.START)) {
          session.optedOut = false;
          return reply('חזרנו! 🙂 איך אפשר לעזור?', menuButtons());
        }
        return reply('הוסרת מרשימת התפוצה ולא יישלחו עוד הודעות. כדי לחזור, אפשר לכתוב "התחל".');
      }
      if (textHasAny(norm, tokens, KW.STOP)) {
        session.optedOut = true;
        session.step = STEPS.IDLE;
        return reply('בוצע — הוסרת מרשימת התפוצה ולא יישלחו עוד הודעות. כדי לחזור, אפשר לכתוב "התחל". 🙏');
      }

      // ---- נציג אנושי — עובד מכל מצב ----
      if (textHasAny(norm, tokens, KW.HANDOFF)) return handoffReply(session, raw);

      // ---- במצב אנושי הבוט שותק ----
      if (session.step === STEPS.HUMAN) {
        if (textHasAny(norm, tokens, KW.START)) {
          session.step = STEPS.IDLE;
          return reply('חזרנו! 🙂 איך אפשר לעזור?', menuButtons());
        }
        return humanModeReply(session);
      }

      // ---- גדרות ורטיקל — לפני כל דבר אחר, בכל שלב ----
      // בשלבי איסוף נתונים (שם / שאלות סינון) אזכור סימפטום הוא תשובה לשמירה,
      // לא בקשת עצה — הגדר נבדקת שם רק אם הטקסט נראה כמו שאלת ייעוץ.
      // בכל מקרה הסוכן לעולם לא עונה תוכן רפואי/משפטי — אין נתיב כזה בקוד.
      var dataEntryStep = session.step === STEPS.AWAITING_NAME || session.step === STEPS.AWAITING_QUAL;
      var guardrailApplies = !dataEntryStep || looksLikeAdviceQuestion(raw, norm, tokens);
      if (guardrailApplies) {
        if (guardrail.keywords.length && textHasAny(norm, tokens, guardrail.keywords)) {
          return guardrailReply(session);
        }
        for (var bi = 0; bi < extraBlocked.length; bi++) {
          if (norm.indexOf(normalize(extraBlocked[bi])) !== -1) return guardrailReply(session);
        }
      }

      // ---- טריגרים של הסלמה מהטננט ----
      for (var ti = 0; ti < extraTriggers.length; ti++) {
        if (norm.indexOf(normalize(extraTriggers[ti])) !== -1) {
          return handoffReply(session, raw);
        }
      }

      // ---- המשך זרימה פעילה ----
      var stepOut = handleStepText(session, raw, norm, tokens);
      if (stepOut) return stepOut;

      // ---- כוונות גלובליות ----
      var globalOut = handleGlobalIntent(session, raw, norm, tokens);
      if (globalOut) {
        // אם באמצע זרימה ענינו על שאלה צדדית — מזכירים את השלב
        if (inBookingFlow.indexOf(session.step) !== -1 && !globalOut.buttons.length) {
          var re = stepReprompt(session);
          if (re) {
            return reply(globalOut.text + '\n\n' + re.text, re.buttons);
          }
        }
        return globalOut;
      }

      // ---- באמצע זרימה ולא הבנו — חוזרים על השאלה של השלב ----
      var re2 = fallbackForStep(session);
      if (re2) return re2;

      // ---- לא יודעים לענות: מסלימים במקום להמציא ----
      return escalateUnknown(session, raw);
    }

    function handleGlobalIntent(session, raw, norm, tokens) {
      var svc = findServiceInText(norm, tokens);

      // מחיר — לפני קביעת תור ("כמה עולה תור?")
      if (textHasAny(norm, tokens, KW.PRICE)) {
        if (svc && svc.price != null) {
          var text = svc.name + ' — ' + formatPrice(svc) +
            ' (משך הטיפול כ-' + svc.durationMinutes + ' דק\').';
          if (tenant.priceDisclaimer) text += '\n' + tenant.priceDisclaimer;
          return reply(text, [
            { id: 'book:svc:' + svc.id, title: 'לקבוע ' + svc.name },
            { id: 'menu:prices', title: 'כל המחירון 💰' },
          ]);
        }
        return reply(priceListText(), [{ id: 'menu:book', title: 'קביעת תור 📅' }]);
      }

      // שינוי מועד לפני ביטול לפני קביעה (חפיפת מילים)
      if (textHasAny(norm, tokens, KW.RESCHEDULE) && session.step === STEPS.IDLE) {
        if (latestActiveBooking(session) || !textHasAny(norm, tokens, KW.BOOK)) {
          return startReschedule(session);
        }
      }
      if (textHasAny(norm, tokens, KW.CANCEL)) {
        if (textHasAny(norm, tokens, KW.POLICY)) {
          var faqPol = faqMatch(norm, tokens);
          if (faqPol) return reply(faqPol.answer);
        }
        if (inBookingFlow.indexOf(session.step) !== -1) return abortFlow(session);
        return startCancel(session);
      }
      // "מתי התור שלי?" — פרטי התור הקיים, לא פתיחת הזמנה חדשה
      if (textHasAny(norm, tokens, KW.MY_BOOKING)) {
        var mine = latestActiveBooking(session);
        if (mine) {
          return reply(
            'התור הקרוב שלך:\n• ' + mine.serviceName + '\n• ' + slotLongLabel(mine.slotIso) +
            '\n• על שם: ' + mine.customerName + '\n• מס\' אסמכתא: ' + mine.id,
            [
              { id: 'reschedule:start', title: 'לשנות מועד 🔁' },
              { id: 'cancel:start', title: 'לבטל תור ❌' },
            ]
          );
        }
        return reply('לא מצאתי תור פעיל על השיחה הזאת. רוצה לקבוע אחד?',
          [{ id: 'menu:book', title: 'קביעת תור 📅' }]);
      }

      if (textHasAny(norm, tokens, KW.BOOK)) {
        return startBooking(session, svc ? svc.id : null);
      }

      if (wantsHours(norm, tokens)) {
        return reply(hoursText(), [{ id: 'menu:book', title: 'קביעת תור 📅' }]);
      }

      var faq = faqMatch(norm, tokens);
      if (faq) {
        return reply(faq.answer, session.step === STEPS.IDLE
          ? [{ id: 'menu:book', title: 'קביעת תור 📅' }] : []);
      }

      // שאלה על שירות בלי מילת מחיר ("יש לכם הלבנה?")
      if (svc && session.step === STEPS.IDLE) {
        var t = svc.name + ' — בהחלט! משך הטיפול כ-' + svc.durationMinutes + ' דק\'';
        if (svc.price != null) t += ', עלות ' + formatPrice(svc);
        t += '.';
        if (tenant.priceDisclaimer && svc.price != null) t += '\n' + tenant.priceDisclaimer;
        return reply(t, [{ id: 'book:svc:' + svc.id, title: 'לקבוע ' + svc.name }]);
      }

      if (textHasAny(norm, tokens, KW.GREET) && tokens.length <= 4) {
        session.greeted = true;
        return reply(
          'שלום! 👋 הגעת ל' + tenant.businessName + '.\n' +
          'אפשר לקבוע תור, לברר מחירים ושעות פעילות, או לשאול אותי כל דבר על ' +
          tenant.businessName + '. איך אפשר לעזור?',
          menuButtons()
        );
      }

      return null;
    }

    // ------------------------------------------------------------------
    //  מצב לתצוגה (סימולטור + פאנל "מאחורי הקלעים")
    // ------------------------------------------------------------------

    function getState() {
      var leads = [];
      Object.keys(sessions).forEach(function (sid) {
        var s = sessions[sid];
        if (!s.name && !Object.keys(s.answers).length) return;
        var score = leadScore(s);
        leads.push({
          sessionId: sid,
          name: s.name,
          answers: s.answers,
          score: score,
          hot: score >= 2,
          bookings: bookings.filter(function (b) { return b.sessionId === sid; })
            .map(function (b) { return b.id; }),
        });
      });
      return {
        tenantId: tenant.id,
        businessName: tenant.businessName,
        bookings: bookings.map(function (b) {
          return {
            id: b.id, service: b.serviceName, slotIso: b.slotIso,
            slotLabel: slotLongLabel(b.slotIso), name: b.customerName,
            status: b.status, answers: b.answers,
          };
        }),
        leads: leads,
        alerts: alerts.slice(),
      };
    }

    return {
      tenant: tenant,
      handleMessage: handleMessage,
      getState: getState,
      listOpenSlots: listOpenSlots,
      validation: check,
    };
  }

  return {
    version: VERSION,
    createAgent: createAgent,
    validateTenant: validateTenant,
    normalize: normalize,
    GUARDRAILS: GUARDRAILS,
    STEPS: STEPS,
  };
});
