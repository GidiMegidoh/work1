# שיבוץ — סוכן WhatsApp בעברית לקביעת תורים

סוכן שיחה מרובה־טננטים שקורא קובץ קונפיגורציה של עסק (`tenants/<slug>.json`)
ומנהל את כל השיחה בעברית: מחירים, קביעת תור, שינוי, ביטול, שאלות נפוצות,
והסלמה לנציג אנושי. בנוי ללא תלויות, עם **אולפן דמו** שמקים דמו מלא ללקוח
פוטנציאלי בפחות מ־5 דקות.

> מצב נוכחי: **מוכן לעלייה לאוויר** — יש שרת חי (`server/`) עם WhatsApp
> Cloud API ו-Google Calendar, שממתין רק לאישור החשבון של Meta. נתיב הדמו
> (`npm run sim` / `npm run demo`) נשאר כשהיה: יומן בזיכרון ואפס קריאות
> רשת (יש בדיקה שאוכפת את זה). ההוראות המלאות: [עלייה לאוויר](#-עלייה-לאוויר).

---

## ⚡ התחלה מהירה

```bash
npm run sim test-dental        # שיחה עם הסוכן בטרמינל
npm run demo:new demo-dental   # הקמת טננט דמו חדש (בלי עריכה ידנית)
npm run demo demo-dental       # נגן צ'אט + אתר עסק בדפדפן (localhost:3000)
npm test                       # 6 בדיקות הקבלה + שומר הרשת
```

בסימולטור: כתבו הודעה חופשית, מספר = לחיצה על כפתור, `/state` = מצב הדמו
(תורים, לידים, התראות), `exit` = יציאה.

---

## 🧠 איך הסוכן עובד (`src/core/agent.js`)

מודול JavaScript טהור, בלי תלויות ובלי I/O — אותו קובץ רץ ב־Node
(סימולטור) ובדפדפן (נגן הדמו). כל מה שהסוכן אומר מגיע מקובץ הטננט;
כשאין תשובה — הוא **מסלים לאדם, לא ממציא**.

סדר עדיפויות הכוונות (זהו חוזה המוצר):

1. `הסר` / חזרה
2. בקשת **נציג אנושי** (נציג, בן אדם, ייצוג אנושי…) → העברה + התראת SMS
3. **גדרות ורטיקל** — שאלת סימפטום (רפואי/שיניים/אסתטיקה), "יש לי קייס?"
   (משפטי), פציעה (כושר) → סירוב מנומס + הצעת תור. לא ניתן לכיבוי מהטננט.
4. טריגרי הסלמה מהטננט (`escalation.extraTriggers`)
5. המשך זרימה פעילה (בחירת מועד, שם, שאלות סינון, אישור)
6. מחיר (עם `priceDisclaimer`) → קביעה / שינוי / ביטול → שעות → FAQ → ברכה
7. ברירת מחדל: הסלמה לצוות + התראה

חריג מכוון בגדרות: בשלבי איסוף נתונים (שם/שאלות סינון), אזכור סימפטום
("כאב בשן קדמית" כתשובה ל"מה הסיבה לפנייה?") נשמר כנתון וממשיך את
הזרימה. שאלת ייעוץ ("מה כדאי לקחת?") נחסמת גם שם. בשום נתיב בקוד אין
תוכן רפואי/משפטי.

יומן: `calendar.provider = "memory"` — המועדים נגזרים מ־`hours` של הטננט,
בניכוי `closedDates`, `minLeadTimeMinutes` ומועדים שכבר נתפסו בדמו.

## 🎬 אולפן הדמו

- `npm run demo:new <slug> [vertical]` — יוצר `tenants/<slug>.json` מ־preset
  מלא של הוורטיקל (`src/presets/`: dental, medical, aesthetics, legal,
  fitness, general). הוורטיקל מזוהה גם מה־slug (`demo-dental` → dental).
- `npm run demo <slug>` — בונה את `demo/sites/<slug>/` ומגיש אותו מקומית:
  - `index.html` — אתר עסק שנוצר מהטננט (שירותים, מחירים, שעות, FAQ) עם
    בועת צ'אט צפה.
  - `chat.html` — נגן צ'אט בסגנון WhatsApp (RTL, מובייל 390×844) עם פאנל
    **"מאחורי הקלעים"**: לידים + ניקוד, תורים והתראות — מה שהעסק ירוויח.
- הסוכן רץ בדפדפן, כך שכל טאב הוא שיחה מבודדת, והאתר שנוצר ניתן לאירוח
  סטטי בכל מקום. הקריאה היחידה לרשת: טעינת `tenant.json`.

## 🗂 קונפיגורציית טננט

`tenants/_template.json` הוא הסכמה + דוגמה מלאה. השדות המרכזיים:

| שדה | תפקיד |
|---|---|
| `vertical` | קובע את גדרות הבטיחות (רפואי/משפטי/כושר) |
| `hours` | `sun`–`sat`, מערך טווחים לכל יום, ריק = סגור, לעולם לא בשבת |
| `services[].aliases` | מה שלקוחות באמת מקלידים — מניע את זיהוי השירות |
| `priceDisclaimer` | חובה ב־dental/medical/aesthetics, מוצג אחרי כל מחיר |
| `faq[]` | תשובות במילים של הלקוח + `tags` שמניעים את ההתאמה |
| `qualification[]` | שאלות סינון; `weight`+`highValueAnswers` מדרגים לידים |
| `escalation` | `notifyPhones` (E.164 בלי +) ו־`extraTriggers` |
| `terminology` | אופציונלי — מינוח לא־קליני: `appointmentNoun`/`serviceNoun` + מגדר (`m`/`f`) להטיות. Veltrum למשל: פגישה/שיחה במקום תור/טיפול |
| `calendar` | `provider`: `memory` (דמו) או `google` (חי, עם `calendarId` ו־`additionalBusyCalendars`) |
| `whatsapp.phoneNumberId` | מזהה המספר מ־WhatsApp Manager — המפתח שמנתב הודעות נכנסות לטננט |

תהליך ההטמעה המלא: `.claude/skills/shibutz-onboard-client/SKILL.md`.

## 🔌 השרת החי (`server/`)

שרת HTTP ללא תלויות (Node מובנה בלבד) שמחבר את הליבה ל-WhatsApp Cloud API
ול-Google Calendar. הליבה נשארת טהורה — כל ה-I/O בשרת:

- `POST /webhook/whatsapp` — הודעות נכנסות. **כל בקשה בלי חתימת
  `X-Hub-Signature-256` תקפה נדחית ב-403.** ההודעה עוברת לסוכן והתשובה
  נשלחת חזרה (טקסט / עד 3 כפתורים / רשימת מועדים).
- `GET /webhook/whatsapp` — אתגר האימות של Meta (`hub.challenge`).
- יומן: לפני כל הודעה נטענים הטווחים התפוסים מהיומן (`freeBusy`, כולל
  `additionalBusyCalendars`), ואחרי קביעה/העברה/ביטול נכתב האירוע ליומן.
- מצב נשמר ב-`data/state-<tenant>.json` אחרי כל הודעה — ריסטרט לא מאבד
  שיחות, תורים או את מיפוי אירועי היומן.
- `docker compose kill -s HUP shibutz` — טעינת קבצי טננטים מחדש בלי להפיל
  את השרת ובלי לאבד שיחות פעילות.
- **מצב DRY-RUN:** כל עוד אין `WHATSAPP_TOKEN` — אף הודעה לא נשלחת;
  ה-payload המדויק שהיה נשלח נרשם ללוג. ככה בונים ובודקים לפני אישור Meta.
- ממשק ניהול בסוד יחיד (`ADMIN_SECRET`): `POST /admin/reload`,
  `POST /admin/calendar-check`, `POST /admin/dry-run`, ו-`GET /health` פתוח
  ל-healthcheck.

```bash
npm run server                        # מקומית (או: docker compose up -d)
npm run check-calendar shibutz        # "בדיקת יומן" — קריאה+כתיבה ליומן הטננט
```

## 🚀 עלייה לאוויר

הצ'קליסט המחייב מול המספר החי: `assets/GO-LIVE.md`. אלו הצעדים הטכניים,
בסדר ביצוע — סעיפים 1–2 אפשר (וכדאי) לעשות עוד לפני שהחשבון של Meta אושר:

**1. הכנה (לא תלוי ב-Meta):**

```bash
cp .env.example .env
openssl rand -hex 24     # → ADMIN_SECRET
openssl rand -hex 24     # → WHATSAPP_VERIFY_TOKEN (מחרוזת שאתם ממציאים)
```

**2. יומן Google (לא תלוי ב-Meta):**

1. [console.cloud.google.com](https://console.cloud.google.com) → פרויקט חדש →
   מפעילים את **Google Calendar API** → Service Accounts → יוצרים חשבון →
   Keys → Add key → **JSON**.
2. את תוכן ה-JSON מדביקים ב-`.env` → `GOOGLE_SERVICE_ACCOUNT_JSON` (שורה
   אחת), או שומרים כקובץ ומפנים אליו ב-`GOOGLE_SERVICE_ACCOUNT_FILE`.
3. הלקוח משתף את היומן שלו עם כתובת ה-`client_email` של חשבון השירות:
   הגדרות היומן → *Share with specific people* → הרשאת
   **"Make changes to events"**.
4. בקובץ הטננט: `calendar.provider="google"` + `calendar.calendarId`
   (ליומן הראשי של חשבון gmail זו פשוט כתובת המייל).
5. מריצים מול הלקוח על הקו: `npm run check-calendar shibutz` — חייב לצאת
   ירוק על קריאה, כתיבה וכל יומן busy נוסף.

**3. ביום שהחשבון מאושר (Meta):**

| מה | מאיפה | לאן |
|---|---|---|
| App Secret | developers.facebook.com → האפליקציה → App Settings → Basic | `.env` → `WHATSAPP_APP_SECRET` |
| טוקן קבוע | business.facebook.com → System Users → Generate Token (הרשאת `whatsapp_business_messaging`) | `.env` → `WHATSAPP_TOKEN` |
| Phone number ID | WhatsApp Manager → Phone numbers | `.env` → `WHATSAPP_PHONE_NUMBER_ID` **וגם** `tenants/shibutz.json` → `whatsapp.phoneNumberId` |

**4. הרמה וחיבור ה-webhook:**

```bash
docker compose up -d --build
docker compose logs -f shibutz   # מוודאים: "מצב שליחה: חי", הטננט פעיל
```

ה-webhook חייב HTTPS ציבורי. שתי דרכים פשוטות למפעיל יחיד:
[Caddy](https://caddyserver.com) כ-reverse proxy עם דומיין (שתי שורות
Caddyfile), או [cloudflared tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
בלי לפתוח פורטים. אחר כך בלוח של Meta: האפליקציה → WhatsApp →
Configuration → Webhook → **Callback URL** =
`https://<הדומיין>/webhook/whatsapp`, **Verify token** = הערך של
`WHATSAPP_VERIFY_TOKEN` → Verify and save → נרשמים לשדה **messages**.

**5. בדיקות חיות:** מריצים שורה-שורה את `assets/GO-LIVE.md` מול המספר
החי, מסמנים וחותמים.

**עדכון טננט אחרי העלייה:** עורכים את `tenants/<slug>.json` ואז
`docker compose kill -s HUP shibutz` — בלי downtime, השיחות נשמרות.

## ✅ בדיקות

```bash
npm test
```

- `test/run-probes.js` — 6 בדיקות הקבלה, מורצות מול `npm run sim` אמיתי
  עם שעון מקובע; תמלילים נשמרים ב־`test/transcripts/`.
- `test/network-guard.js` — מנטר את כל נקודות היציאה לרשת של Node, מריץ
  את כל התרחישים ואוכף אפס ניסיונות חיבור + היעדר אזכורים ל־
  graph.facebook.com / googleapis / hebcal / twilio בקוד הדמו (`src/`,
  `demo/` — השרת החי יושב בכוונה ב-`server/`, מחוץ לתחום הסריקה).
- `test/live-infra.js` — התשתית החיה עם רשת מדומה: תיקוני הרגרסיות, אימות
  חתימות (403/200), סינון מועדים תפוסים מיומן google, כתיבת
  אירועים (יצירה/עדכון/מחיקה), כפילויות משלוח, ריסטרט ו-SIGHUP.

## 📂 מבנה

```
src/core/agent.js               ← ליבת הסוכן (איזומורפי, ללא תלויות, בלי I/O)
src/cli/sim.js                  ← סימולטור טרמינל
src/cli/demo-new.js             ← הקמת טננט דמו
src/cli/demo-serve.js           ← בנייה + הגשה של אתר הדמו
src/demo/build-site.js          ← מחולל האתר הסטטי
src/presets/                    ← preset מלא לכל ורטיקל
server/index.js                 ← השרת החי: webhook ↔ סוכן ↔ יומן
server/lib/whatsapp.js          ← Cloud API: חתימות, פירוק, שליחה, DRY-RUN
server/lib/google-calendar.js   ← service account, freeBusy, אירועים
server/lib/state.js             ← שמירת מצב אטומית ל-data/
server/cli/check-calendar.js    ← "בדיקת יומן" מול לקוח
tenants/                        ← קונפיגורציות טננטים (_template.json = סכמה)
assets/GO-LIVE.md               ← צ'קליסט העלייה לאוויר של Veltrum
demo/sites/<slug>/              ← פלט סטטי לאירוח
data/                           ← מצב חי (לא בקומיט)
test/                           ← בדיקות קבלה + שומר רשת + תשתית חיה
```

## ⚠️ מה בכוונה לא כאן (עדיין)

מסד נתונים (המצב בקובץ JSON — מספיק ל-3–5 לקוחות ראשונים), דשבורד
רב־משתמשים, שליחת SMS וניטור — נבנים כשיש הכנסה שמצדיקה אותם. הוספת טננט
לעולם לא דורשת שינוי קוד; אם נדמה שכן — זו באגה במוצר.
