# Be IPO Ready CRM

CRM for [Be IPO Ready](https://beipoready.com): IPO advisory and growth capital for Indian companies
(Fund Raising, Pre-IPO Advisory, SME IPO Advisory, Main Board IPOs, Valuation & Corporate Restructuring).

Stack: Next.js 15 (App Router) · Tailwind CSS · Prisma 6 · PostgreSQL (local or Supabase) · NextAuth · Recharts.

## Getting started

```bash
cp .env.example .env            # set DATABASE_URL, DIRECT_URL, NEXTAUTH_SECRET (see below)
npm install
npx prisma migrate deploy
npm run db:seed                 # demo data: enquiries, client companies, mandates, IPO issues…
npm run dev                     # http://localhost:3000
```

### Demo accounts

| Role                          | Name          | Email                       | Password            |
| ----------------------------- | ------------- | --------------------------- | ------------------- |
| Admin (CEO, system mailbox)   | Rakesh Doshi  | admin@beipoready.com        | `beipoready@123456` |
| Compliance Officer            | Vikram Rao    | compliance@beipoready.com   | `Password@123`      |
| Relationship Manager          | Rohan Sharma  | rohan@beipoready.com        | `Password@123`      |
| Relationship Manager          | Priya Nair    | priya@beipoready.com        | `Password@123`      |
| Viewer                        | Kabir Singh   | viewer@beipoready.com       | `Password@123`      |
| Viewer (inactive)             | Neha Gupta    | neha@beipoready.com         | `Password@123`      |

`npm run db:seed` wipes the database and reloads the demo data (`SEED_ADMIN_PASSWORD` overrides the admin password).

## What's in it

- **Leads = company enquiries:** company, contact person, sector, city, service of interest, revenue, source (website, IPO readiness call, IPO-ready check, referral, event…), and the website readiness-check score and answers. Filters, activity history, interaction log, tasks, meetings and emails.
- **Clients = companies:** CIN, company PAN, GSTIN (validated), entity type, sector, incorporation year, financials (revenue, EBITDA, PAT, net worth), multiple contacts, and an indicative SME vs main-board eligibility screen.
- **Onboarding KYC:** company documents (COI, PAN, GST, MOA/AOA, board resolution, promoter KYC). Workflow Pending → Submitted → Under Review → Verified/Rejected; only Compliance/Admin can review, and every step is recorded.
- **Mandates:** one engagement per service, each with its own stage pipeline (e.g. SME IPO: Proposal → Mandate signed → Due diligence → Restructuring → DRHP drafting → DRHP filed → Observations → Approval → RHP → Roadshow → Issue open → Listed). Also covers on hold, dropped and resume, stage history, the fee estimate (retainer + success fee), lead advisor, target date and the linked IPO issue. Board and list views.
- **Documents:** versioned vault (engagement letter, NDA, financials, DRHP/RHP drafts, valuation report, pitch deck…), PDF/Word/Excel/PowerPoint/images up to 25 MB, filed per client and optionally per mandate.
- **Meetings:** schedule from a lead or client. **Google Meet** and **Microsoft Teams** links and calendar invites are created automatically when the user has connected their account; Zoom, phone and in-person are also supported. Completing a meeting logs its outcome to the permanent interaction log.
- **Email conversations:** users connect Gmail or Outlook under **My account**. Emails exchanged with a lead or client contact (or the client's company domain) are captured on that company's timeline, and users can send and reply from the CRM. Personal mail is never stored.
- **Interaction log:** permanent (no deletes); only Admins can edit or remove an entry, with a reason, and the history is kept.
- **Website lead capture:** `POST /api/public/leads` for the beipoready.com forms (see Settings → Website integration).
- **Dashboards & reports:** pipeline by stage and fees, RM performance and leaderboard, lead-source effectiveness, CSV exports.
- **Tasks, notifications, settings:** follow-ups with due-date reminders, notification centre, company profile, reassigning an RM's book.
- **Team invitations & onboarding:** admins invite colleagues from **Users → Invite user**. The invitee gets an emailed link (sent from the system mailbox), sets their own password, and is walked through a checklist: details → add their work email → link WhatsApp. Links are single-use and expire after 7 days; admins can copy a link or send it on WhatsApp when email isn't set up.
- **One firm mailbox for everyone:** the administrator enters the firm's email once under **Settings → Firm email** (Gmail / Google Workspace, Outlook, Zoho, Titan, GoDaddy… presets, or any SMTP host). Every user's emails and meeting invitations are sent from it as *"Rohan Sharma via Be IPO Ready"* with **Reply-To** set to the user's own address, so replies land in their inbox. Invitations carry an iCalendar file (Accept / Decline in the client's mail app; cancellations send `METHOD:CANCEL`). Users have nothing to connect; Google / Microsoft under My account remains optional, for Meet / Teams links and captured conversations.
- **One firm WhatsApp for everyone:** the administrator links the firm's WhatsApp once under **Settings → Firm WhatsApp** by scanning a QR code, exactly like WhatsApp Web → Linked devices (open-source WhatsApp Web client). From then on meeting details and messages sent from any lead / client page go straight to the contact's WhatsApp from that number, signed with the user's name, and are logged on the timeline. Without a link, the same buttons open the user's WhatsApp with the message prefilled (`wa.me`). See the caveats under Configuration.

## Roles

The permission matrix is in [`src/lib/rbac.ts`](src/lib/rbac.ts). It's enforced in middleware, pages and every API route; the user is re-read from the DB on each request.
RMs only see their own enquiries and clients (plus mandates they lead); other RMs' records return 404.
Compliance reviews KYC and can view everything but cannot edit companies or mandates. Viewers are read-only.

## Configuration

### Database: Supabase

1. In Supabase, open your project → **Connect**.
2. Set `DATABASE_URL` to the **Transaction pooler** URI (port 6543) and add `?pgbouncer=true`.
3. Set `DIRECT_URL` to the **Session pooler** (or direct) URI (port 5432).
4. Run `npx prisma migrate deploy`, then optionally `npm run db:seed`.

The CRM itself never needs a Supabase *access token* (`sbp_…`), only these connection strings.

### File storage

- `STORAGE_DRIVER=local` (default): files are stored in `UPLOAD_DIR`. Back that folder up.
- `STORAGE_DRIVER=supabase`: a private Supabase Storage bucket. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server only) and `SUPABASE_BUCKET`, and create the bucket as **private**. Files are only served through the CRM's permission-checked download routes. Use this on serverless hosts.

