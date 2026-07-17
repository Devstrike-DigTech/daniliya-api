# Endpoint Catalog

REST endpoints for `daniliya-api`, grouped by module. Base path: `/api/v1`.

**Legend:** 🌐 public · 🔒 authenticated · 👤 role-scoped (owner) · 🛡️ admin (RBAC).
All list endpoints support `?page&limit&q&sort` and return `{ data, meta }`.
Money in/out is **integer kobo**. Mutations that touch money or status emit an
[audit entry](./04-business-rules.md#audit).

---

## 1. Auth & session  `/auth`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/auth/register` | 🌐 | Create account (full_name, dob, email, phone, password) |
| POST | `/auth/verify-otp` | 🌐 | Verify 6-digit email OTP → activate |
| POST | `/auth/resend-otp` | 🌐 | Resend OTP (rate-limited, 50s) |
| POST | `/auth/login` | 🌐 | Email + password → access + refresh tokens |
| POST | `/auth/refresh` | 🔒 | Rotate refresh → new access token |
| POST | `/auth/logout` | 🔒 | Revoke refresh token |
| POST | `/auth/forgot-password` | 🌐 | Email → reset link |
| POST | `/auth/reset-password` | 🌐 | token + new password |
| POST | `/auth/change-password` | 🔒 | current + new |
| POST | `/auth/2fa/enable` · `/2fa/verify` · `/2fa/disable` | 🔒 | TOTP/SMS 2FA |
| GET | `/auth/sessions` · DELETE `/auth/sessions/:id` | 🔒 | List / revoke active sessions |
| DELETE | `/auth/account` | 🔒 | Close account |

## 2. Users & profiles  `/me`, `/users`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/me` | 🔒 | Current user + roles held |
| PATCH | `/me` | 🔒 | Update name/email/phone/dob |
| GET | `/me/notifications` | 🔒 | Notification feed |
| PATCH | `/me/notification-prefs` | 🔒 | Toggle prefs |
| GET | `/me/bank-accounts` · POST · PATCH · DELETE `/:id` | 🔒 | Manage payout bank accounts |
| POST | `/banks/resolve` | 🔒 | Name-enquiry: {bank_code, account_number} → account_name |
| GET | `/banks` | 🌐 | Nigerian bank list (name + code) |

## 3. KYC  `/kyc`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/kyc` | 🔒 | Submit KYC (gov_id_url, bank_account_id) → Smile ID |
| GET | `/kyc/me` | 🔒 | Current KYC status + reviewer note |
| POST | `/kyc/:id/resubmit` | 🔒 | Resubmit after rejection |
| POST | `/webhooks/smile-id` | 🌐† | Smile ID callback (†signature-verified) |
| GET | `/admin/kyc` · POST `/admin/kyc/:id/approve` · `/reject` | 🛡️ | Manual review queue |

## 4. Onboarding & assessment  `/onboarding`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/onboarding/role` | 🔒 | Choose role → creates ONBOARDING_APPLICATION |
| GET | `/onboarding/tutorial` | 🔒 | Affiliate: 5 lessons |
| GET | `/onboarding/assessment` | 🔒 | 10 questions (no answers) |
| POST | `/onboarding/assessment/submit` | 🔒 | answers[] → score, pass≥60%, decrement retake |
| POST | `/onboarding/affiliate` · `/influencer` · `/vendor` | 🔒 | Submit role application details |
| GET | `/onboarding/status` | 🔒 | signup→verify→role→kyc→…→approved/rejected |

## 5. Catalog & products (public + vendor)

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/products` | 🌐 | Marketplace catalogue (`?category&chip&scope&q&sort`) |
| GET | `/products/:slug` | 🌐 | Product detail |
| GET | `/products/:id/reviews` | 🌐 | Product reviews |
| GET | `/vendor/products` | 👤 | Vendor's own products |
| POST | `/vendor/products` | 👤 | Create (draft or submit-for-review) |
| PATCH | `/vendor/products/:id` | 👤 | Edit; manage stock |
| DELETE | `/vendor/products/:id` | 👤 | Delete |
| POST | `/vendor/products/:id/submit` | 👤 | Draft → pending (moderation) |

## 6. Services & bookings  `/services`, `/bookings`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/services` · `/services/:slug` | 🌐 | Verticals (laundry, dry-cleaning, interior, construction) |
| POST | `/bookings/quote` | 🌐/🔒 | Submit quote (vertical, description, budget, date, attachments[]) |
| GET | `/bookings` | 👤 | Customer's bookings |
| GET | `/bookings/:ref` | 👤 | Booking detail |

## 7. Cart & checkout  `/cart`, `/orders`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/cart` · POST `/cart/items` · PATCH `/cart/items/:id` · DELETE | 🔒 | Cart CRUD (qty, gift_wrap) |
| POST | `/checkout/quote` | 🔒 | Compute totals (subtotal + delivery/pickup + tax + gift add-on) |
| POST | `/orders` | 🔒 | Place order → returns order + payment intent |
| POST | `/payments/initialize` | 🔒 | Init Paystack/Flutterwave (or mark POD) |
| POST | `/webhooks/paystack` · `/webhooks/flutterwave` | 🌐† | Payment confirmation (idempotent, signature-verified) |
| GET | `/orders/:ref` | 👤 | Order detail |
| GET | `/orders/track?ref=` | 🌐 | Public tracking by reference |
| GET | `/orders` | 👤 | Customer order history |
| POST | `/orders/:ref/reviews` | 👤 | Leave product/vendor review |

## 8. Affiliate portal  `/affiliate`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/affiliate/overview` | 👤 | KPIs, weekly sales, tier progress, recent sales |
| GET | `/affiliate/links` | 👤 | Master + per-product referral links |
| POST | `/affiliate/links` | 👤 | Generate per-product link + QR |
| GET | `/affiliate/earnings` | 👤 | Ledger (`?status=pending|paid`, search) |
| GET | `/affiliate/earnings/export` | 👤 | CSV export |
| GET | `/affiliate/referrals` | 👤 | Referred customers |
| GET | `/affiliate/leaderboard` | 👤 | Ranking + own position |
| GET | `/affiliate/payouts` | 👤 | Payout history + next-Monday + minimum ₦5,000 |
| POST | `/affiliate/payouts/request-early` | 👤 | Request early payout (if enabled) |
| GET | `/affiliate/resources` | 👤 | Brand creatives / scripts / videos |

## 9. Influencer portal  `/influencer`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/influencer/overview` | 👤 | KPIs, weekly chart, next payout, active campaigns |
| GET | `/influencer/campaigns` | 👤 | Assigned campaigns (`?status`) |
| GET | `/influencer/campaigns/:id` | 👤 | Brief: deliverables, checklist, dos/donts, assets, UTM, promo |
| POST | `/influencer/campaigns/:id/accept` | 👤 | Accept/join assignment |
| PATCH | `/influencer/campaigns/:id/checklist` | 👤 | Toggle checklist item |
| POST | `/influencer/campaigns/:id/submissions` | 👤 | Submit proof post URL |
| GET | `/influencer/campaigns/:id/assets` | 👤 | Download creative assets |
| GET | `/influencer/earnings` | 👤 | CPA earnings + payout history |

## 10. Vendor portal  `/vendor`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/vendor/overview` | 👤 | KPIs, alerts, weekly revenue, top sellers |
| GET | `/vendor/orders` · `/vendor/orders/:ref` | 👤 | Orders + fulfilment detail |
| POST | `/vendor/orders/:ref/advance` | 👤 | Advance fulfilment (Confirm→Packed→Shipped→Delivered) |
| GET | `/vendor/orders/export` | 👤 | CSV |
| GET | `/vendor/reviews` | 👤 | Store reviews + distribution |
| POST | `/vendor/reviews/:id/respond` | 👤 | Reply to a review |
| GET | `/vendor/payouts` | 👤 | Payout history + next Monday (auto) |
| (products in §5) | | | |

## 11. Campaigns — admin-owned  `/admin/campaigns`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/admin/campaigns` | 🛡️ | List (`?scope=platform|vendor`) |
| POST | `/admin/campaigns` | 🛡️ | Create (draft or live) |
| GET | `/admin/campaigns/:id` | 🛡️ | Detail + stats |
| PATCH | `/admin/campaigns/:id` | 🛡️ | Edit |
| POST | `/admin/campaigns/:id/pause` · `/resume` · `/end` | 🛡️ | Lifecycle transitions |
| POST | `/admin/campaigns/:id/assign` | 🛡️ | Assign influencers (generates per-creator UTM/promo) |
| GET | `/admin/campaigns/:id/submissions` | 🛡️ | Post submissions |
| POST | `/admin/campaigns/:id/submissions/:sid/approve` · `/reject` | 🛡️ | Moderate submissions |
| DELETE | `/admin/campaigns/:id/assets/:aid` | 🛡️ | Remove asset |

## 12. Admin — people (moderation)  `/admin`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/admin/affiliates` · `/:id` | 🛡️ | List / detail (`?status&city`) |
| POST | `/admin/affiliates/:id/tier` | 🛡️ | Change tier |
| POST | `/admin/affiliates/:id/suspend` · `/reinstate` | 🛡️ | Account standing |
| GET | `/admin/influencers` · `/:id` | 🛡️ | List / detail |
| POST | `/admin/influencers/:id/approve` · `/reject` · `/suspend` | 🛡️ | Application + standing |
| GET | `/admin/vendors` · `/:id` | 🛡️ | List / detail |
| POST | `/admin/vendors/:id/approve` · `/reject` · `/suspend` | 🛡️ | Application + standing |
| POST | `/admin/*/:id/message` | 🛡️ | Message a user |

## 13. Admin — commerce  `/admin`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/admin/orders` · `/:ref` | 🛡️ | List / detail (commission split shown) |
| POST | `/admin/orders/:ref/refund` · `/cancel` | 🛡️ | Refund (reverses commission) / cancel |
| GET | `/admin/products` | 🛡️ | Catalogue (`?scope&status&category`) |
| POST | `/admin/products/:id/approve` · `/reject` | 🛡️ | Moderation |
| GET | `/admin/bookings` · `/:ref` | 🛡️ | List / detail |
| POST | `/admin/bookings/:ref/accept` · `/reject` · `/complete` · `/cancel` | 🛡️ | Booking lifecycle |
| GET | `/admin/reviews` | 🛡️ | Review queue |
| POST | `/admin/reviews/:id/keep` · `/remove` | 🛡️ | Moderate flagged reviews |

## 14. Admin — money  `/admin/payouts`, `/admin/finance`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/admin/payouts` | 🛡️(finance) | Batches (`?audience&status`) |
| GET | `/admin/payouts/:ref` | 🛡️(finance) | Batch detail + compliance checks + recipients |
| POST | `/admin/payouts/:ref/approve` | 🛡️(finance) | Approve & schedule (gated by compliance) |
| POST | `/admin/payouts/:ref/reject` · `/hold` · `/cancel` | 🛡️(finance) | Lifecycle |
| POST | `/admin/payouts/:ref/retry` | 🛡️(finance) | Retry failed transfers |
| GET | `/admin/payouts/:ref/receipt` | 🛡️(finance) | Receipt CSV |
| POST | `/webhooks/transfer` | 🌐† | Paystack/Flutterwave transfer status |
| GET | `/admin/finance/stats` · `/series` | 🛡️(finance) | Profit / paid-out metrics, revenue-vs-profit |
| GET | `/admin/finance/reconciliation` | 🛡️(finance) | Ledger vs provider settlement |

## 15. Admin — system  `/admin/system`

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/admin/overview` | 🛡️ | Command centre (GMV, orders, users, pending payouts, attribution) |
| GET | `/admin/team` | 🛡️(superadmin) | Team members + roles |
| POST | `/admin/team/invite` | 🛡️(superadmin) | Invite (email + role) |
| PATCH | `/admin/team/:id/role` · DELETE | 🛡️(superadmin) | Change role / remove |
| GET | `/admin/audit-log` | 🛡️ | Audit trail (`?actor&action&target`) |
| GET | `/admin/support/tickets` · `/:id` | 🛡️(support) | Tickets + thread |
| POST | `/admin/support/tickets/:id/reply` · `/assign` · `/close` | 🛡️(support) | Manage tickets |
| GET/PATCH | `/admin/settings/notifications` | 🛡️ | Notification settings |
| GET/PATCH | `/admin/settings/config` | 🛡️(superadmin) | PlatformConfig (fees, min payout, take-rate) |

## 16. Shared — media & support

| Method | Path | Scope | Purpose |
|---|---|---|---|
| POST | `/media/sign` | 🔒 | Signed upload target (Cloudinary/S3) |
| POST | `/support/tickets` | 🔒 | Open a ticket |
| GET | `/support/tickets` · `/:id` | 🔒 | Own tickets + thread |
| POST | `/support/tickets/:id/reply` | 🔒 | Reply |

---

### Webhooks summary (all idempotent + signature-verified)

| Endpoint | Source | Effect |
|---|---|---|
| `/webhooks/paystack`, `/webhooks/flutterwave` | Payment | Mark order paid → create conversion/commission → fulfilment |
| `/webhooks/transfer` | Payout rail | Update PAYOUT_ITEM/TRANSFER status (paid/failed) |
| `/webhooks/smile-id` | KYC | Update KYC_RECORD → gate payouts/activation |
