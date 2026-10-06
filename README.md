# Agent Town

Nine AI agents that run a small online business from the cloud, and a pixel-art town where you watch them work.

| Building | Agent | What it does |
|---|---|---|
| Town Hall | **Mayor Mae** (manager) | Every 3 hours: reviews the whole business, decides what's next, assigns tasks |
| Library | **Librarian Lou** | Market research with live web search; writes reports |
| Scout's Lodge | **Scout Sam** | Finds local businesses in College Station via Google Places |
| Inspector | **Inspector Ida** | Visits each business website, screenshots it on a phone, scores it, finds a contact email |
| Workshop | **Builder Bea** | Designs a new homepage for the best prospects and makes a before/after image |
| Post Office | **Postmaster Pete** | Drafts a short outreach email with the before/after attached; sends it once you approve |
| General Store | **Merchant Mo** | Drafts product listings (creates Shopify drafts if you connect a store) |
| Billboard | **Barker Ben** | Plans marketing campaigns and hands post ideas to the Crier |
| Town Square | **Crier Cleo** | Writes social media posts for your approval |

**Nothing leaves the town without your approval.** Emails, posts, and listings wait in the approval inbox. You can edit them, then approve or reject from any device.

## How it fits together

```
 Railway (runs 24/7)            Supabase (stores everything)        Vercel (the town)
 ┌────────────────────┐         ┌──────────────────────────┐        ┌──────────────────┐
 │ worker/            │ ──────▶ │ tasks, prospects, emails │ ◀────▶ │ dashboard/       │
 │  manager + 8 agents│ ◀────── │ approvals, reports, logs │  live  │ pixel town, inbox│
 │  approval executor │         │ screenshots (storage)    │        │ settings, pause  │
 └────────────────────┘         └──────────────────────────┘        └──────────────────┘
```

Your computer is not involved once it's set up. Close the laptop and the town keeps working.

```
agent-town/
├── supabase/schema.sql      ← paste into Supabase once
├── worker/                  ← deploy to Railway (has a Dockerfile)
│   ├── src/agents/          ← one file per agent
│   ├── src/executor.js      ← carries out what you approve
│   └── .env.example         ← the variables Railway needs
└── dashboard/               ← deploy to Vercel (plain static site, no build step)
    └── config.js            ← your Supabase URL + anon key go here
```

---

## Setup (about 45 minutes)

### 1. Supabase: the database

1. Create a new project at supabase.com.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**.
3. Create your login: **Authentication → Users → Add user → Create new user**. Use your email and a strong password, and tick **Auto Confirm User**.
4. Lock the door: **Authentication → Sign In / Providers → Email**, turn **off** "Allow new users to sign up". Now only you can get in.
5. Copy three values from **Project Settings → API** (or **API Keys**):
   - Project URL
   - `anon` / publishable key (safe to put in the dashboard)
   - `service_role` / secret key (**secret**: only goes into Railway)

### 2. Google Cloud: finding and checking businesses

1. In console.cloud.google.com, create a project, then go to **APIs & Services → Library** and enable:
   - **Places API (New)**
   - **PageSpeed Insights API**
2. **APIs & Services → Credentials → Create credentials → API key.** Click **Restrict key** and limit it to those two APIs.
3. Billing must be on for Places. Set a budget alert under **Billing → Budgets** (for example $20) so there are no surprises.

### 3. Anthropic: the brain

1. Create an API key at console.anthropic.com.
2. Under **Billing / Limits**, set a monthly spend limit (start around $50). The town also has its own daily cap, which you control from Town Hall.

### 4. GitHub: where the code lives

Create a new **private** repository and upload the whole `agent-town` folder (on github.com: **Add file → Upload files**, drag the folder in). Railway and Vercel deploy from this repo, and redeploy automatically whenever you change it.

### 5. Railway: the worker that runs 24/7

1. railway.com → **New Project → Deploy from GitHub repo** → pick your repo.
2. Open the service → **Settings → Source → Root Directory** → set it to `worker`. Railway finds the Dockerfile automatically.
3. **Variables** tab → add everything from `worker/.env.example`. At minimum:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `BUSINESS_NAME`, `SENDER_NAME`, `BUSINESS_ADDRESS`.
4. Deploy. In **Deployments → View logs** you should see `Agent Town worker starting...` and `Queued the first town meeting...`.

The first start gives the town three jobs automatically: a town meeting, a scouting trip for 10 businesses, and a research report on local website pricing.

