# Daniliya — Manual Test Guide

How to exercise the whole platform by hand: every module through Swagger and
through its screens, then the same ground walked as the user journeys that carry
each of the product's value propositions.

Everything here was run against the live server while writing it. Where a flow
cannot currently be completed, it is called out in
[Known blockers](#11-known-blockers) rather than left for you to discover.

> **Reading this after the first version?** See
> [What changed](#0-what-changed-since-the-first-version) — the storefront now
> has accounts, reviews, support and service booking; the admin portal's write
> actions are wired; and file uploads exist. All of that is now testable.

---

## 0. What changed since the first version

If you tested an earlier build, these are new and worth a fresh pass:

- **Guest checkout → optional account.** Buy with no account; register later with
  the same email and your orders come with you.
- **Customer accounts** (`/account`): sign in, order history, service requests.
- **Product reviews** — customers write them, vendors reply, admins moderate.
- **Customer support** — raise and follow a ticket; admins reply/assign/close.
- **Service booking** wired end to end (both quote forms actually send now).
- **Admin write actions** wired — approvals, payouts, moderation, the booking
  lifecycle (was: 40 dead buttons).
- **The payout path works** UI-side: approve a post → run payouts → approve batch.
- **File uploads** (`POST /uploads`) with switchable Cloudinary/R2 storage,
  wired into quote attachments, product images and KYC document fields.

---

## 1. Before you start

### 1.1 Bring the stack up

```bash
# Docker must be running first — Postgres and Redis live there.
open -a Docker            # macOS; wait until `docker ps` responds

cd daniliya-api
npm run start:dev         # API on :4000
```

| Service | Port | URL |
|---|--:|---|
| API | 4000 | `http://localhost:4000/api/v1` |
| **Swagger** | 4000 | **`http://localhost:4000/api/docs`** |
| Web storefront | 3000 | `http://localhost:3000` |
| Affiliate portal | 3001 | `http://localhost:3001` |
| Influencer portal | 3002 | `http://localhost:3002` |
| Vendor portal | 3003 | `http://localhost:3003` |
| Admin portal | 3004 | `http://localhost:3004` |
| Postgres | 5435 | — |
| Redis | 6381 | — |

Start a portal with `npm run dev` in its directory; ports are pinned in each
`package.json` and in `.claude/launch.json`.

Health check:

```bash
curl -s http://localhost:4000/api/v1/products | head -c 120
```

### 1.2 Authorising in Swagger

1. `POST /auth/login`, or:
   ```bash
   curl -s -X POST http://localhost:4000/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@daniliya.com","password":"AdminPass1"}'
   ```
2. Copy `data.accessToken`.
3. **Authorize** (top-right in Swagger) → paste → Authorize → Close.

**Access tokens expire after 15 minutes.** A wall of `401`s usually means it
lapsed — log in again and re-Authorize. `POST /auth/refresh` rotates the pair;
the refresh token lasts 7 days.

### 1.3 How the portals hold auth (so browser testing makes sense)

Every portal keeps tokens in **httpOnly cookies** the browser's JavaScript can
never read. You sign in on the page; a Next.js route handler sets the cookies;
Server Components read them. So:

- To verify you're really signed in, check behaviour, not `document.cookie` — it
  will be empty by design.
- "Sign out" genuinely revokes the refresh token; you can't be silently signed
  back in.
- A file upload can't be posted straight to the API from the browser (no token
  there); each portal proxies it through `/api/upload`.

### 1.4 Responses and money

Every success is wrapped `{ "success": true, "data": …, "timestamp": … }`.
**All money is a string** (`"38000"`) — it is `Decimal(12,2)` in Postgres. Parse
before arithmetic, and never compute a total in the browser: the server is the
authority.

### 1.5 Getting the OTP and reset tokens (dev)

No email is really sent. The 6-digit code is written to the API log by the dev
mailer:

```
[dev-mail] OTP for someone@example.com: 481902
```

If you redirected the API to a log file:

```bash
grep "OTP for someone@example.com" api.log | tail -1 | grep -oE '[0-9]{6}' | tail -1
```

The log line carries ANSI colour codes, so **don't anchor with `$`** — it fails
silently. Same for the password-reset token. If the API writes to a terminal,
the OTP is also in Redis: `redis-cli -p 6381 GET "otp:<userId>"`.

### 1.6 Accounts you can use

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin@daniliya.com` | `AdminPass1` | |
| Customer | `chidi.guest@example.com` | `GuestPass1` | Registered from a guest order; has order `DNL-156F10`, a review and a ticket |
| Affiliate | `nkem.adaeze.0718@example.com` | `AffPass2` | Active, referral code `NKE-2D7D` |
| Creator | `tola.adeyemi.0718@daniliya.test` | `CreatorPass1` | Approved |
| Vendor | `tunde.balogun.vendor1@example.com` | `VendPass1` | Approved |

Other live data: affiliate code **`TUN-19B1`** (₦20,000 lifetime, 2 conversions),
campaign **Glow Season Creator Push** (CPA ₦3,500, promo **`DAN-3D18AF`**), vendor
**Bisi Home Essentials** (product *Lavender Floor Cleaner 5L* @ ₦9,500), orders
**`DNL-7A4671`** / **`DNL-C86F5A`** (both shipped, both trackable). The catalogue
has **8 ACTIVE products**.

Create fresh accounts freely — the journeys below build their own.

### 1.7 Test-data conventions

- Emails: `yourname+role1@example.com`.
- **Phones must be unique per account.** Reusing one now returns a clear 409;
  vary the last digits.
- Money: send plain numbers (`9500`), expect strings back (`"9500"`).
- Dates: full ISO — `2026-08-01T00:00:00.000Z`. An `<input type="date">` value
  like `2026-08-01` is rejected by `@IsDateString` fields; the frontends convert
  for you, but Swagger callers must send full ISO.

---

## 2. Module-by-module reference

Each module: the endpoints, an example payload, and **the screen that exercises
it**. Work top to bottom the first time — later modules lean on earlier ones.

### 2.1 Auth & accounts

| Endpoint | Screen |
|---|---|
| `POST /auth/register` · `verify-otp` · `resend-otp` | `/account` (web), `/join/signup` (portals) |
| `POST /auth/login` · `refresh` · `logout` | every portal's sign-in |
| `POST /auth/forgot-password` → `reset-password` | `/forgot-password` |
| `POST /auth/change-password` | portal profile / security |
| `GET /auth/me` | drives every signed-in header |

```json
{ "email": "yourname+c1@example.com", "password": "TestPass1",
  "firstName": "Ada", "lastName": "Obi", "phone": "+2348030009911" }
```

Checks: same email twice → **409**; same phone → **409** (naming the phone, not a
raw 500); login before verifying → **401 "Verify your email…"**; wrong password
and unknown email give the **same** message; changing the password revokes all
sessions.

### 2.2 Catalogue & reviews (public reads)

| Endpoint | Screen |
|---|---|
| `GET /products?q=&category=&page=&limit=` | `/shop` |
| `GET /products/categories` | shop filter chips |
| `GET /products/:slug` | `/shop/[slug]` |
| `GET /products/:productId/reviews` | product page reviews block |

Only **ACTIVE** products are public. Prove it: as admin,
`POST /admin/products/{id}/reject`, then re-request the catalogue — the count
drops and the slug 404s. Reviews come back as `{summary:{average,count}, reviews:[…]}`
with the vendor's `response` under each.

### 2.3 Cart & checkout

| Endpoint | Auth | Screen |
|---|---|---|
| `POST /checkout/guest-quote` | public | `/checkout` totals |
| `POST /orders/guest` | public | guest checkout |
| `GET /orders/track?ref=` | public | `/order/track` |
| `POST /checkout/quote` · `POST /orders` | user | signed-in checkout (API clients) |
| `GET /orders` · `GET /orders/:ref` | user | `/account` orders |

Pricing is fixed platform-wide: delivery **₦8,500** (0 on `PICKUP`), tax **₦2,500**,
gift wrap **₦1,500**/wrapped line. Verify: 2×₦13,500 + 8,500 + 2,500 = **₦38,000**;
`PICKUP` → **₦29,500**.

```json
{ "mode": "DELIVERY", "paymentMethod": "PAY_ON_DELIVERY",
  "contact": { "fullName": "Chidi Okeke", "email": "yourname+b1@example.com", "phone": "+2348030001111" },
  "deliveryAddress": { "street": "12 Awolowo Rd", "city": "Ikoyi", "state": "Lagos" },
  "affiliateCode": "TUN-19B1",
  "items": [{ "productId": "<uuid>", "quantity": 2 }] }
```

`paymentMethod` is `PAYSTACK | FLUTTERWAVE | PAY_ON_DELIVERY` — there is no
`CARD`. Only `productId`/`quantity` are read from the request; price is re-read
from the DB, so a tampered price is ignored (send one — it's rejected as an
unknown property). `?ref=CODE` on an order sets `channel: AFFILIATE`; a
`promoCode` sets `INFLUENCER`.

### 2.4 Services & bookings

| Endpoint | Auth | Screen |
|---|---|---|
| `GET /services` · `GET /services/:slug` | public | `/services`, `/services/[slug]` |
| `POST /bookings/quote` | **public or user** | `/quote`, `/services` quote block |
| `GET /bookings` · `GET /bookings/:ref` | user | `/account` service requests |
| `GET /admin/bookings` + `accept`/`start`/`complete`/`reject`/`cancel` | admin | admin Bookings |

```json
{ "verticalSlug": "laundry", "name": "Test Guest",
  "email": "yourname+q1@example.com", "phone": "+2348050001234",
  "description": "Weekly laundry for a 3-bedroom flat", "city": "Lagos", "budget": 25000 }
```

Returns `BKG-…` / `REQUESTED`. Admin **accept** sets the price — the field is
**`note`**, not `adminNote` (the response echoes it back as `adminNote`):

```json
{ "quotedAmount": 45000, "note": "Includes pickup and delivery within Lekki." }
```

`comingSoon` on a vertical is honoured by the storefront: a coming-soon service
is absent from the quote picker and its page shows "Coming soon" instead of a
quote button.

### 2.5 Affiliate

`GET /affiliate/overview` · `links` · `earnings` · `referrals` · `leaderboard` →
the affiliate dashboard pages.

Onboarding: `GET /onboarding/status` → `POST /onboarding/role {"role":"AFFILIATE"}`
→ tutorial (5 steps) → assessment. `selected` is the **option text**:

```json
{ "answers": [{ "questionId": "<uuid>", "selected": "Every Monday" }] }
```

Answer key (10 Qs, 60% to pass):

| Question | Answer |
|---|---|
| How often are commissions paid? | Every Monday |
| How much per book sale? | ₦10,000 flat |
| What do you share? | Your unique per-product payment link |
| What must you complete before activation? | KYC, the tutorial and this assessment |
| Which documents for KYC? | A government-issued ID and your bank account details |
| Commission lifecycle order? | Pending → Confirmed → Disbursed |
| On a refund? | The related commission is reversed |
| Earnings cap? | No, commission scales with your sales |
| Acceptable way to share? | Posting on your WhatsApp status and socials |
| Pass mark? | 60% |

**Gotchas:** the assessment 400s until the tutorial is done; and after
`POST /onboarding/role` the JWT still says CUSTOMER, so `/affiliate/*` 403s until
you refresh/re-login (the portal does this for you).

### 2.6 Influencer / campaigns

| Endpoint | Role | Screen |
|---|---|---|
| `POST /onboarding/influencer` | user | `/join/register` |
| `GET /influencer/campaigns` · `POST …/:id/accept` · `POST …/:id/submissions` | creator | `/campaigns`, `/campaigns/[id]` |
| `GET /influencer/earnings` | creator | `/earnings` |
| `POST /admin/campaigns` … `assign` … `submissions/:sid/approve|reject` | admin | admin Campaigns |

Application — the field is **`contentLinks`**, not `contentSamples` (unknown
props are rejected):

```json
{ "niche": "Beauty & Lifestyle", "followerCount": 48200,
  "socialHandles": { "instagram": "@zara.beauty", "tiktok": "@zarabeauty" },
  "contentLinks": ["https://instagram.com/p/sample1"] }
```

Assign takes **`influencerUserIds`** (user ids, not profile ids). Submit a post:
`{"postUrl":"https://…","hasAdDisclosure":true}`. Accept/submit on a PAUSED/ENDED
campaign returns 400 — enforced server-side, so the portal guard can't be
bypassed via the API.

### 2.7 Vendor

| Endpoint | Screen |
|---|---|
| `POST /onboarding/vendor {businessName, productCategory}` | `/join/business` |
| `GET /vendor/overview` | vendor dashboard |
| `GET/POST/PATCH/DELETE /vendor/products` + `:id/submit` | `/products`, `/products/new`, `/products/[id]/edit` |
| `GET /vendor/orders` · `:ref` · `POST :ref/ship` | `/orders`, `/orders/[ref]` |
| `GET /vendor/reviews` · `POST /vendor/reviews/:id/respond` | `/reviews` |

Create a product (born `DRAFT`; a vendor can't self-publish). **`imageUrls`** (up
to 8, each a URL) is now accepted and persists:

```json
{ "title": "Lavender Floor Cleaner 5L", "description": "Low-suds, safe on tiles.",
  "price": 9500, "stockQuantity": 40, "category": "Home",
  "imageUrls": ["https://res.cloudinary.com/demo/image/upload/sample.jpg"] }
```

Then `submit` → `PENDING_REVIEW` → admin `approve` → `ACTIVE` and publicly
buyable. **Ship an order** — the key call:

```json
{ "courier": "GIG Logistics", "trackingNumber": "GIG-4471X2",
  "estimatedDelivery": "2026-07-22T00:00:00.000Z" }
```

then `GET /orders/track?ref=…` shows the courier and tracking to the buyer.
A vendor only sees their own lines and `vendorSubtotal` (not the order total);
another vendor's order 404s on read and ship.

### 2.8 Reviews moderation, support, payouts, banks/KYC, admin, uploads, webhooks

- **Reviews (admin):** `GET /admin/reviews`, `flag {reason?}`, `keep`, `remove` → admin Reviews.
- **Support (customer):** `POST /support/tickets {subject, body, priority}`, `GET /support/tickets`, `:ref`, `:ref/reply {body}` → `/support`, `/support/[ref]`. **Admin:** `/admin/support/tickets` + `reply`/`assign`/`close`. A customer reply reopens a closed ticket.
- **Payouts (admin):** `POST /admin/payouts/run` (confirms commissions, credits wallets, builds batches), `:ref/approve` (compliance-gated), `retry`, `hold`, `cancel`, `GET /admin/payouts/reconciliation` (**must be `drift: 0`**). Earner view: `GET /me/payouts`.
- **Banks/KYC:** `GET /banks`, `POST /banks/resolve`, `GET/POST /me/bank-accounts`, `GET /kyc/me`, `POST /kyc {govIdType, govIdUrl, bankAccountId}`. `govIdType` ∈ `NIN slip | Driver's licence | International passport | Voter's card`.
- **Admin:** `overview`, `finance/stats`, `audit-log`, `settings/config` (+`PATCH {values:{…}}`), `team` (+invite/role/DELETE, **SUPERADMIN-only**), people (approve/reject, suspend/reinstate, message, affiliate tier), orders (refund/cancel), products (approve/reject).
- **Uploads:** `POST /uploads?purpose=kyc|product|booking|campaign` — multipart `file`, signed-in only, returns `{url, key, bytes, mimeType, purpose}`. See [§9.4](#94-file-uploads).
- **Webhooks:** `POST /webhooks/paystack` · `/transfer` — HMAC-SHA512 over the **raw body** in `x-paystack-signature`; unsigned calls rejected; replays de-duped on `externalEventId`.

---

## 3. Journey 1 — "Shop and book, no sign-up required"

> **Value proposition:** anyone buys a product or books a service in minutes with
> no account, still gets tracking and updates, and can make an account later
> that inherits everything.

### 3.1 API
1. `GET /products` → a product id.
2. `POST /checkout/guest-quote` → check the arithmetic by hand.
3. `POST /orders/guest` (POD) → note the `DNL-…` ref.
4. `GET /orders/track?ref=…` — no token.
5. `POST /auth/register` **with the same email used at checkout** → response
   includes `"claimedGuestOrders": true`.
6. Verify OTP, log in, `GET /orders` → **the guest order is there.**
7. `POST /bookings/quote` as a guest → `BKG-…`.

### 3.2 Frontend — buying (`:3000`)
1. `/shop` — search, filter by category, open a product; note its **reviews** block.
2. Add to cart, set quantity, tick gift wrap → `/cart` → `/checkout`.
3. **Watch the total change** switching Delivery ↔ Pickup — it must match the
   server quote exactly.
4. Fill contact, Pay on Delivery, place the order → success page with the real ref.
5. `/order/track`, paste the ref → status and items.

### 3.3 Frontend — booking a service (`:3000`)
1. `/services` — submit the quote block (service, name, phone, email, description
   required). On success you get a **real `BKG-…`**.
2. `/quote?service=laundry` — the same form, pre-selecting Laundry.
3. `/services/dry-cleaning` — flagged coming soon: **every** CTA reads "Coming
   soon" and Dry Cleaning is **absent from the picker**. Contrast `/services/laundry`.
4. As admin at `:3004` → **Bookings**, accept the booking with a quote, then
   start and complete it, checking the customer view each time.

### 3.4 Frontend — becoming a customer (`:3000`)
1. `/account` signed out → sign-in / create-account panel, stating you can buy
   as a guest.
2. Register with the email you checked out under → verify screen says your
   previous orders will be waiting.
3. Signed in: **your guest order is listed** (`DNL-156F10` for the seeded
   account), plus service requests. "Awaiting quote" shows until an admin prices
   a booking — never a fake figure.
4. Sign out → back to the signed-out panel, not silently re-admitted.

**The point of the journey:** step 3.4.2–3 — nobody was forced to register, and
lost nothing by not doing so.

---

## 4. Journey 2 — "Share a link, get paid every Monday"

> **Value proposition:** anyone joins, proves they understand the rules, and
> earns a flat ₦10,000 per confirmed sale with transparent attribution.

### 4.1 API
1. Register + verify → `POST /onboarding/role {"role":"AFFILIATE"}` → **log in again**.
2. Complete the 5 tutorial steps.
3. Submit the assessment with **wrong** answers → `passed:false`, `retakesLeft` down.
4. Submit correct answers → `passed:true`, `isActive:true`, a referral code.
5. `GET /affiliate/links` → copy the master link's `?ref=CODE`.
6. Place a guest order (Journey 1) with that `affiliateCode`.
7. `GET /affiliate/overview` → conversions +1, pending +₦10,000.

### 4.2 Frontend (`:3001`)
1. `/join/signup` → verify → role → tutorial → assessment.
2. **Fail on purpose:** the fail screen shows a real retakes-left count.
3. Pass → your actual referral code.
4. Try to jump to `/join/pass` after a failure, or `/join/role` after activation
   — the server bounces you. **Join progress can't be forged in the browser.**
5. Dashboard: overview, `/links`, `/earnings`, `/referrals`, `/leaderboard`,
   `/payouts` all on real numbers.
6. **KYC** (`/join/kyc`): the document field is a real upload now — attempting it
   returns the storage 503 today (see blockers), and the step stays honestly
   blocked because KYC also needs a bank account.
7. Sign out, hit a dashboard URL directly → redirected to `/login`.

---

## 5. Journey 3 — "Creators earn from campaigns"

> **Value proposition:** a creator applies, is vetted, receives briefs with clear
> payout terms, posts, and is paid per conversion via their own promo code.

### 5.1 API
1. Register + verify → `POST /onboarding/influencer` (§2.6) → log in again.
2. As admin: `GET /admin/influencers` → `reject {reason}` → check the reason shows
   → then `approve`.
3. As admin: create a campaign, `assign` the creator by **user id**.
4. As creator: `GET /influencer/campaigns` → note `promoCode` and `cpa`; `accept`,
   then `submissions`.
5. Place a guest order with that `promoCode`.
6. `GET /influencer/earnings` → conversions +1, pending += CPA.
   `GET /influencer/campaigns` → that campaign's `conversions` **also** +1 (both
   counters must agree — they didn't before a fix).

### 5.2 Frontend (`:3002`)
1. `/join` — apply → awaiting-review screen.
2. Reject as admin, reload → the **reviewer's exact words** appear.
3. Approve, reload → routed to the dashboard.
4. `/campaigns` — an ACTIVE brief offers Accept and Submit; an ENDED one doesn't.
5. Submit a post **without** ticking ad-disclosure → refused. Then submit
   properly → it appears.
6. `/earnings` matches the API.

---

## 6. Journey 4 — "Sell on Daniliya and get paid"

> **Value proposition:** a vendor lists products, has them quality-reviewed,
> fulfils orders, keeps 90%, and sees exactly what they're owed.

### 6.1 API
1. Register + verify → `POST /onboarding/vendor` → admin approves → log in again.
2. `POST /vendor/products` (optionally with `imageUrls`) → `DRAFT` → `submit` →
   admin `approve` → confirm it appears in public `GET /products`.
3. Place two guest orders for it.
4. `GET /vendor/overview` — gross counts **only this vendor's lines**, and
   `earnings.pending == gross × (1 − takeRateBps/10000)`; at 10%, ₦38,000 → **₦34,200**.
5. `GET /vendor/orders` → the despatch queue → `POST /vendor/orders/{ref}/ship`.
6. `GET /orders/track?ref=…` → **courier and tracking now visible to the buyer.**

### 6.2 Frontend (`:3003`)
1. `/join` — apply → approved → dashboard.
2. `/products/new` — add images (upload widget → 503 today), save a draft, submit
   for review; copy makes clear an admin publishes it.
3. Admin rejects with a reason → it shows on the list and edit page.
4. `/orders` → open a CONFIRMED order → despatch form → ship it → page flips to
   "Despatched" with courier/tracking and offers to **correct** details, not ship
   again. A cancelled/unpaid order shows no despatch form.
5. `/reviews` — respond to a review (empty state when there are none); `/payouts`
   shows the real wallet balance.

---

## 7. Journey 5 — "Run the whole platform from one place"

> **Value proposition:** one console approves people and products, moderates
> content, moves money, and accounts for every decision.

### 7.1 The money path (the important one — walk it end to end)
This is what makes creators/affiliates/vendors actually get paid, so verify the
whole chain:
1. As creator, submit a campaign post (§5). As admin, open the campaign →
   **Post submissions** → **Approve** it. (A creator's commission stays PENDING
   until the post is approved — this is the release step.)
2. Admin **Payouts** → **Run payouts** → a new batch appears (the first
   INFLUENCER batch was `PB-471DC5C6`, ₦10,500 = 3 × ₦3,500).
3. `GET /admin/payouts/reconciliation` → **`drift: 0`**, wallets credited.
4. Open the batch → **Approve & schedule**. Today this is **correctly refused**
   with "Compliance checks must all pass before approval", because no recipient
   can pass KYC (see blockers) — the compliance gate doing its job, shown as a
   readable error, not a silent failure.

### 7.2 Everything else (`:3004`, sign in as admin)
- **People:** approve/reject a vendor and an influencer; change an affiliate's
  tier; **suspend** a test user then **reinstate** (watch `user.status`); send a
  message.
- **Commerce:** approve/reject a product; place a disposable guest order then
  **refund** it and confirm the commission is voided; walk a booking accept →
  start → complete.
- **Moderation:** flag a review with a reason (it shows), keep it, remove it.
- **Support:** open a ticket as a customer (§8), then reply, assign and close it
  here; confirm the reply lands in the customer's thread.
- **Config & audit:** `PATCH /admin/settings/config` to change the delivery fee,
  re-quote a basket, watch the total move; every money/status action appears in
  **Audit Log** with actor and before/after.
- **RBAC:** invite a `SUPPORT` teammate, sign in as them, confirm team writes and
  payout approvals are **403**.

---

## 8. Journey 6 — "Get help, and be heard"

> **Value proposition:** a customer can raise an issue and follow it, and leave a
> review of what they bought — and the business can respond to both.

### 8.1 Support (`:3000` + `:3004`)
1. `/support` signed out → contact channels + a route to sign in (no form that
   can't send). `/contact` behaves the same.
2. Signed in → **New request** (subject, priority, details) → a `TCK-…` thread.
3. As admin (`:3004` → Support): the ticket is in the queue attributed to the
   customer → **reply**, **assign to me**, then leave it open.
4. Back on `/support/[ref]` as the customer → the admin reply is in the thread.
   Someone else's ticket ref **404s**.
5. Reply as the customer on a **closed** ticket → it reopens (the UI says so).

### 8.2 Reviews (`:3000`)
1. Sign in as a buyer with a confirmed order → `/account` → **Write a review**
   against a purchased item (star rating + text).
2. Open that product's page → the review shows with your name and rating; the
   summary average updates.
3. As admin → Reviews → the review is in the moderation queue.
4. As the product's vendor (`:3003` → Reviews) → respond; the reply shows under
   the review on the product page.
5. Try to review the same product twice → refused ("You have already reviewed
   this product").

---

## 9. Cross-cutting things to verify

### 9.1 Guest-claim integrity
Register with an email that has guest orders → those orders appear under the new
account (Journey 1). Registering with a **real** account's email still 409s.

### 9.2 Attribution both ways
`?ref=CODE` order → affiliate ₦10,000 commission and `channel: AFFILIATE`; a
`promoCode` order → creator CPA commission, `channel: INFLUENCER`, and the
campaign's `conversions` increments.

### 9.3 Ledger never drifts
After any refund or payout run, `GET /admin/payouts/reconciliation` must report
`drift: 0` / `balanced: true`. If not, stop — the double-entry ledger disagrees
with wallet balances, which should never happen.

### 9.4 File uploads
`POST /uploads?purpose=…` (or a portal's `/api/upload`). With no storage keys it
returns **503 "File uploads are not configured"** — the widgets show that
verbatim, no fake success. Also verify, when keys are set:
- A file **lying about its type** (an `.exe` renamed `.png`) is rejected 400 —
  the API sniffs magic bytes, it doesn't trust the extension.
- A PDF sent as a `product` image is refused; a 7MB `product` image 413s (5MB cap).
- Switching `UPLOAD_DRIVER` between `cloudinary` and `r2` changes where files land.

### 9.5 Security spot-checks
- No token is ever visible in `document.cookie`.
- An unsigned webhook call is rejected; a replayed event doesn't double-credit.
- A price field on a guest order is ignored, not honoured.
- Cross-tenant reads 404 (another vendor's order, another customer's ticket).

---

## 10. Designs vs build

This guide covers behaviour. It does **not** certify pixel-fidelity against the
Figma exports in `designs/*.zip` — those were never diffed screen-by-screen. When
testing a screen, judge it against its design export separately; a flow can pass
here and still miss a designed state.

---

## 11. Known blockers

Environment/config gaps, not bugs. Everything else should work.

| # | What you'll hit | Why | Impact |
|---|---|---|---|
| 1 | **File uploads 503** everywhere | No Cloudinary/R2 keys set | Upload paths are wired and degrade honestly; add keys and they work with no code change |
| 2 | **KYC can't be completed** | `POST /me/bank-accounts` 503 — Paystack rejects the key for name enquiry | Blocks KYC → blocks payout **approval** → nobody can actually be paid. Needs a key with resolve permissions. **The single highest-value fix.** |
| 3 | **Card payment can't complete** | No live payment key; Paystack returns `simulated:true` and a fake URL | Use Pay on Delivery for full-flow testing |
| 4 | **No real email/SMS** | Dev mailer logs OTPs to console | Get codes from the log or Redis (§1.5) |
| 5 | `clicks` always 0 | Nothing tracks link clicks | Shown as unavailable, not a real zero |
| 6 | No `DELIVERED` transition | No endpoint | Buyer-visible status stops at SHIPPED |
| 7 | No profile-update endpoint | — | Personal details read-only everywhere |
| 8 | Affiliate can be `isActive` with `kycStatus:null` | Passing the assessment activates before KYC | **Product decision:** people can earn before verification |

---

## 12. Regression checklist

Twelve checks that cover the money paths and the guarantees most likely to break:

- [ ] Guest buys with no account; the order is trackable by reference
- [ ] Checkout total equals the server quote exactly, both fulfilment modes
- [ ] Registering with a guest's email claims that order history
- [ ] Non-ACTIVE products never appear in the public catalogue
- [ ] Guest can request a service quote and gets a real `BKG-` ref
- [ ] A `comingSoon` service is absent from the picker and offers no quote button
- [ ] Affiliate assessment grades server-side; 60% activates and mints a code
- [ ] `?ref=` order → ₦10,000 affiliate commission; a promo order → creator CPA + campaign conversion
- [ ] Approving a campaign post → run payouts → an INFLUENCER batch appears
- [ ] Shipping from the vendor portal makes courier/tracking visible to the buyer
- [ ] A buyer can review a purchase; it shows on the product page and in admin moderation
- [ ] A customer can open a support ticket, an admin reply lands in their thread, and `reconciliation` reports zero drift

---

## 13. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Everything 401s in Swagger | Access token expired (15 min) | Log in, re-Authorize |
| API won't start, `ECONNREFUSED 6381` | Docker not running | `open -a Docker`, wait, restart the API |
| `403 Forbidden` right after picking a role | JWT still holds the old role | Log in again, or `POST /auth/refresh` |
| Portal bounces to `/login` in a loop | Cookies cleared / refresh token revoked | Sign in again; a password change revokes all sessions |
| `.next` JSON/Server-Action errors | `tsc --noEmit` ran while the dev server was up | Kill the server, `rm -rf .next`, restart |
| Signed out unexpectedly mid-test | Logging in elsewhere rotates the refresh token | One portal per browser profile |
| `400 property X should not exist` | Unknown field | The API rejects unknown props — check the DTO |
| Upload returns 503 | No storage keys | Expected — see blocker #1 |
