# Daniliya — Manual Test Guide

How to exercise the whole platform by hand: every module through Swagger, then
the same ground covered through the five portals, organised as the user journeys
that carry each of the product's value propositions.

Every payload below was run against the live server while writing this guide.
Where something cannot currently be completed, it is called out in
[Known blockers](#9-known-blockers--expected-failures) rather than left for you
to discover.

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

Start a portal with `npm run dev` in its own directory. Each one already has its
port pinned in `package.json`.

Health check before you begin:

```bash
curl -s http://localhost:4000/api/v1/products | head -c 120
```

### 1.2 Authorising in Swagger

Most endpoints need a bearer token.

1. `POST /auth/login` in Swagger, or:
   ```bash
   curl -s -X POST http://localhost:4000/api/v1/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@daniliya.com","password":"AdminPass1"}'
   ```
2. Copy `data.accessToken`.
3. Click **Authorize** (top right in Swagger), paste the token, Authorize, Close.

**Access tokens expire after 15 minutes.** A sudden wall of `401 Unauthorized`
usually means the token lapsed — log in again and re-Authorize. The refresh
token lasts 7 days; `POST /auth/refresh` rotates the pair.

### 1.3 Reading responses

Every success is wrapped:

```json
{ "success": true, "data": { … }, "timestamp": "2026-07-18T…" }
```

**All money is a string** (`"38000"`), never a number — it is `Decimal(12,2)` in
Postgres. Parse before arithmetic, and never do money maths in the browser: the
server is the authority.

### 1.4 Getting the OTP (dev)

Registration emails aren't really sent. The 6-digit code is written to the API
log by the dev mailer:

```
[dev-mail] OTP for someone@example.com: 481902
```

If you started the API with output redirected to a file:

```bash
grep "OTP for someone@example.com" api.log | tail -1 | grep -oE '[0-9]{6}' | tail -1
```

The log line carries ANSI colour codes, so **do not anchor the match with `$`**
— that silently fails. Same for the password-reset token.

### 1.5 Accounts you can use

| Role | Email | Password |
|---|---|---|
| Admin | `admin@daniliya.com` | `AdminPass1` |
| Affiliate (active, has commissions) | `nkem.adaeze.0718@example.com` | `AffPass2` |
| Creator (approved, on a campaign) | `tola.adeyemi.0718@daniliya.test` | `CreatorPass1` |
| Vendor (approved, has orders) | `tunde.balogun.vendor1@example.com` | `VendPass1` |

Existing test data worth knowing: affiliate code `TUN-19B1` (₦20,000 lifetime,
2 conversions), campaign **Glow Season Creator Push** (CPA ₦3,500, promo
`DAN-3D18AF`), vendor **Bisi Home Essentials** (10% take rate, product *Lavender
Floor Cleaner 5L* @ ₦9,500), and orders `DNL-7A4671` / `DNL-C86F5A` (both
shipped, so both have live tracking).

Create fresh accounts freely — the flows below build their own.

---

## 2. Test data conventions

Use recognisable, disposable values so you can find your own test rows later:

- Emails: `yourname+affiliate1@example.com`
- Phones: **must be unique per account.** Reusing one now returns a clear 409;
  vary the last digits.
- Money: send plain numbers in requests (`9500`), expect strings back (`"9500"`).
- Dates: full ISO — `2026-08-01T00:00:00.000Z`. An `<input type="date">` value
  like `2026-08-01` is rejected by `@IsDateString` fields; convert first.

---

## 3. Module-by-module API tests (Swagger)

Work top to bottom the first time — later modules depend on earlier ones.

### 3.1 Auth & accounts

| Endpoint | Purpose |
|---|---|
| `POST /auth/register` | Create an account |
| `POST /auth/verify-otp` | Confirm the 6-digit code |
| `POST /auth/resend-otp` | New code (50s cooldown) |
| `POST /auth/login` | Tokens |
| `POST /auth/refresh` | Rotate the pair |
| `POST /auth/logout` | Revoke the refresh token |
| `POST /auth/forgot-password` → `POST /auth/reset-password` | Reset by emailed token |
| `POST /auth/change-password` | Signed in |
| `GET /auth/me` | Current user |

**Register**

```json
{
  "email": "yourname+aff1@example.com",
  "password": "TestPass1",
  "firstName": "Ada",
  "lastName": "Obi",
  "phone": "+2348030009911"
}
```

**Verify**

```json
{ "email": "yourname+aff1@example.com", "code": "481902" }
```

Checks worth making:

- Registering the same email twice → **409**, not 500.
- Registering a **phone** already in use → **409** naming the phone.
- Logging in before verifying → **401 "Verify your email before signing in"**.
- Wrong password and unknown email give the *same* message — that is deliberate,
  so the API doesn't reveal which emails exist.
- `POST /auth/change-password` revokes all sessions; you must sign in again.

### 3.2 Catalogue (public — no token)

| Endpoint | Notes |
|---|---|
| `GET /products?q=&category=&page=&limit=` | `limit` max 60 |
| `GET /products/categories` | For filter chips |
| `GET /products/:slug` | 404 for anything not ACTIVE |

Only **ACTIVE** products are ever public. To prove it: as admin,
`POST /admin/products/{id}/reject`, then re-request the catalogue — the count
drops and `GET /products/{slug}` 404s.

Note the shapes differ: the list returns `blurb` + `image`; the detail returns
`description`, `images[]`, `vendor` and `stockQuantity`.

### 3.3 Cart (signed in)

`GET /cart` · `POST /cart/items` · `PATCH /cart/items/:id` · `DELETE /cart/items/:id` · `DELETE /cart`

```json
{ "productId": "<uuid>", "quantity": 2, "giftWrap": true }
```

The **storefront does not use this cart** — it keeps the basket in the browser so
shopping never requires an account. This endpoint is for signed-in API clients.

### 3.4 Checkout & orders

| Endpoint | Auth | Purpose |
|---|---|---|
| `POST /checkout/guest-quote` | public | Totals for a browser-held basket |
| `POST /orders/guest` | public | **Buy without an account** |
| `POST /checkout/quote` | user | Totals for the server cart |
| `POST /orders` | user | Order from the server cart |
| `GET /orders` · `GET /orders/:ref` | user | My orders (owner only) |
| `GET /orders/track?ref=` | **public** | Tracking by reference |

**Guest quote**

```json
{
  "mode": "DELIVERY",
  "items": [{ "productId": "<uuid>", "quantity": 2, "giftWrap": false }]
}
```

Pricing is fixed platform-wide: delivery **₦8,500** (zero on `PICKUP`), tax
**₦2,500**, gift wrap **₦1,500** per wrapped line. Verify the arithmetic:
2 × ₦13,500 + 8,500 + 2,500 = **₦38,000**; switch to `PICKUP` → **₦29,500**.

**Place a guest order**

```json
{
  "mode": "DELIVERY",
  "paymentMethod": "PAY_ON_DELIVERY",
  "contact": {
    "fullName": "Chidi Okeke",
    "email": "yourname+buyer1@example.com",
    "phone": "+2348030001111"
  },
  "deliveryAddress": { "street": "12 Awolowo Rd", "city": "Ikoyi", "state": "Lagos" },
  "affiliateCode": "TUN-19B1",
  "items": [{ "productId": "<uuid>", "quantity": 2 }]
}
```

- `mode`: `DELIVERY` | `PICKUP` — `deliveryAddress` is **required** for `DELIVERY`.
- `paymentMethod`: `PAYSTACK` | `FLUTTERWAVE` | `PAY_ON_DELIVERY`. There is no
  `CARD` — that string 400s.
- POD returns **CONFIRMED** immediately. `PAYSTACK` returns **PENDING** plus an
  `authorizationUrl`; see [blockers](#9-known-blockers--expected-failures).
- `affiliateCode` sets `channel: AFFILIATE`; `promoCode` sets `INFLUENCER`.

**Price tampering is not possible** — only `productId` and `quantity` are read
from the request; price and availability come from the database. Try sending a
price field: it is rejected as an unknown property.

### 3.5 Services & bookings

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /services` | public | The four verticals |
| `GET /services/:slug` | public | One vertical |
| `POST /bookings/quote` | **public or signed in** | Request a service quote |
| `GET /bookings` · `GET /bookings/:ref` | user | My bookings |
| `GET /admin/bookings` + `accept`/`start`/`complete`/`reject`/`cancel` | admin | Manage |

```json
{
  "verticalSlug": "laundry",
  "name": "Test Guest",
  "email": "yourname+quote1@example.com",
  "phone": "+2348050001234",
  "description": "Weekly laundry for a 3-bedroom flat",
  "city": "Lagos",
  "budget": 25000
}
```

Returns `BKG-…` with status `REQUESTED`. Then walk it as admin:
`accept` → `start` → `complete`, and confirm the customer's `GET /bookings/:ref`
reflects each step.

Accepting is where the price is set — the note field is **`note`**, not
`adminNote` (the response echoes it back as `adminNote`, which is easy to
mirror wrongly):

```json
{ "quotedAmount": 45000, "note": "Includes pickup and delivery within Lekki." }
```

The booking moves to `CONFIRMED` with `quotedAmount` set.

### 3.6 Affiliate

| Endpoint | Purpose |
|---|---|
| `GET /affiliate/overview` | Code, tier, lifetime, pending, conversions |
| `GET /affiliate/links` | Master link + a link per product |
| `GET /affiliate/earnings` | Summary + commission records |
| `GET /affiliate/referrals` | Customers referred |
| `GET /affiliate/leaderboard` | Top affiliates; `myRank` is null outside it |

Onboarding: `GET /onboarding/status` → `POST /onboarding/role {"role":"AFFILIATE"}`
→ `GET /onboarding/tutorial` → `POST /onboarding/tutorial/:stepId/complete` ×5
→ `GET /onboarding/assessment` → `POST /onboarding/assessment/submit`.

```json
{ "answers": [{ "questionId": "<uuid>", "selected": "Every Monday" }] }
```

`selected` is the **option text**, not an index. Ten questions, 60% to pass,
graded server-side. Passing activates the account and mints the referral code.
Answer key, so you can drive a pass or a deliberate fail:

| Question | Correct answer |
|---|---|
| How often does Daniliya pay out…? | Every Monday |
| How much do you earn on each book sale…? | ₦10,000 flat |
| What do you share with customers…? | Your unique per-product payment link |
| What must you complete before activation? | KYC, the tutorial and this assessment |
| Which documents are required for KYC? | A government-issued ID and your bank account details |
| Order of the commission lifecycle? | Pending → Confirmed → Disbursed |
| What happens on a refund? | The related commission is reversed |
| Is there a cap on earnings? | No, commission scales with your sales |
| Acceptable way to share your link? | Posting on your WhatsApp status and socials |
| Pass mark? | 60% |

**Gotcha:** `GET /onboarding/assessment` 400s with *"Finish the tutorial first"*
until all five lessons are complete.

**Gotcha:** after `POST /onboarding/role` the JWT still carries the old
`CUSTOMER` role, so `/affiliate/*` 403s until you refresh or log in again.

### 3.7 Influencer / campaigns

| Endpoint | Role | Purpose |
|---|---|---|
| `POST /onboarding/influencer` | user | Apply |
| `GET /influencer/campaigns` | creator | Assigned campaigns |
| `POST /influencer/campaigns/:id/accept` | creator | Accept a brief |
| `POST /influencer/campaigns/:id/submissions` | creator | Submit a post |
| `GET /influencer/earnings` | creator | Summary + records |
| `POST /admin/campaigns` … `/assign` … `/submissions` | admin | Run campaigns |

**Application** — the field is `contentLinks`, *not* `contentSamples`; unknown
properties are rejected outright:

```json
{
  "niche": "Beauty & Lifestyle",
  "followerCount": 48200,
  "socialHandles": { "instagram": "@zara.beauty", "tiktok": "@zarabeauty" },
  "contentLinks": ["https://instagram.com/p/sample1"]
}
```

**Create a campaign (admin)**

```json
{
  "title": "Glow Season Creator Push",
  "brief": "Show the serum in your morning routine.",
  "productIds": ["<uuid>"],
  "payoutModel": "FLAT",
  "flatAmount": 3500,
  "startDate": "2026-07-01T00:00:00.000Z",
  "endDate": "2026-12-31T00:00:00.000Z"
}
```

`payoutModel` is `FLAT` (needs `flatAmount`) or `COMMISSION` (needs
`commissionRate`). Assign with **`influencerUserIds`** — user ids, not profile
ids: `{"influencerUserIds":["<userId>"]}`. Assignment issues a promo code and
UTM link per creator.

**Submit a post**

```json
{ "postUrl": "https://instagram.com/p/my-post", "hasAdDisclosure": true }
```

Worth checking: accept or submit on a **PAUSED or ENDED** campaign returns
`400 "This campaign has ended"` — enforced server-side, so the portal's guard
cannot be bypassed by calling the API directly.

There is **no `/influencer/overview`**; the portal home composes from campaigns
and earnings.

### 3.8 Vendor

| Endpoint | Purpose |
|---|---|
| `POST /onboarding/vendor` | Apply — **only** `businessName` + `productCategory` |
| `GET /vendor/overview` | Products, despatch queue, sales, earnings, rating |
| `GET/POST/PATCH/DELETE /vendor/products` | Manage listings |
| `POST /vendor/products/:id/submit` | DRAFT → PENDING_REVIEW |
| `GET /vendor/orders` · `GET /vendor/orders/:ref` | Orders containing my items |
| `POST /vendor/orders/:ref/ship` | **Record despatch** |
| `GET /vendor/reviews` · `POST /vendor/reviews/:id/respond` | Reputation |

**Create a product** (always born `DRAFT` — a vendor cannot self-publish):

```json
{
  "title": "Lavender Floor Cleaner 5L",
  "description": "Concentrated, low-suds, safe on tiles and wood.",
  "price": 9500,
  "stockQuantity": 40,
  "category": "Home"
}
```

Then `POST /vendor/products/{id}/submit` → `PENDING_REVIEW` → admin
`POST /admin/products/{id}/approve` → `ACTIVE` and publicly buyable.

**Ship an order** — the most important vendor call:

```json
{
  "courier": "GIG Logistics",
  "trackingNumber": "GIG-4471X2",
  "estimatedDelivery": "2026-07-22T00:00:00.000Z"
}
```

Only `courier` is required. Then confirm the buyer sees it:

```bash
curl -s "http://localhost:4000/api/v1/orders/track?ref=DNL-XXXXXX"
```

`courier`, `trackingNumber` and `estimatedDelivery` should now be populated.
**Before this endpoint existed nothing ever created a shipment**, so this round
trip is the single best proof the fulfilment path works.

Checks: a vendor sees only *their* lines and `vendorSubtotal` (not the order
total, which includes platform delivery and tax); another vendor's order 404s on
both read and ship; a cancelled/refunded order refuses shipping; re-shipping
edits courier details but keeps the original despatch time.

### 3.9 Reviews

`GET /products/:productId/reviews` (public) · `POST /reviews` (buyer) ·
`POST /vendor/reviews/:id/respond` (vendor) · `GET /admin/reviews` +
`flag`/`keep`/`remove` (admin).

```json
{ "productId": "<uuid>", "rating": 5, "body": "Arrived next day, exactly as described." }
```

### 3.10 Payouts, wallet & ledger

| Endpoint | Role |
|---|---|
| `GET /me/payouts` | Any earner — wallet balance + history |
| `POST /admin/payouts/run` | Admin — build a batch |
| `GET /admin/payouts` · `GET /admin/payouts/:ref` | Admin |
| `POST /admin/payouts/:ref/approve` · `retry` · `hold` · `cancel` | Admin |
| `GET /admin/payouts/reconciliation` | **Ledger drift check** |

Reconciliation should always report `drift: 0` / `balanced: true`. If it does
not, stop and investigate — that is the double-entry ledger disagreeing with
wallet balances, which should never happen.

A payout run is also guarded by a Redis lock: fire `POST /admin/payouts/run`
twice quickly and the second should be refused rather than double-paying.

### 3.11 Banks & KYC

`GET /banks` · `POST /banks/resolve` · `GET/POST /me/bank-accounts` ·
`POST /me/bank-accounts/:id/default` · `DELETE /me/bank-accounts/:id` ·
`GET /kyc/me` · `POST /kyc` · admin `GET /admin/kyc` + `approve`/`reject`.

```json
{ "accountNumber": "0123456789", "bankCode": "058", "isDefault": true }
```

The account **name is resolved server-side** — never send it.

```json
{
  "govIdType": "NIN slip",
  "govIdUrl": "https://files.example.com/id.jpg",
  "bankAccountId": "<uuid>"
}
```

`govIdType` must be exactly one of: `NIN slip`, `Driver's licence`,
`International passport`, `Voter's card`.

⚠️ **Bank account creation currently fails — see [blockers](#9-known-blockers--expected-failures).**

### 3.12 Support

`POST /support/tickets` · `GET /support/tickets` · `GET /support/tickets/:ref` ·
`POST /support/tickets/:ref/reply`; admin equivalents under
`/admin/support/tickets` plus `assign` and `close`.

```json
{ "subject": "Order not delivered", "body": "DNL-7A4671 hasn't arrived.", "priority": "HIGH" }
```

### 3.13 Admin

`GET /admin/overview` · `finance/stats` · `audit-log` · `settings/config` (+ `PATCH`) ·
`team` (+ `invite`, `:id/role`, `DELETE`) · `people` (affiliates / influencers /
vendors, each with `approve` / `reject`) · `orders` (+ `refund`, `cancel`) ·
`products` (+ `approve`, `reject`) · `bookings` · `campaigns` · `payouts` ·
`reviews` · `kyc`.

Update platform pricing:

```json
{ "values": { "DELIVERY_FEE": "9000", "AFFILIATE_COMMISSION": "12000" } }
```

Team writes are **SUPERADMIN only** — a FINANCE or SUPPORT admin gets 403, which
is worth confirming deliberately.

Every money- or status-affecting admin action should appear in
`GET /admin/audit-log` with actor, target and before/after. Spot-check after
approving a product or running payouts.

### 3.14 Webhooks

`POST /webhooks/paystack` and `POST /webhooks/transfer`, both public, both
verified by an **HMAC-SHA512 signature over the raw body** in the
`x-paystack-signature` header. An unsigned or wrongly-signed call must be
rejected — try one and confirm.

Replaying the *same* event twice must not double-credit anything: events are
de-duplicated on `externalEventId`. Send an identical payload twice and confirm
the second is ignored.

---

## 4. Journey 1 — "Shop and book, without signing up"

> **Value proposition:** anyone can buy a product or request a service in
> minutes, with no account, and still get updates and tracking. An account is
> optional and, if created later, inherits everything.

### 4.1 API

1. `GET /products` — pick a product id.
2. `POST /checkout/guest-quote` — check the arithmetic by hand.
3. `POST /orders/guest` with `PAY_ON_DELIVERY` → note the `DNL-…` ref.
4. `GET /orders/track?ref=…` — no token needed.
5. `POST /auth/register` **with the same email used at checkout** →
   response includes `"claimedGuestOrders": true`.
6. Verify OTP, log in, `GET /orders` → **the guest order is there.**
7. `POST /bookings/quote` as a guest → `BKG-…`.

Step 6 is the point of the journey: the buyer was never forced to register, and
lost nothing by not doing so.

### 4.2 Frontend (`:3000`)

1. `/shop` — search, filter by category, open a product.
2. Add to cart, set quantity, tick gift wrap.
3. `/cart` → `/checkout`. **Watch the totals change** when you switch
   Delivery ↔ Pickup — they must match the server quote exactly.
4. Fill contact details, choose Pay on Delivery, place the order.
5. Land on the success page with the real reference.
6. `/order/track`, paste the ref → status and items.
7. Open a devtools console and run `document.cookie` — **no token is visible**;
   they are httpOnly.

Then have a vendor ship that order (Journey 4) and re-check tracking: courier
and tracking number appear where the page previously said "Not assigned".

---

## 5. Journey 2 — "Share a link, get paid every Monday"

> **Value proposition:** anyone can join, prove they understand the rules, and
> earn a flat ₦10,000 per confirmed sale, with transparent attribution.

### 5.1 API

1. Register + verify a new user.
2. `POST /onboarding/role {"role":"AFFILIATE"}`.
3. **Log in again** (the token still says CUSTOMER).
4. Complete all five tutorial steps.
5. `GET /onboarding/assessment`, then submit with **wrong** answers → expect
   `passed: false` and `retakesLeft` decremented.
6. Submit with the correct answers → `passed: true`, `isActive: true`, and a
   referral code like `NKE-2D7D`.
7. `GET /affiliate/links` → copy the master link's `?ref=CODE`.
8. Place a guest order (Journey 1) passing that `affiliateCode`.
9. `GET /affiliate/overview` → conversions +1, pending +₦10,000.
10. `GET /affiliate/earnings` → a record with the order ref and status `PENDING`.

### 5.2 Frontend (`:3001`)

1. `/join/signup` → verify → role → tutorial → assessment.
2. Fail deliberately: the fail screen must show a **real** retakes-left count.
3. Pass: land on the success screen with your actual referral code.
4. Try to jump back to `/join/pass` after a failure, or to `/join/role` after
   activation — the server should bounce you. **Join progress cannot be forged
   from the browser.**
5. Dashboard: overview figures match the API; `/links`, `/earnings`,
   `/referrals`, `/leaderboard`, `/payouts`.
6. Sign out, then try a dashboard URL directly → redirected to `/login` and
   **not** silently signed back in.

---

## 6. Journey 3 — "Creators earn from campaigns"

> **Value proposition:** a creator applies, is vetted, receives briefs with clear
> payout terms, posts, and is paid per conversion — with their own promo code and
> trackable link.

### 6.1 API

1. Register + verify.
2. `POST /onboarding/influencer` with the application payload (§3.7).
   This sets the role itself — **do not** call `/onboarding/role` first.
3. Log in again (stale role claim).
4. As admin: `GET /admin/influencers` → `POST /admin/influencers/{id}/reject`
   with a reason → check `GET /onboarding/status` shows `rejected` **and the
   reason**. Then `approve`.
5. As admin: create a campaign, then `assign` the creator by **user id**.
6. As creator: `GET /influencer/campaigns` → note `promoCode` and `cpa`.
7. `POST …/accept`, then `POST …/submissions`.
8. Place a guest order with that `promoCode`.
9. `GET /influencer/earnings` → conversions +1, pending += CPA.
   `GET /influencer/campaigns` → that campaign's `conversions` also +1.

Step 9 checks both counters agree — they disagreed until recently, so it is a
good regression test.

### 6.2 Frontend (`:3002`)

1. `/join` — apply, land on the awaiting-review screen.
2. Reject as admin, reload → the **reviewer's exact words** appear.
3. Approve, reload → routed to the dashboard.
4. `/campaigns` — the ACTIVE brief offers Accept and Submit; an ENDED one does
   not, and says so.
5. Submit a post **without** ticking the ad-disclosure box → refused.
6. Submit properly → the post appears in the list.
7. `/earnings` matches the API.

---

## 7. Journey 4 — "Sell on Daniliya and get paid"

> **Value proposition:** a vendor lists products, has them reviewed for quality,
> fulfils orders, keeps 90% of the sale, and can see exactly what they are owed.

### 7.1 API

1. Register + verify → `POST /onboarding/vendor`
   `{"businessName":"Bisi Home Essentials","productCategory":"Home & Cleaning"}`.
2. Admin approves → log in again.
3. `POST /vendor/products` → `DRAFT`.
4. `POST /vendor/products/{id}/submit` → `PENDING_REVIEW`.
5. Admin `POST /admin/products/{id}/approve` → `ACTIVE`; confirm it now appears
   in the public `GET /products`.
6. Place two guest orders for it.
7. `GET /vendor/overview` — check the maths:
   gross counts **only the vendor's lines**, and
   `earnings.pending == gross × (1 − takeRateBps/10000)`.
   With a 10% take rate: ₦38,000 gross → **₦34,200**.
8. `GET /vendor/orders` → the despatch queue.
9. `POST /vendor/orders/{ref}/ship`.
10. `GET /orders/track?ref=…` → **courier and tracking now visible to the buyer.**

### 7.2 Frontend (`:3003`)

1. `/join` — apply, get approved, reach the dashboard.
2. `/products/new` — save a draft, then submit for review. The copy should make
   clear an admin publishes it; you cannot self-publish.
3. Have an admin reject it with a reason → the reason shows on the list and the
   edit page.
4. `/orders` → open a CONFIRMED order → despatch form → ship it.
5. The page flips to "Despatched" with courier and tracking, and offers to
   **correct** the details rather than ship again.
6. Open a cancelled or unpaid order → no despatch form at all.
7. `/payouts` shows the real wallet balance; `/reviews` shows a proper empty
   state when there are none.

---

## 8. Journey 5 — "Run the whole platform from one place"

> **Value proposition:** one console to approve people and products, moderate
> content, move money, and account for every decision.

### 8.1 API

1. `GET /admin/overview`, `GET /admin/finance/stats`.
2. Approve/reject an affiliate, creator, vendor and product.
3. `GET /admin/orders`, then `refund` or `cancel` one and confirm the customer's
   view changes.
4. Walk a booking `accept` → `start` → `complete`.
5. `POST /admin/payouts/run`, inspect the batch, `approve` it, then
   `GET /admin/payouts/reconciliation` → **`drift: 0`**.
6. `PATCH /admin/settings/config` to change the delivery fee, then re-quote a
   basket and watch the total move.
7. `GET /admin/audit-log` — every action above should be recorded with actor and
   before/after values.
8. RBAC: invite a `SUPPORT` teammate, sign in as them, and confirm team writes
   and payout approvals are **403**.

### 8.2 Frontend (`:3004`)

Sign in as `admin@daniliya.com`. Walk every list: affiliates, influencers,
vendors, orders, products, bookings, payouts, finance, campaigns, reviews,
support, audit log — then open a detail page from each list and confirm the row
you clicked is the record you land on. Then `/settings` for team, roles and
platform config.

---

## 9. Known blockers & expected failures

These are environment or product gaps, **not** bugs to chase. Everything else
should work.

| # | What you'll hit | Why | Impact |
|---|---|---|---|
| 1 | `POST /me/bank-accounts` → **503** "Bank verification is not configured correctly" | A Paystack key is set and lists banks fine, but Paystack rejects it for *name enquiry* (401/403) | **KYC cannot be completed at all**, since it requires a bank account. Needs a key with resolve permissions — not a code change |
| 2 | Paystack checkout returns `simulated: true` and a `checkout.simulated` URL | No live payment key | Card payment cannot be completed end to end. Use `PAY_ON_DELIVERY` for full-flow testing |
| 3 | Every product has no image | No imagery seeded, and there is **no upload endpoint anywhere** | Portals show a branded placeholder by design |
| 4 | `clicks` is always `0` | Nothing tracks link clicks | Portals present it as unavailable rather than a real zero |
| 5 | `GET /kyc/me` says `{"status":"PENDING","submitted":false}` | Status defaults before submission | Reads as contradictory; portals render "Not submitted" |
| 6 | An affiliate can reach `isActive: true` with `kycStatus: null` | Passing the assessment activates the account before KYC | **Product decision needed** — people can earn before verification |
| 7 | An order split across two vendors shares one shipment | `Shipment` is unique per order | Fine while orders are single-vendor; needs a shipment per vendor before multi-vendor baskets |
| 8 | No way to mark an order `DELIVERED` | No endpoint | Buyer-visible status stops at `SHIPPED` |
| 9 | No profile-update endpoint | — | Personal details are read-only in every portal |

---

## 10. Quick regression checklist

Ten checks that between them cover the money paths and the guarantees most
likely to break:

- [ ] Guest can buy with no account, and the order is trackable by reference
- [ ] Checkout total equals the server quote exactly, in both fulfilment modes
- [ ] Registering with a guest's email claims that order history
- [ ] Non-ACTIVE products never appear in the public catalogue
- [ ] Affiliate assessment grades server-side; 60% activates and mints a code
- [ ] `?ref=` on an order produces a ₦10,000 affiliate commission
- [ ] A promo-code order increments **both** creator earnings and campaign conversions
- [ ] Accept/submit are refused on a PAUSED or ENDED campaign, via the API directly
- [ ] Shipping from the vendor portal makes courier and tracking visible to the buyer
- [ ] `GET /admin/payouts/reconciliation` reports **zero ledger drift**

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Everything 401s in Swagger | Access token expired (15 min) | Log in, re-Authorize |
| API won't start, `ECONNREFUSED 6381` | Docker not running | `open -a Docker`, wait, restart the API |
| `403 Forbidden resource` right after picking a role | JWT still holds the old role | Log in again, or `POST /auth/refresh` |
| Portal bounces you to `/login` in a loop | Cookies cleared or refresh token revoked | Sign in again; a password change revokes all sessions |
| `.next` JSON parse errors | `npx tsc --noEmit` ran while the dev server was up | Kill the server, `rm -rf .next`, restart |
| Signed out unexpectedly mid-test | Logging in elsewhere rotates the refresh token | Use one portal per browser profile |
| `400 property X should not exist` | Unknown field | The API rejects unknown properties — check the DTO |