To run the health check (it tests every connection and tells you what to fix), temporarily set the service's **Custom Start Command** to `npm run check`, deploy, read the logs, then clear it again.

### 6. Vercel: the town

1. In your GitHub repo, edit `dashboard/config.js` and paste in your Supabase **Project URL** and **anon/publishable key** (never the service_role key).
2. vercel.com → **Add New → Project** → import the repo.
3. Set **Root Directory** to `dashboard`, **Framework Preset** to **Other**, and leave the build command empty. Deploy.
4. Open your Vercel URL, sign in with the user from step 1, and watch the town.

Tip: add `?demo` to the URL any time to see the sample town.

---

## When your outreach domain is ready

Until then, approved emails wait (marked "in progress") and go out automatically once these are set.

1. Buy a separate domain for outreach, close to your main brand (e.g. `getyourstudio.com` if your site is `yourstudio.com`). This protects your main domain's reputation.
2. Add Google Workspace to it and create a mailbox, e.g. `you@getyourstudio.com`.
3. In Workspace, set up **SPF, DKIM and DMARC** for the domain (Google's admin console walks you through each). Without them, your emails land in spam.
4. Turn on 2-Step Verification for the mailbox, then create an **App Password** (Google Account → Security → App passwords).
5. Add to Railway variables: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER`, `SMTP_PASS` (the app password), and `SMTP_FROM` (like `Your Name <you@getyourstudio.com>`).
6. **Warm up slowly.** Keep "Emails per day" at 10–15 for the first two to three weeks (Town Hall → Town rules), then raise it gradually.

### Email rules this code follows (CAN-SPAM)

- Every email ends with your name, business, real mailing address, and an unsubscribe line. That's why `BUSINESS_ADDRESS` is required. A PO box or virtual mailbox works.
- Honest subject lines, no fake claims (the Postmaster's instructions forbid invented facts).
- **Honor opt-outs.** When someone replies "unsubscribe," add their address to the do-not-contact list in the Post Office. The agents will never email them again.
- No automated texts or calls anywhere in this system, on purpose (TCPA).

This isn't legal advice. Read the FTC's CAN-SPAM compliance guide before your first send.

---

## Using the town day to day

- **Approvals** (top right): review drafted emails, posts, and listings. Edit anything, then Approve or Reject. Emails with no address found show the business phone, so you can add an address or call them yourself.
- **Click any building** to see that agent's work and give it a job: send the scout after a business type, ask the Library a question, request a campaign, and so on.
- **Town Hall** has the mayor's latest plan, a button to call a meeting now, the town rules (goal, daily budget, email limit, city, business types, your offer), and **Log a payment** to fill the earnings meter.
- **Post Office**: when someone replies or becomes a client, mark it. The mayor uses this to steer.
- **Pause all** stops every agent immediately. Resume when you're ready.

## Costs to expect

| Item | Rough cost |
|---|---|
| Claude API | Capped by your daily budget (default $5/day). A full scout → inspect → design → email cycle costs roughly $0.10–0.30 per prospect, mostly the design step |
| Google Places | About $0.03 per search; Google gives a monthly free allowance |
| Railway | ~$5–20/month |
| Supabase, Vercel | Free tiers are plenty to start |

The AI spend meter on the dashboard shows today's spend. Prices for Claude models are set in `worker/src/config.js`; check anthropic.com/pricing and adjust if they differ.

## Adding to it later

- **A new agent:** add a file in `worker/src/agents/` exporting `handlers`, register it in `agents/index.js`, add a row to the `agents` table, and add a building in `dashboard/town.js`.
- **Auto-posting to social media:** connect a scheduler or platform API in `executor.js` under `social_post`. Right now approved posts appear in the Town Square with a Copy button.
- **Etsy or Gumroad:** add a publisher next to the Shopify one in `executor.js`.

## Troubleshooting

| You see | Fix |
|---|---|
| Grey dot next to "Agent Town" | The worker is offline. Check Railway logs. |
| Login fails | Check the user exists and is confirmed in Supabase → Authentication → Users. |
| Scout "Gave up … Google Places error 403" | Enable **Places API (New)** and check the key's restrictions. |
| Agents say "Daily budget … reached" | Working as designed. Raise the daily budget in Town Hall, or wait until midnight. |
| Emails stuck in "In progress" | Outreach email variables aren't set yet, or today's email limit was reached. |
| Nothing moves in the town | Make sure `schema.sql` ran fully (it turns on live updates), then refresh. |
