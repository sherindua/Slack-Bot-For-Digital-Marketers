
## SlackBot – Quick Start (Socket Mode)

### 1) Create a Slack app

- Go to `https://api.slack.com/apps` → Create New App → From scratch.
- Basic Info → Enable Socket Mode.
- Generate an App-Level Token with scope `connections:write` → copy token (starts with `xapp-`).

### 2) Add bot token scopes

- OAuth & Permissions → Scopes (Bot Token Scopes):
  - `app_mentions:read`
  - `chat:write`
  - `files:read` (for CSV downloads)
- Install the app to your workspace → copy Bot User OAuth Token (starts with `xoxb-`).

### 3) Subscribe to events

- Event Subscriptions → Enable Events.
- Subscribe to Bot Events: `app_mention`.
  - Also add: `file_shared`

### 3.1) Add slash command `/keywords`

- Slash Commands → Create New Command:
  - Command: `/keywords`
  - Short description: Clean and list keywords
  - Usage hint: `[comma or newline separated keywords]`
  - Request URL: Socket Mode apps don’t need a public URL; leave blank. When testing in Socket Mode, add the command in your app and reinstall; Slack routes it via the WebSocket.

### 4) Configure environment variables

- Copy `.env.example` to `.env` and set your values:
  - `SLACK_APP_TOKEN` = your `xapp-...`
  - `SLACK_BOT_TOKEN` = your `xoxb-...`
  - `SLACK_LOG_LEVEL` = `INFO` (optional)
  - `PORT` = `3000` (or any)

### 5) Install and run

```bash
npm install
npm run start
```

The bot runs in Socket Mode and listens for `@mention` events. Mention the bot and paste comma/newline separated keywords to see cleaned output.

### Dev workflow

- `npm run dev` to auto-restart on changes in `dist/`.
- TypeScript is available; if you add `src/` TypeScript files, compile with `npm run build` to output into `dist/`.

### Supabase & pgvector (optional but recommended)

- Create a Supabase project and enable the `vector` extension.
- Add env vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
- Minimal schema includes `batches` and `keywords` with `embedding vector(384)`.
- The app will detect env and, when present, embed keywords with a local model and insert rows.

