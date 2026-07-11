# VERIFICATION QUEUE — human tasks, in dependency order

Each item: what to do (exact commands/clicks), what SHOULD happen, and which
build-step *done-when* it closes. Work top to bottom; later items depend on
earlier ones. Machine-provable parts are already proven in all-summaries.md.

*(populated as steps land)*

## 1. Register the GitHub App (closes step 3 live setup)
1. github.com → Settings → Developer settings → GitHub Apps → New GitHub App.
2. Name: `tripwire-dev-<your-suffix>`. Homepage: `https://tripwire.sh` (any).
3. Webhook URL: leave placeholder for now (item 2 sets it). Webhook secret:
   generate one (`openssl rand -hex 32`) and put it in `.env` as
   `GITHUB_WEBHOOK_SECRET` (copy `.env.example` → `.env`).
4. Permissions (§13.3): Pull requests **Read & write** · Checks **Read &
   write** · Contents **Read-only** · Metadata **Read-only**.
5. Subscribe to events: **Pull request**, **Issue comment**. (Push comes free
   with contents; optional now.)
6. Create the App → note App ID → `.env` `GITHUB_APP_ID`. Generate a private
   key (.pem) → paste PEM into `.env` `GITHUB_APP_PRIVATE_KEY` (keep newlines,
   quote it).
7. Install the App on a **scratch repo** you own.
SHOULD HAPPEN: App exists, installed on scratch repo, `.env` filled.

## 2. Tunnel + webhook URL (closes step 3 done-when, first half)
1. `docker compose up -d postgres && bun run db:migrate`
2. `cd apps/api && bun run src/index.ts` (starts on :8787)
3. `cloudflared tunnel --url http://localhost:8787` → copy the
   `https://<random>.trycloudflare.com` URL.
4. GitHub App settings → Webhook URL = `https://<random>.trycloudflare.com/webhooks/github` → save.
SHOULD HAPPEN: GitHub "ping" delivery shows 200 in Advanced → Recent Deliveries.

## 3. PR ⇒ one events row; redelivery ⇒ still one (closes step 3 done-when)
1. Open a PR on the scratch repo.
2. `docker exec tripwire-postgres psql -U tripwire -d tripwire -c "select delivery_id, raw_kind, kind from events;"`
   SHOULD HAPPEN: exactly one row for the PR delivery.
3. GitHub App → Advanced → Recent Deliveries → the pull_request delivery →
   Redeliver.
4. Re-run the query. SHOULD HAPPEN: still exactly one row (response says
   `"duplicate": true`).
5. Afterwards, capture the real delivery as a fixture:
   `/capture-fixture <delivery_id>` — replaces the octokit-sourced fixtures
   with our own App's captures.

## 4. Live event list — PR appears without refresh (closes step 4 done-when)
Prereqs: items 1–3 done; postgres up; `.env` filled.
1. Terminal A: `cd apps/api && bun run src/index.ts`
2. Terminal B: `cd apps/worker && bun run src/index.ts`
3. Terminal C: `bun run dev` → open http://localhost:3000/events
4. Terminal D: cloudflared tunnel running (item 2).
5. Open a new PR (or push to an open one) on the scratch repo.
SHOULD HAPPEN: the event row appears at the top of /events within ~2s,
no refresh — first end-to-end proof.

## 5. MVP heartbeat — sockpuppet PR blocked, merge button dead (closes step 7 done-when)
Prereqs: items 1–4. Use a second GitHub account (or ask a friend) whose
account is <7 days old OR temporarily set the default account-age threshold
higher than your account's age.
1. api + worker + tunnel running (`.env` fully filled — worker needs
   GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY; set APP_URL=http://localhost:3000).
2. Scratch repo → Settings → Branches → protect `main` → require status
   checks → search for and require `tripwire` (it appears after the first
   check run reports).
3. Open a PR from the sockpuppet account.
SHOULD HAPPEN: a `tripwire` check appears pending during evaluation, then
fails; ONE comment: "**tripwire: blocked** — N of M rules failed; merge is
held." with the view-run badge; the merge button is dead.
4. Push a new commit to the same PR.
SHOULD HAPPEN: the comment is EDITED (same comment, no second one); a fresh
`tripwire` check appears on the new SHA.
5. `/capture-fixture` the deliveries afterwards.

## 6. GitHub OAuth app + sign-in (closes step 8 auth done-when)
1. github.com → Settings → Developer settings → OAuth Apps → New OAuth App.
   Homepage: http://localhost:3000 · Authorization callback URL:
   http://localhost:3000/api/auth/callback/github
2. `.env`: set GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET, and
   BETTER_AUTH_SECRET (`openssl rand -hex 32`), BETTER_AUTH_URL=http://localhost:3000.
3. Restart api + web (`bun run dev`); open http://localhost:3000.
SHOULD HAPPEN: you are redirected to /login; "continue with github" completes
OAuth and lands you back on the queue; `select * from forge_identities;` shows
your GitHub identity; user.id is a UUIDv7, no GitHub id anywhere else.
4. Open a run page from a real blocked run (item 5's badge link).
SHOULD HAPPEN: verdict chip, per-rule step cards with evidence JSON, actions
list all render from run_steps.
