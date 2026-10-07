# KJ Agentic Command Center

A team of AI agents that runs several small businesses from the cloud, and a 3D trading floor where you watch them work.

- **Worker** (Railway, runs 24/7): the agents, the task queue, the approval executor, webhooks, the 7:30 AM text.
- **Database** (Supabase): every task, workflow, approval, order, ledger row and event.
- **Command center** (Vercel, static site): the trading floor, the panels, and every control.

Your computer isn't involved once it's set up.

## What's on the floor

| Area | What you see |
|---|---|
| **Executive Office** (elevated glass office) | The **Big Boss Manager**, which is the existing Executive Orchestrator (agent `manager`), plus CEO agents once a brand earns a promotion. It has a briefing (now, since your last visit, money, blocked, needs approval, plan on record) and **Talk to the Big Boss**, which answers only from your records. The Big Boss can't approve, spend, or change permissions. |
| **Desk clusters** | One per business: Agency, Sports, Etsy, Dropshipping, Real Estate, Brands/Social/Video, Ventures, Customers, Finance, Risk & Ops. Every agent has a desk with a status light, a status screen and a tag. |
| **Five display walls** | Business performance, Sales activity, Commerce & fulfillment, Content operations, Attention required. Click a wall to expand it. Pipeline is always labeled as not revenue. |
| **Ticker** | Recorded events only. Duplicates are collapsed and routine progress is hidden by default. Filter by business, priority or type. Click any item to open its record. |

**Statuses** (always shown as icon + text + color): ▶ Working · ◷ Scheduled · ⇄ Waiting on another agent · ⧗ Waiting on a customer or provider · ! Needs approval · ✕ Blocked or failed · – Idle · Ⅱ Paused.

Each status comes from the database. An agent shows **Working** only while its task row is running. **Handoff lines** are drawn only from `handoff` rows the worker writes when a workflow changes owner. The headset animation appears only during a connected, consented AI call, never for a drafted script. In-depth: `dashboard/js/floor-model.js`.

**Click a desk** to see:
- the assignment, its purpose, and who or what it involves
- start time, latest update, completed and remaining steps
- sources and outputs
- task results and costs
- dependencies, the next scheduled action, and the recommendation as recorded

Controls on the desk: approve or edit, pause the agent, retry a failed task, reassign the workflow, open or pause the workflow.

**View modes** (top of the floor): Live Floor (F) · Money (M) · Workflow (W) · Customer (C) · Content Studio (V) · Approvals (A) · System Health (H).

**Command bar** (`/`): type things like "show blocked orders", "open today's calls", "pause dropship", or "what changed". Anything else goes to the Big Boss as a question. Commands use the same controls and approvals as the buttons.

Other shortcuts: E = Executive Office, G = All Agents monitor, T = today's timeline, 1–0 = stations, P = pause all, Esc = back/close.

You can also save camera views, lock the camera, and choose the display: 3D full, 3D simplified, or 2D cards (the default on phones). Sound alerts are off by default. `?demo` shows an isolated sample floor where nothing is real or sent.

**Nothing irreversible happens without your approval.** Emails, offers, launches and posts wait in Approvals. Standing approvals (campaigns, fulfillment rules, content scope) let routine actions run inside the exact limits you approved. Editing anything after approval sends it back for re-approval.

---

## Setup

### 1. Supabase (database)

1. Create a project at supabase.com.
2. In **SQL Editor → New query**, run these files **in order**, one query each. Each is safe to run again.
   1. `supabase/schema.sql`
   2. `supabase/002_command_center.sql` (approval safety, workflows, money, commerce). **Approved emails won't send until this has run.**
   3. `supabase/003_dropship_realestate.sql`
   4. `supabase/004_brands_media.sql`
   5. `supabase/005_trading_floor.sql` (per-business pause, live floor)

   The dashboard shows a red "Database update needed" banner naming any file you've missed.
3. Create your login: **Authentication → Users → Add user**. Tick **Auto Confirm User**. Then turn off "Allow new users to sign up".
4. From **Project Settings → API Keys**, copy:
   - the Project URL
   - the **publishable/anon** key (goes in the dashboard)
   - the **secret/service_role** key (goes in Railway only)

### 2. Railway (worker)

