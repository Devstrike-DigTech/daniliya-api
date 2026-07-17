# UI → Endpoint Map

Every screen and its actions across the five frontends, mapped to the endpoints
in [03-endpoints](./03-endpoints.md). This is the frontend integration contract.

## daniliya-web (public / marketplace / services)

| Screen | Action | Endpoint(s) |
|---|---|---|
| `/shop` | Browse, search, filter, sort | `GET /products?category&chip&q&sort` |
| `/shop/[slug]` | View product + reviews | `GET /products/:slug`, `GET /products/:id/reviews` |
| `/shop/[slug]` | Add to cart (qty, gift wrap) | `POST /cart/items` |
| `/cart` | Update / remove line | `PATCH /cart/items/:id`, `DELETE /cart/items/:id` |
| `/checkout` | Compute totals | `POST /checkout/quote` |
| `/checkout` | Place order (Pay Now / POD) | `POST /orders` → `POST /payments/initialize` |
| `/order/success` | Confirmation | `GET /orders/:ref` |
| `/order/track` | Track by reference | `GET /orders/track?ref=` |
| `/services`, `/services/[slug]` | View verticals | `GET /services`, `GET /services/:slug` |
| `/services`, `/quote` | Submit quote (+attachments) | `POST /media/sign` → `POST /bookings/quote` |
| `/affiliates` | CTA → external portal | (redirect to affiliate portal) |
| `/contact` | Contact form | `POST /support/tickets` (or email) |

## daniliya-affiliate

| Screen | Action | Endpoint(s) |
|---|---|---|
| `/` Overview | KPIs, weekly sales, tier | `GET /affiliate/overview` |
| `/links` | List links, copy, generate QR | `GET /affiliate/links`, `POST /affiliate/links` |
| `/earnings` | Ledger, filter, search | `GET /affiliate/earnings?status&q` |
| `/earnings` | Export CSV | `GET /affiliate/earnings/export` |
| `/payouts` | History + next Monday countdown | `GET /affiliate/payouts` |
| `/payouts` | Request early payout | `POST /affiliate/payouts/request-early` |
| `/referrals` | Referred customers | `GET /affiliate/referrals` |
| `/leaderboard` | Ranking | `GET /affiliate/leaderboard` |
| `/resources` | Creatives / scripts | `GET /affiliate/resources` |
| `/profile` (Bank) | Save payout account | `POST /banks/resolve`, `PATCH /me/bank-accounts/:id` |
| `/profile` (Security) | Password, 2FA, sessions, close | `POST /auth/change-password`, `/2fa/*`, `GET/DELETE /auth/sessions`, `DELETE /auth/account` |
| `/join/*` | Signup→verify→role→kyc→tutorial→assessment | `POST /auth/register`, `/verify-otp`, `/onboarding/role`, `/kyc`, `GET /onboarding/tutorial`, `/assessment`, `POST /assessment/submit` |

## daniliya-influencer

| Screen | Action | Endpoint(s) |
|---|---|---|
| `/` Overview | KPIs, next payout, active campaigns | `GET /influencer/overview` |
| `/campaigns` | List + status filter + search | `GET /influencer/campaigns?status&q` |
| `/campaigns/[id]` | Brief, assets, UTM, promo | `GET /influencer/campaigns/:id` |
| `/campaigns/[id]` | Accept brief | `POST /influencer/campaigns/:id/accept` |
| `/campaigns/[id]` | Toggle checklist | `PATCH /influencer/campaigns/:id/checklist` |
| `/campaigns/[id]` | Submit proof post | `POST /influencer/campaigns/:id/submissions` |
| `/campaigns/[id]` | Download assets | `GET /influencer/campaigns/:id/assets` |
| `/earnings` | CPA earnings + payout history | `GET /influencer/earnings` |
| `/profile` | Personal/KYC, socials, bank | `PATCH /me`, `POST /banks/resolve`, `PATCH /me/bank-accounts/:id` |
| `/join/*` | Signup→verify→role→register(KYC)→review | `POST /auth/register`, `/verify-otp`, `/onboarding/role`, `/onboarding/influencer`, `/kyc` |

## daniliya-vendor

