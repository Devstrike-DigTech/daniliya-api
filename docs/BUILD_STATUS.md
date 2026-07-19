# Daniliya — what is built, what is not

An audit of the whole project as of 2026-07-19, done by enumerating every API
endpoint (145 across 26 controllers) and checking which ones any portal actually
calls, rather than from memory. Findings below are evidence-based; where
something was not checked, it says so.

---

## 1. Summary

| Layer | State |
|---|---|
| API | Substantially complete — 145 endpoints across auth, catalogue, checkout, bookings, affiliate, campaigns, vendor, reviews, payouts, ledger, support, admin, webhooks |
| Storefront | Buying, booking and customer accounts are live end to end |
| Affiliate portal | Complete — join flow and dashboard on real data |
| Influencer portal | Complete — application flow and dashboard on real data |
| Vendor portal | Complete — including fulfilment, which creates the buyer's tracking |
| Admin portal | Reads complete; writes wired except 6 controls with no endpoint |

**Update (2026-07-19):** the admin write actions, the service-quote flow and
customer accounts have since been wired — see §2 and §3, which now record what
was done. The remaining gaps are support ticketing and product reviews (both
API-complete, no customer-facing UI), and the configuration blockers in §6.

---

## 2. Admin write actions — now wired

Was: 40 buttons across the admin portal with no handler at all. Now: **6**, and
every one of those six has no endpoint behind it (§5).

Wired, each through a Server Action and a shared `ActionButton` that renders the
API's own error rather than swallowing it, with confirmation on destructive work:

| Area | Actions |
|---|---|
| Payouts | run, approve & schedule, hold, retry, cancel |
| Campaign submissions | approve, reject with a note |
| People | vendor/influencer approve + reject, suspend, reinstate, message, affiliate tier |
| Commerce | product approve/reject, order refund/cancel, the booking lifecycle |
| Moderation | review flag/keep/remove, ticket reply/assign/close |

### 2.1 The chain that blocked creator payouts is open

`confirmEligible()` only promotes an influencer commission once the campaign
post is APPROVED, and nothing could approve one. With submission review and the
payout run wired, a real run produced `PB-471DC5C6` — the first INFLUENCER batch
in the system — for ₦10,500, with ledger reconciliation at zero drift.

**Money still cannot leave the platform**, but the blocker has moved from
missing UI to compliance: approving a batch correctly returns
*"Compliance checks must all pass before approval"* because no recipient can
pass KYC, and KYC is impossible until the Paystack key gains name-enquiry
permission (§6). That is now the single thing standing between the platform and
paying people.

## 3. Whole features with no interface anywhere

| Feature | API | UI |
|---|---|---|
| **Support ticketing** | `POST/GET /support/tickets`, replies, plus the admin side | **Done both ends.** Customers raise and reply at /support; admins reply, assign and close. Verified round trip: customer ticket → admin queue → admin reply → visible in the customer's thread |
| **Product reviews** | `GET /products/:id/reviews`, `POST /reviews`, vendor respond, admin moderate | **Done.** Product pages show ratings, reviews and vendor replies; buyers write one from /account against the order containing the item. Vendor replies and admin moderation now have real input |
| **Customer accounts** | `/auth/*`, `GET /orders`, `GET /bookings` | **Done.** `/account` offers sign in and registration, and lists orders and service requests. Registering with an email that checked out as a guest claims that history, and the verify screen says so |

**No API-complete feature is now missing its interface.** Every endpoint that
represents a user-facing capability has a way in and a way to see the result.

One rough edge on reviews: no endpoint reports what a customer has already
reviewed, so the "Write a review" control reappears after a reload even for a
product they have reviewed. The duplicate attempt is refused clearly with the
API's own message, but a "my reviews" endpoint would let the UI hide it.

---

## 4. Smaller unwired endpoints