### Google (Gmail + Calendar/Meet)

1. In Google Cloud Console, create a project and enable the **Gmail API** and **Google Calendar API**.
2. Set up the OAuth consent screen. If you use Google Workspace, choose **Internal**: no Google verification is needed. `gmail.readonly` is a *restricted* scope, and external apps need Google's security review.
3. Create OAuth credentials of type *Web application*, with redirect URI `https://<your-crm>/api/integrations/google/callback`.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Microsoft (Outlook + Teams)

1. In Entra ID (Azure), open **App registrations → New registration**, with redirect URI `https://<your-crm>/api/integrations/microsoft/callback`.
2. Add these delegated permissions: `offline_access`, `User.Read`, `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`.
3. Create a client secret.
4. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` and `MICROSOFT_TENANT_ID` (your tenant ID, or `common`).

OAuth tokens are encrypted at rest (AES-256-GCM, key from `TOKEN_ENCRYPTION_KEY` or `NEXTAUTH_SECRET`).

### System email (invitations)

Invitation and test emails are sent through the **system sender**, an administrator chosen under **Settings → System email** (default: the seeded admin, `admin@beipoready.com`). It uses, in order:

1. that administrator's connected Gmail or Outlook account (connect it under **My account**);
2. SMTP entered under **Settings → System email** (the password is stored encrypted) — for `admin@beipoready.com` on Gmail / Google Workspace use `smtp.gmail.com`, port 587, the address as username and an [App Password](https://support.google.com/accounts/answer/185833); the `SMTP_*` environment variables are used only when nothing is saved in Settings.

**Send test email to me** on that page confirms delivery. If neither is available the invitation is still created; the Users page shows the link to copy or send on WhatsApp.

### Firm WhatsApp

Two methods, like the beipoready.com site: the **linked WhatsApp account** first, **CallMeBot** as the fallback for staff alerts.

**1. Linked WhatsApp account (main method)** — `whatsapp/server.mjs` is a separate Node service (open-source [Baileys](https://github.com/WhiskeySockets/Baileys) library, unofficial) that holds the firm's WhatsApp session. It runs under pm2 as `beipoready-crm-whatsapp` on port 3018, *outside* the Next app, so the session isn't dropped when the CRM is redeployed. The admin links the firm's number by scanning a QR code under **Settings → Firm WhatsApp**, the same way WhatsApp Web works. The CRM talks to the service with the shared secret `WHATSAPP_SERVICE_TOKEN`. Messages are queued and sent 3–7 seconds apart. With this method messages can go to any number: client messages, meeting links and staff alerts.

```bash
# on the server that runs the service (same box as the CRM, or any always-on host)
echo 'WHATSAPP_SERVICE_TOKEN="'$(openssl rand -hex 24)'"' >> .env
npm run whatsapp:pm2          # pm2 start whatsapp/ecosystem.config.cjs && pm2 save
# the CRM (same box):  WHATSAPP_SERVICE_URL=http://127.0.0.1:3018  + the same token
# the CRM on Vercel:   expose the service over https (nginx / Caddy in front of :3018) and set WHATSAPP_SERVICE_URL to that address
```

The session lives in `whatsapp/session/` (git-ignored) — keep it on persistent disk. A `Dockerfile` for the service is included for container hosts (mount a volume at `/app/whatsapp/session`).

**2. CallMeBot (fallback)** — `src/lib/callmebot.ts` calls the free `api.callmebot.com/whatsapp.php` API. It is used only for **staff alerts** when the linked account isn't connected, and only for staff who saved a CallMeBot API key under **My account** (each person gets one by sending "I allow callmebot to send me messages" to CallMeBot on WhatsApp). It cannot message clients.

**How alerts are triggered** — `src/lib/staff-alerts.ts` → `alertNewWebsiteLead()` runs when the website posts an enquiry (`POST /api/public/leads`). Recipients: the assigned RM and every administrator who has a WhatsApp number and the "WhatsApp me about new website enquiries" toggle on (My account). The in-app notification and the WhatsApp alert are independent: a failure in one never stops the other.

WhatsApp doesn't allow automation on normal accounts, so heavy use of the Baileys method can get the linked number banned; keep volumes conversational. For a fully supported route, switch to the official WhatsApp Business Cloud API or a provider built on it (Interakt, WATI, AiSensy).

### Website forms

Set `WEBSITE_API_KEY` (and optionally `WEBSITE_ALLOWED_ORIGINS`). **Settings → Website integration** shows the endpoint and a copy-paste example.
Each submission creates an enquiry assigned to the RM with the fewest open enquiries. Repeat submissions from the same email or phone are merged.

### Scheduled jobs

Call these with `Authorization: Bearer $CRON_SECRET`:
- `POST /api/cron/email-sync`: every 10–15 minutes, fetches new emails for all connected mailboxes.
- `POST /api/cron/notifications`: hourly; task-due and mandate-target reminders. These are also generated whenever a user loads a page.

### Timezone

"Today", date filters, report buckets and displayed times use `NEXT_PUBLIC_APP_TIMEZONE` (default `Asia/Kolkata`).

## Deploying to Vercel

The repo carries a `vercel.json` (build runs `prisma migrate deploy` first, daily cron jobs for email sync and reminders — Vercel's Hobby plan allows one run per day; on Pro you can raise them to `*/15 * * * *` and hourly — Mumbai region). Reminders are also generated whenever a user loads a page, and **Sync emails now** under My account fetches mail on demand. What a Vercel deployment needs:

| Variable | Notes |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | A hosted Postgres — a Neon or Supabase database from the Vercel Marketplace, or your own. Use the pooled URL for `DATABASE_URL` when the provider offers one. |
| `NEXTAUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `WEBSITE_API_KEY` | Random secrets (`openssl rand -base64 32`). Vercel Cron sends `CRON_SECRET` automatically. |
| `NEXTAUTH_URL` | The production URL (e.g. `https://growthavenues-crm.vercel.app`). Falls back to Vercel's production domain when unset. |
| `STORAGE_DRIVER=supabase` + `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_BUCKET` | Required for document uploads: Vercel has no persistent disk, so `local` storage doesn't work there. |
| `SMTP_*` (optional) | Or enter SMTP under Settings → Firm email after the first sign-in. |
| `WHATSAPP_SERVICE_URL`, `WHATSAPP_SERVICE_TOKEN` | The firm WhatsApp service (see *Firm WhatsApp*). |

