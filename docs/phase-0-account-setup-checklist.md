# Phase 0 — Account & Access Setup Checklist

> **Printable.** Tick each box. Do the sections **in order** — later accounts
> depend on earlier ones. Store every secret in the shared vault (never in Git).
> Companion to the [delivery plan](./08-delivery-plan.md).

**Legend:** `☐` = to do · Owner hat in **bold** · ⚠️ = can be slow, start early.

---

## Before you start — gather KYB documents ⚠️

Paystack, Flutterwave and Smile ID all require **business verification (KYB)**
for live keys and settlement. Collect these on day 1 so applications don't stall:

- ☐ **CAC certificate** + **RC number** (registered business)
- ☐ **TIN** (Tax Identification Number)
- ☐ **Business bank account** (for settlement)
- ☐ **Director/owner government ID** (NIN slip / passport / driver's licence)
- ☐ **Proof of address** (utility bill / bank statement)
- ☐ **Company logo + brand name** (for sender IDs, dashboards, receipts)
- ☐ Memorandum/BN docs if requested

---

## 0.1 Identity & domain foundation — **Ops**

### ☐ 1. Google Workspace (company inbox)
- **Sign up:** https://workspace.google.com/ → *Get started*
- Create a **shared role inbox** (e.g. `ops@daniliya.com`), **not** a personal Gmail.
- ☐ Turn on 2-step verification. ☐ Set recovery phone/email. ☐ Create the vault-stored credentials.
- **Done when:** you can send/receive at `@daniliya.com`.

### ☐ 2. Domain & DNS access (`daniliya.com`)
- Registrar login (wherever `daniliya.com` is registered — e.g. Namecheap https://www.namecheap.com, GoDaddy https://godaddy.com, or Cloudflare https://dash.cloudflare.com).
- ☐ Confirm you can add/edit DNS records (see [DNS appendix](#dns-appendix)).
- **Done when:** a test TXT record you add resolves.

### ☐ 3. Branded email on the domain (Google Workspace)
- In Workspace Admin → add the domain → add the **MX + verification** records (see DNS appendix).
- **Done when:** mail flows to `@daniliya.com` mailboxes.

### ☐ 4. Shared password manager / vault
- **Sign up:** 1Password https://1password.com or Bitwarden https://bitwarden.com
- ☐ Create a team vault; invite the engineers. **All provider secrets live here.**

---

## 0.2 Source, hosting & data — **DevOps**

### ☐ 5. GitHub org
- Org exists: https://github.com/Devstrike-DigTech
- ☐ Create `daniliya-api` access; ☐ set up **Actions secrets** + **Environments** (staging/prod).

### ☐ 6. API hosting (pick one)
- Render https://render.com · Railway https://railway.app · Fly.io https://fly.io · AWS https://aws.amazon.com
- ☐ Create a project/service for the Docker API. → env: `PORT`, `NODE_ENV`, `CORS_ORIGIN`
- ☐ Point `api.daniliya.com` at it (DNS appendix).

### ☐ 7. Managed PostgreSQL
- Neon https://neon.tech · Supabase https://supabase.com · AWS RDS https://aws.amazon.com/rds
- ☐ Create DB + role; copy connection string. → env: `DATABASE_URL`

### ☐ 8. Managed Redis
- Upstash https://upstash.com · Redis Cloud https://redis.com/try-free
- ☐ Create instance. → env: `REDIS_URL`

### ☐ 9. AWS (IAM user + S3 bucket)
- **Sign up:** https://aws.amazon.com → Console
- ☐ Create S3 bucket (media); ☐ create IAM user with least-privilege S3 policy; ☐ generate access keys.
- → env: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`

### ☐ 10. Cloudinary
- **Sign up:** https://cloudinary.com/users/register_free
- → env: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`

---

## 0.3 Payments & identity (KYB-gated ⚠️) — **Ops + Integrations**

> Build on **test/sandbox** keys immediately; submit KYB in parallel for **live**.

### ☐ 11. Paystack (payments + transfers/payouts)
- **Sign up:** https://dashboard.paystack.com/#/signup (site: https://paystack.com)
- ☐ Grab **test** keys now. ☐ Submit business verification. ☐ **Enable Transfers** (needed for the payout engine). ☐ Add webhook URL `https://api.daniliya.com/api/v1/webhooks/paystack`.
- → env: `PAYSTACK_SECRET_KEY`, `PAYSTACK_PUBLIC_KEY`

### ☐ 12. Flutterwave (secondary rail)
- **Sign up:** https://dashboard.flutterwave.com/signup (site: https://flutterwave.com)
- ☐ Test keys now; ☐ KYB for live; ☐ webhook `…/webhooks/flutterwave` + set secret hash.
- → env: `FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH`

### ☐ 13. Smile ID (KYC)
- **Sign up:** https://portal.usesmileid.com/signup (site: https://usesmileid.com)
- ☐ Start in **sandbox**; ☐ KYB for production; ☐ callback `…/webhooks/smile-id`.
- → env: `SMILE_ID_PARTNER_ID`, `SMILE_ID_API_KEY`, `SMILE_ID_ENVIRONMENT` (`sandbox`→`production`)

---

## 0.4 Communications — **Integrations**

### ☐ 14. Resend (transactional email)
- **Sign up:** https://resend.com/signup
- ☐ Add & **verify sending domain** — use a subdomain like `send.daniliya.com` to avoid SPF clashes with Google. ☐ Add the DKIM/SPF/DMARC records Resend shows you (per-account values → DNS appendix).
- → env: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (e.g. `no-reply@daniliya.com`), `RESEND_FROM_NAME` (`Daniliya`)

### ☐ 15. Termii (SMS / OTP) ⚠️
- **Sign up:** https://accounts.termii.com/register (site: https://termii.com)
- ☐ **Request a Sender ID early** — approval can take days (Nigerian DND rules). ☐ Fund test credits.
- → env: `TERMII_API_KEY`, `TERMII_SENDER_ID`
- **Fallback:** use email OTP (Resend) until the sender ID is approved.

---

## 0.5 Observability & bootstrap secrets — **DevOps**

### ☐ 16. Sentry
- **Sign up:** https://sentry.io/signup/ → create a Node/NestJS project.
- → env: `SENTRY_DSN`

### ☐ 17. Generate app secrets (locally, then vault)
- ☐ `JWT_ACCESS_SECRET`, ☐ `JWT_REFRESH_SECRET`, ☐ `ENCRYPTION_KEY`
- Generate each: `openssl rand -base64 48`
- ☐ Set `JWT_ACCESS_EXPIRES_IN` (e.g. `15m`), `JWT_REFRESH_EXPIRES_IN` (e.g. `30d`)

### ☐ 18. Seed superadmin
- ☐ Set `ADMIN_EMAIL` to a `@daniliya.com` address.

---

## DNS appendix <a name="dns-appendix"></a>

Add at your DNS host. Values marked **(from dashboard)** are account-specific —
copy them from the provider's setup screen.

| Purpose | Type | Host / Name | Value |
|---|---|---|---|
| Google verification | TXT | `@` | `google-site-verification=…` **(from dashboard)** |
| Google mail | MX | `@` | `1 SMTP.GOOGLE.COM` (or the 5 legacy ASPMX records Google shows) |
| Root SPF (Google) | TXT | `@` | `v=spf1 include:_spf.google.com ~all` |
| API subdomain | A/CNAME | `api` | → your hosting target **(from host)** |
| Resend DKIM | TXT/CNAME | `resend._domainkey.send` | **(from Resend dashboard)** |
| Resend SPF (send subdomain) | TXT | `send` | `v=spf1 include:amazonses.com ~all` **(confirm in dashboard)** |
| Resend MX (send subdomain) | MX | `send` | **(from Resend dashboard)** |
| DMARC | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@daniliya.com` |

> **SPF rule:** one SPF TXT record per host. Keep Google's SPF on the **root**
> (`@`) and Resend's on the **`send.` subdomain** so they never conflict.

---

## `.env` fill-in tracker

Tick when the real value is in the vault **and** in the deploy environment:

```
Core        ☐ NODE_ENV  ☐ PORT  ☐ CORS_ORIGIN
Data        ☐ DATABASE_URL  ☐ REDIS_URL
Auth        ☐ JWT_ACCESS_SECRET  ☐ JWT_REFRESH_SECRET
            ☐ JWT_ACCESS_EXPIRES_IN  ☐ JWT_REFRESH_EXPIRES_IN  ☐ ENCRYPTION_KEY
Payments    ☐ PAYSTACK_SECRET_KEY  ☐ PAYSTACK_PUBLIC_KEY
            ☐ FLUTTERWAVE_SECRET_KEY  ☐ FLUTTERWAVE_SECRET_HASH
KYC         ☐ SMILE_ID_PARTNER_ID  ☐ SMILE_ID_API_KEY  ☐ SMILE_ID_ENVIRONMENT
Email       ☐ RESEND_API_KEY  ☐ RESEND_FROM_EMAIL  ☐ RESEND_FROM_NAME
SMS         ☐ TERMII_API_KEY  ☐ TERMII_SENDER_ID
Media       ☐ CLOUDINARY_CLOUD_NAME  ☐ CLOUDINARY_API_KEY  ☐ CLOUDINARY_API_SECRET
            ☐ AWS_ACCESS_KEY_ID  ☐ AWS_SECRET_ACCESS_KEY  ☐ AWS_REGION
Ops         ☐ SENTRY_DSN  ☐ ADMIN_EMAIL
```

---

## Exit criteria — QA gate 0

- ☐ `/health` deploy boots and reads **every** env var (fails loudly if any missing).
- ☐ Smoke test green: Paystack test-init · Resend test-email · Termii test-SMS (or email fallback) · Smile sandbox · S3 + Cloudinary upload · Postgres + Redis ping.
- ☐ All secrets in the shared vault + deploy environment; **none** in Git.
- ☐ KYB applications **submitted** (Paystack, Flutterwave, Smile) and Termii sender-ID **requested** — tracked separately; live approval gates launch (Phase 8), not development.

> **Verify each signup URL** as you go — provider onboarding paths change; the
> root domains above are stable even if a deep link shifts.