- `DELETE /me/bank-accounts/:id`, `POST /me/bank-accounts/:id/default` — accounts can be added, not managed.
- `GET /services/:slug` — the storefront uses the list plus local marketing copy; the per-vertical endpoint returns empty `services[]`/`portfolio[]` anyway.
- `POST /banks/resolve` — blocked upstream (see §6).
- `GET /cart`, `POST /cart/items`, … — deliberate: the storefront keeps the basket in the browser so shopping needs no account. The endpoints are for API clients.
- `POST /webhooks/paystack`, `/transfer` — inbound; nothing for a portal to call.

---

## 5. UI with no endpoint behind it

These controls exist in the design but nothing can serve them. They should
either be built API-side or removed:

- **Export CSV / Export ledger / Download receipt** on several admin pages.
- **Filter** buttons on audit-log, bookings and payouts lists.
- **Offer retainer** on the influencer detail page — no concept in the data model.

---

## 6. Blocked by configuration, not code

| Item | Detail |
|---|---|
| **KYC** | `POST /me/bank-accounts` → 503. A Paystack key is set and lists banks, but Paystack rejects it for name enquiry (401/403). KYC needs a bank account, so the whole step is impassable. Needs a key with resolve permissions |
| **Card payment** | No live payment key, so Paystack returns `simulated: true` and a fake checkout URL. Only Pay on Delivery completes |
| **Email/SMS** | The dev mailer logs OTPs to the console. No real email or SMS is sent to anyone, ever |
| **File uploads** | **Built and wired.** `POST /uploads?purpose=kyc\|product\|booking\|campaign`, switchable Cloudinary/R2 via `UPLOAD_DRIVER`. Wired into the storefront quote attachments, vendor product images and the affiliate/vendor KYC document fields. Needs keys — every upload 503s honestly until they land, then works with no code change |
| **Product imagery** | Vendors can now attach images (they persist and render on the storefront), but only once storage keys are configured — until then uploads 503. No seeded imagery on existing products |

---

### 6.1 KYC documents and public URLs

The upload endpoint returns a publicly fetchable URL, which is right for
product images and wrong for identity documents. Before real IDs are accepted,
KYC needs either a private bucket with signed, expiring delivery (R2) or
authenticated delivery type (Cloudinary), plus a decision about retention.
Flagged rather than quietly shipping ID scans to a public URL.

---

## 7. Product decisions still open

- **Activation without KYC.** An affiliate reaches `isActive: true` with `kycStatus: null` — passing the assessment activates them before any verification. They can earn before being verified.
- **Click tracking** does not exist; `clicks` is permanently 0 on affiliate and creator surfaces.
- **Multi-vendor orders.** `Shipment` is unique per order, so a basket spanning two vendors shares one courier record. Fine today; needs a shipment per vendor before that ships.
- **No `DELIVERED` status transition** — buyer-visible tracking stops at SHIPPED.
- **No profile-update endpoint** — personal details are read-only in every portal.
- **"3M+ Active Reads"** on the shop hero is a fabricated figure with no source.
- `GET /kyc/me` returns `{"status":"PENDING","submitted":false}`, which reads as contradictory.

---

## 8. Not audited

- **Designs vs build.** `designs/*.zip` were not opened, so no screen-by-screen
  comparison was made against the Figma exports. A portal may be missing screens
  that were designed but never built.
- **Automated tests.** Coverage was not assessed; the QA in this work was manual
  and endpoint-level.
- **Performance, load and security testing.** None done.
- **Accessibility.** Not reviewed.

---

## 9. Suggested order of work

1. ~~Wire the admin write actions~~ — done.
2. ~~Customer accounts on the storefront~~ — done.
3. **Resolve the Paystack key** (§6). Now the highest-value item: it unblocks
   KYC, which unblocks payout approval, which is the only thing preventing
   anyone from being paid. It is a credentials change, not code.
4. ~~Customer-facing support UI~~ — done.
5. ~~Product reviews on the storefront~~ — done.
6. ~~Build an upload endpoint and wire it into the forms~~ — done. Remaining:
   add Cloudinary or R2 keys, at which point every upload path works with no
   code change. Product images additionally now persist (imageUrls on the
   vendor product API), and the public catalogue already renders them.
7. Decide the open product questions in §7.
