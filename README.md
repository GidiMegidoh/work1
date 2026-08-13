# WhatsApp Appointment Bot

A demo WhatsApp bot for booking medical clinic appointments, in Hebrew. Patients message the clinic's WhatsApp number, and the bot walks them through a short conversation — name → time slot → confirmation — then books the appointment and schedules a reminder message.

Built as a demo: appointments live in a JSON file, time slots are hardcoded, and the whole thing runs without any Twilio credentials in a local "demo mode".

## What it does

- Understands Hebrew free-text intents (book / cancel / help / greeting) via keyword matching, with niqqud stripping and Hebrew number-word parsing ("אחת", "שתיים"…)
- Runs a per-user conversation state machine: `IDLE → AWAITING_NAME → AWAITING_SLOT → AWAITING_CONFIRM → booked`
- Books into one of four hardcoded slots (two doctors) and persists to `data/appointments.json`
- Sends a delayed reminder message after booking (1 minute by default, for demo purposes)
- Works with the Twilio WhatsApp Sandbox for real WhatsApp messages, or entirely offline via a CLI/HTTP simulator

## Tech stack

- **Runtime:** Node.js (CommonJS)
- **Web server:** Express 4
- **WhatsApp/SMS:** Twilio SDK 5 (WhatsApp Sandbox; TwiML replies inbound, REST API for reminders)
- **Config:** dotenv
- **Storage:** flat JSON file (`data/appointments.json`) + in-memory session `Map` — no database

## Getting started

```bash
npm install
cp .env.example .env   # optional — everything has defaults
npm start              # or: npm run dev (auto-restart on file changes)
```

### Try it without Twilio

No credentials needed — without them the bot runs in demo mode and prints outbound messages to the console.

Interactive terminal chat:

```bash
npm run demo
```

Or simulate a WhatsApp message over HTTP:

```bash
curl -X POST http://localhost:3000/simulate \
  -H "Content-Type: application/json" \
  -d '{"phone": "whatsapp:+972500000000", "message": "שלום"}'
```

### Connect real WhatsApp (Twilio Sandbox)

1. Create a Twilio account and open the WhatsApp Sandbox (Messaging → Try it out → Send a WhatsApp message).
2. Join the sandbox from your phone by sending the join code to the sandbox number (+1 415 523 8886).
3. Put your `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` in `.env`.
4. Expose your local server: `npx ngrok http 3000`.
5. Set the sandbox webhook ("When a message comes in") to `https://<your-ngrok-domain>/whatsapp`, method POST.
6. `npm start` and message the sandbox number from WhatsApp.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/whatsapp` | Twilio webhook — incoming WhatsApp messages (returns TwiML) |
| POST | `/simulate` | Test endpoint — JSON in/out, no Twilio needed |
| GET | `/appointments` | List booked appointments |
| GET | `/` | Health check (Twilio connection status, counts) |

## Configuration

All variables are optional and documented in `.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | — | Twilio credentials; without them the bot runs in demo mode |
| `TWILIO_WHATSAPP_NUMBER` | `whatsapp:+14155238886` | Sender number (sandbox default) |
| `PORT` | `3000` | HTTP port |
| `CLINIC_NAME` | `מרפאת ד"ר כהן` | Clinic name used in messages |
| `REMINDER_DELAY_MS` | `60000` | Delay before the reminder message |
| `VALIDATE_TWILIO_SIGNATURE` | `false` | Verify webhook signatures (requires `PUBLIC_URL`) |
| `PUBLIC_URL` | — | Public base URL, needed only for signature validation |

## Project layout

```
bot.js         # The entire application: config, storage, Hebrew intent
               # detection, message templates, conversation state machine,
               # Express server. Organized into 9 numbered sections.
demo-cli.js    # Terminal REPL that drives the same state machine directly
               # (imports handleIncomingMessage from bot.js) — no HTTP, no Twilio.
data/          # Created at runtime; appointments.json lives here (gitignored).
.env.example   # Documented template for all environment variables.
```

To change the available appointment slots, edit `AVAILABLE_SLOTS` in `bot.js`.

## Demo limitations

This is a demo, not a production system. Notably missing: a real database (a crash loses sessions; reminders are lost on restart since they're plain `setTimeout`s), slot locking (any number of patients can book the same slot), authentication on `/appointments` and `/simulate`, and medical-data privacy handling. Webhook signature validation exists but is off by default.