| Screen | Action | Endpoint(s) |
|---|---|---|
| `/` Overview | KPIs, alerts, revenue, top sellers | `GET /vendor/overview` |
| `/products` | List, search, status filter | `GET /vendor/products?status&q` |
| `/products/new`, `/[id]/edit` | Create / edit / delete, stock | `POST /vendor/products`, `PATCH`, `DELETE /vendor/products/:id` |
| `/products/new` | Save draft / submit for review | `POST /vendor/products` (draft) → `POST /vendor/products/:id/submit` |
| `/orders` | List, filter, export | `GET /vendor/orders`, `GET /vendor/orders/export` |
| `/orders/[ref]` | Advance fulfilment | `POST /vendor/orders/:ref/advance` |
| `/reviews` | View + respond | `GET /vendor/reviews`, `POST /vendor/reviews/:id/respond` |
| `/payouts` | History + next Monday, statement | `GET /vendor/payouts` |
| `/payouts` | Update bank details | `PATCH /me/bank-accounts/:id` |
| `/join/*` | Signup→verify→role→business→verification→payouts→review | `POST /auth/register`, `/verify-otp`, `/onboarding/role`, `/onboarding/vendor`, `/kyc`, `PATCH /me/bank-accounts` |

## daniliya-admin

| Screen | Action | Endpoint(s) |
|---|---|---|
| `/` Command centre | GMV, orders, users, attribution, payout queue | `GET /admin/overview` |
| `/affiliates`, `/:id` | List/detail, tier, suspend, message | `GET /admin/affiliates`, `POST /admin/affiliates/:id/tier`, `/suspend`, `/reinstate`, `/message` |
| `/influencers`, `/:id` | List/detail, approve/reject/suspend | `GET /admin/influencers`, `POST .../approve`, `/reject`, `/suspend` |
| `/vendors`, `/:id` | List/detail, approve/reject/suspend | `GET /admin/vendors`, `POST .../approve`, `/reject`, `/suspend` |
| `/orders`, `/:ref` | List/detail, refund, cancel | `GET /admin/orders`, `POST /admin/orders/:ref/refund`, `/cancel` |
| `/products` | Moderate (approve/reject), scope/status filter | `GET /admin/products`, `POST /admin/products/:id/approve`, `/reject` |
| `/bookings`, `/:ref` | Accept/reject/complete/cancel | `GET /admin/bookings`, `POST /admin/bookings/:ref/{accept,reject,complete,cancel}` |
| `/campaigns` | New, list, scope | `GET /admin/campaigns`, `POST /admin/campaigns` |
| `/campaigns/[id]` | Edit, pause/resume/end, assign, moderate submissions, delete asset | `PATCH /admin/campaigns/:id`, `POST .../pause` `/resume` `/end` `/assign`, `.../submissions/:sid/approve` `/reject`, `DELETE .../assets/:aid` |
| `/reviews` | Keep / remove flagged | `POST /admin/reviews/:id/keep`, `/remove` |
| `/payouts`, `/:ref` | Approve/reject/hold/retry/cancel, receipt | `GET /admin/payouts`, `POST /admin/payouts/:ref/{approve,reject,hold,retry,cancel}`, `GET .../receipt` |
| `/finance` | Metrics, reconciliation | `GET /admin/finance/stats`, `/series`, `/reconciliation` |
| `/settings` (General) | Save profile / password / email | `PATCH /me`, `POST /auth/change-password` |
| `/settings` (Team) | Invite, change role, remove | `GET /admin/team`, `POST /admin/team/invite`, `PATCH /admin/team/:id/role`, `DELETE` |
| `/settings` (Notifications) | Toggle | `PATCH /admin/settings/notifications` |
| `/audit-log` | Search trail | `GET /admin/audit-log?actor&action&target` |
| `/support` | Tickets, reply, assign, close | `GET /admin/support/tickets`, `POST .../reply` `/assign` `/close` |
| `/login`, `/verify`, `/forgot`, `/reset` | Admin auth | `POST /auth/login`, `/verify-otp`, `/forgot-password`, `/reset-password` |

---

## Coverage note

This map reflects the **current** frontends (all data is mock; no real fetch
layer exists yet). A few actions are copy-only today and will need endpoints when
built: affiliate QR generation, affiliate "request early payout", vendor review
replies, and campaign-manager messaging. They are included above so the API is
designed for them from day one.