Then `vercel --prod` from the project folder, and once: `DATABASE_URL=… DIRECT_URL=… npm run db:seed:prod` to create the administrator (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` override the defaults) without demo data.

WhatsApp on Vercel: run the WhatsApp service on an always-on host and set `WHATSAPP_SERVICE_URL` (its public https address) and `WHATSAPP_SERVICE_TOKEN` (see *Firm WhatsApp*); until then the buttons fall back to `wa.me` links and staff alerts use CallMeBot keys.

## Tests

59 Playwright end-to-end tests cover every module, the role restrictions, and the Google/Microsoft flows. The flows run against a local mock of their APIs (`e2e/mocks/provider-mock.mjs`), which Playwright starts automatically.

```bash
npm run db:seed
npm run build && npm run start:e2e &   # production build wired to the provider mock
E2E_BASE_URL=http://localhost:3000 npm run test:e2e
```

## Project layout

```
prisma/schema.prisma     data model (header explains the domain)
prisma/migrations/       SQL migrations (incl. CHECK constraints, no-delete triggers)
prisma/seed.ts           demo data
src/app/(app)/           pages: dashboard, leads, clients, mandates, kyc, ipos, meetings,
                         tasks, performance, reports, notifications, account, users, settings
src/app/api/             API routes (public/leads, integrations/*, cron/* are the external entry points)
src/lib/                 domain logic: rbac, mandates, eligibility, meetings, email-sync,
                         integrations/ (OAuth, calendar, mail), storage, tz, csv
src/components/          UI: tables, cards, timelines, forms, charts
e2e/                     Playwright specs + provider mock
```

> Note for new migrations: name them with a timestamp after `20260927100000` so they sort after the existing ones.
