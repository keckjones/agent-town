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

**Movement** is tied to records too: when a handoff is recorded, the agent who handed off walks the folder to the next desk; idle agents sometimes take a coffee or water break (their tag says "Idle · on a break"; turn breaks off with the **Breaks** button). A working agent never leaves its desk.

**Plain English everywhere:** every desk starts with "In plain English" (what the agent is for, what it's doing, what happens next, and a glossary of any jargon), every approval card explains what approving does, and research reports, opportunity memos and Big Boss answers are written for someone new to the business.

**Agents work together.** When one agent needs something another agent makes, it sends a *team request*, and the request goes to the one agent who does that work:

| Need | Done by |
|---|---|
| Landing page / website (hosted at `<worker>/p/<name>` after you approve) | Website Production |
| Social media brand | Brand Development |
| Social posts / brand content calendar | Social Content / Social Strategy |
| Marketing campaign plan | Campaign Strategy |
| Market research | Market Research |
| Etsy product ideas / store products | Etsy Research / Dropship Research |
| Local businesses to contact | Local Business Prospecting |
| A small test with a goal and stop rule | Experiment Design |

- **Give the Big Boss an idea** (Executive Office, or Projects & Requests). He turns it into a plan using only these capabilities, and anything outside them is listed as "only you can do". You approve the plan, then each step goes to its agent in order.
- **Ideas from agents trigger requests too.** Opportunity memos list what other agents should make (a website, a brand, research), and approving the experiment sends those requests. A newly approved brand asks for its link-in-bio page. The Big Boss can request work during planning.
- **Every request is a recorded handoff,** so the floor shows the line and the walk. The requesting desk shows "Waiting on another agent".
- **Public results still need your approval** (a page going live, posts, emails). A daily cap (default 12 requests/day) keeps AI costs predictable.

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
   6. `supabase/006_plain_english.sql` (plain-English explanations on approval cards)
   7. `supabase/007_collaboration.sql` (agents working together: projects, team requests, hosted landing pages)
   8. `supabase/008_fast_lane.sql` (express lane so your own requests never wait behind background jobs)

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
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | **Sending email** through the Gmail API (click "Connect Gmail" once), plus YouTube channel connections. Railway blocks SMTP email ports below the Pro plan, so this is the way to send on Hobby. |
| `SMTP_PASS` | Reading replies (and sending, on Railway Pro) from agentickj@gmail.com: a Google **App Password**. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | The 7:30 AM text to you (A2P 10DLC registration required) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payment links + confirmed payments |
| `ETSY_API_KEY`, `ETSY_SHARED_SECRET` | Etsy listings and orders |
| `PRINTFUL_TOKEN` | Print-on-demand status |
| `SHOPIFY_STORE`, `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET` | Dropshipping store |
| `RENTCAST_API_KEY` | Real estate values and comps |
| `SPORTS_SUPABASE_URL`, `SPORTS_SUPABASE_ANON_KEY`, `SPORTS_EMAIL`, `SPORTS_PASSWORD`, `SPORTS_SITE_URL` | KJ's Picks official picks feed |
| `BOOKING_URL`, `DASHBOARD_URL` | Links in emails and texts |
| Optional | `CLAUDE_MODEL`, `CLAUDE_CHEAP_MODEL`, `MANAGER_CRON`, `CONCURRENCY`, `TASK_TIMEOUT_MIN` |

**Never paste keys into chat or commit them to GitHub.** Secrets live only in Railway Variables. OAuth tokens are stored in a server-only database table that the dashboard can't read.

**Email setup (Gmail API, works on every Railway plan):** in Google Cloud enable **Gmail API**; on the OAuth consent screen choose External and **Publish app** (otherwise the sign-in expires every 7 days); create an OAuth client (Web application) with redirect URIs `https://YOUR-RAILWAY-DOMAIN/oauth/gmail/callback` (and `/oauth/youtube/callback` for brand channels). Add the client ID/secret to Railway, then click **Connect Gmail** in Connections & Settings and sign in as agentickj@gmail.com. Google will warn the app is unverified — it's your own private tool: Advanced → continue.

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
| "Could not complete … Connection timeout" | Railway blocks SMTP below Pro. Connect Gmail (above), then click **Try again** on the card; it sends once. |
| Emails wait with "Email not connected" | Click **Connect Gmail** in Connections & Settings. |
| Agents say "Daily budget reached" | Working as designed. Raise the AI budget in Finance, or wait until midnight. |
| 3D floor doesn't appear | The 2D cards are shown automatically. Choose "3D: simplified" on slower devices. |
