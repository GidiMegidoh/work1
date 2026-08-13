# CLAUDE.md

## Project

**whatsapp-appointment-bot** — demo Hebrew-language WhatsApp bot for booking medical clinic appointments (Twilio + Express, JSON-file storage, no database).

## Tech stack

- Node.js, CommonJS (`"type": "commonjs"`), no build step, no TypeScript
- Express 4, Twilio SDK 5, dotenv
- No devDependencies

## Commands

| Action | Command |
|---|---|
| Install | `npm install` |
| Run | `npm start` (runs `node bot.js`) |
| Dev (watch mode) | `npm run dev` (runs `node --watch bot.js`) |
| CLI demo (no Twilio) | `npm run demo` (runs `node demo-cli.js`) |
| Build | none — plain Node, nothing to build |
| Lint | unknown — ask user (no linter configured) |
| Test | unknown — ask user (no test script or framework configured) |

Quick manual check without Twilio: `curl -X POST http://localhost:3000/simulate -H "Content-Type: application/json" -d '{"phone":"whatsapp:+9725...","message":"שלום"}'`

## Architecture

- **`bot.js` is the entire app** (~530 lines), organized into 9 numbered, commented sections: config → JSON-file "DB" → hardcoded slots → Hebrew intent detection → message templates → outbound send → conversation state machine → Express routes → startup.
- **Core function:** `handleIncomingMessage(phone, rawText)` — HTTP-agnostic, exported, and reused by `demo-cli.js`. State machine steps: `IDLE → AWAITING_NAME → AWAITING_SLOT → AWAITING_CONFIRM`; CANCEL/HELP intents short-circuit at any step.
- **State:** sessions in an in-memory `Map` keyed by `whatsapp:+…` phone; appointments in `data/appointments.json`, fully rewritten on every save (`fs.writeFileSync`). Both are demo-grade: sessions never expire, reminders are `setTimeout`s lost on restart.
- **Demo mode:** the Twilio client is only constructed if both `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set; otherwise outbound messages print to the console. Most code paths are testable with zero credentials.
- **Routes:** `POST /whatsapp` (Twilio webhook, replies TwiML), `POST /simulate` (JSON test endpoint, bypasses signature validation), `GET /appointments`, `GET /` (health).

## Gotchas

- **Everything is in Hebrew** — user-facing strings, code comments, commit messages. Keep user-facing message strings in Hebrew and match the existing bilingual comment style.
- **Hebrew regex:** `\b` word boundaries are ASCII-only and DO NOT work with Hebrew text. The code deliberately uses whole-token comparison (`parseYesNo`) and substring matching (`detectIntent`) instead — don't "simplify" back to `\b`. `normalize()` strips niqqud (`[֑-ׇ]`) first.
- **Intent detection is substring-based with priority CANCEL → HELP → BOOK → GREET**, so keyword collisions are real (e.g. `'תור'` matches inside longer words). Test intent changes against the demo CLI.
- **`loadAppointments()` runs at module load** (outside the `require.main` guard), so merely requiring `bot.js` does disk I/O and logs. `app.listen` is guarded — importing the module doesn't start the server.
- **`demo-cli.js` deliberately uses `for await (const line of rl)`** instead of `rl.question` callbacks so piped stdin doesn't drop lines — keep it that way.
- Appointment IDs are `APT-` + 4 random digits — collision-prone by design (demo); there is no slot locking or dedup.

## Safety — ask before doing

- **Do not commit or expose `.env`** or real Twilio credentials; `.env` and `data/appointments.json` are gitignored — keep them that way.
- **Ask before deleting or rewriting `data/appointments.json`** (it's the entire "database").
- **Ask before sending real outbound WhatsApp messages** (anything requiring real Twilio credentials) — messages go to real phones and may incur Twilio charges.
- **Ask before disabling `VALIDATE_TWILIO_SIGNATURE` handling or exposing new unauthenticated endpoints** — `/appointments` already leaks patient names/phones unauthenticated; don't widen that surface.
- **Ask before force-pushing or history rewrites** — the repo's branches share a single root commit; be conservative.
- No migrations exist (no DB), but if persistent storage is ever introduced, treat schema/data changes as ask-first.