1. **New Project → Deploy from GitHub repo** → `keckjones/agent-town`. The root `Dockerfile` and `railway.json` are picked up automatically, so leave Root Directory empty.
2. **Settings → Networking → Generate Domain**. Webhooks and sign-in callbacks use this address.
3. **Variables**: add what you have. Anything missing just shows as "needs setup" in Connections & Settings.

| Variable | Needed for |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Required |
| `ANTHROPIC_API_KEY` | Required (the agents' brain) |
| `GOOGLE_API_KEY` | Finding and auditing businesses (Places API (New) + PageSpeed Insights) |
| `BUSINESS_NAME`, `SENDER_NAME`, `BUSINESS_ADDRESS` | Required before any email (CAN-SPAM footer) |
| `SMTP_PASS` | Sending email from agentickj@gmail.com (a Google **App Password**). `SMTP_USER`/`SMTP_HOST` default to Gmail. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | The 7:30 AM text to you (A2P 10DLC registration required) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payment links + confirmed payments |
| `ETSY_API_KEY`, `ETSY_SHARED_SECRET` | Etsy listings and orders |
| `PRINTFUL_TOKEN` | Print-on-demand status |
| `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET` | Dropshipping store |
| `RENTCAST_API_KEY` | Real estate values and comps |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Connecting brand YouTube channels |
| `SPORTS_SUPABASE_URL`, `SPORTS_SUPABASE_ANON_KEY`, `SPORTS_EMAIL`, `SPORTS_PASSWORD`, `SPORTS_SITE_URL` | KJ's Picks official picks feed |
| `BOOKING_URL`, `DASHBOARD_URL` | Links in emails and texts |
| Optional | `CLAUDE_MODEL`, `CLAUDE_CHEAP_MODEL`, `MANAGER_CRON`, `CONCURRENCY`, `TASK_TIMEOUT_MIN` |

**Never paste keys into chat or commit them to GitHub.** Secrets live only in Railway Variables. OAuth tokens are stored in a server-only database table that the dashboard can't read.

### 3. Vercel (command center)

1. Put your Supabase URL and **publishable** key in `dashboard/config.js` (never the secret key).
2. Import the repo at vercel.com. Set **Root Directory** to `dashboard`, **Framework** to Other, and leave the build command empty.
3. Open the URL and sign in. Three.js is bundled in `dashboard/vendor/`, so the 3D floor needs no outside CDN.

---

## Day to day

- **Approvals**: approve, edit, request changes or reject. Approving locks in exactly what you saw.
- **Pause**: "Pause all" (P) stops new work everywhere. Each business has its own **Pause this business** switch, and paused businesses' approved items wait rather than run. Each desk can pause one agent. Tasks already running finish.
- **Retry**: from a failed desk, a task record, or System Health. It runs once, and emails, payments and posts stay duplicate-proof.
- **Live means live**: the top bar shows realtime vs polling, time since the last successful update, and a stale warning after 3 minutes. The worker light turns red after 4 minutes without a heartbeat.
- **Morning text**: set the time in Connections & Settings, then send a test. The text is marked active only after Twilio confirms delivery.

## Rules the system follows

- Outreach email: honest subject, one verified fact, your real address, an opt-out line. Opt-outs are permanent.
- No automated texts or robocalls to prospects. AI-voice calls run only with written consent and a connected provider; otherwise you get a manual call task with a script.
- Real estate: research-only until you record an attorney review. Offers are binding-offer approvals and are never signed for you. Earnest money is never sent, and wiring instructions are never changed.
- Brands and content: no fake identities, bought engagement, or unlicensed media. QA blocks unsourced claims. Each item publishes once, to its fixed account.
- Money: collected revenue counts only confirmed payments. Estimates and pipeline are always labeled.

This isn't legal advice.

## Troubleshooting

| You see | Fix |
|---|---|
| "Approved items are waiting: run supabase/002…" | Run the SQL files above in order, then re-approve once. Items approved before 002 ran come back to Approvals one time. |
| Red "Database update needed" banner | Run the files it names, in order. |
| Worker light red / "stale" | Check Railway → Deployments → logs. |
| Emails wait with "mailbox not set up" | Add `SMTP_PASS` (Gmail App Password) in Railway. |
| Agents say "Daily budget reached" | Working as designed. Raise the AI budget in Finance, or wait until midnight. |
| 3D floor doesn't appear | The 2D cards are shown automatically. Choose "3D: simplified" on slower devices. |
