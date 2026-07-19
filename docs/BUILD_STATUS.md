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
| Storefront | Buying and booking are live end to end. No customer account area |
| Affiliate portal | Complete — join flow and dashboard on real data |
| Influencer portal | Complete — application flow and dashboard on real data |
| Vendor portal | Complete — including fulfilment, which creates the buyer's tracking |
| Admin portal | **Reads are complete. Almost all writes are not wired** |

The single biggest gap is the admin portal: it can see everything and do very
little. That is not an API problem — the endpoints exist and work.

---

## 2. Blocking: admin cannot act

**40 buttons across the admin portal have no handler at all.** They are plain
`<button>` elements that look operable and do nothing. Only two Server Action
files exist in the whole portal (`campaigns/actions.ts`, `settings/actions.ts`),
so campaign pause/resume/end and team/config are the only working writes.

| Page | Inert controls | Endpoints that exist and are unused |
|---|---|---|
| Vendors detail | Message, Suspend user, Reinstate, Export CSV | `POST /admin/vendors/:id/approve` · `/reject` · `/admin/users/:id/suspend` · `/reinstate` · `/message` |
| Influencers detail | Message, Suspend, Reinstate, Offer retainer, Export CSV | `POST /admin/influencers/:id/approve` · `/reject` |
| Affiliates detail | Change tier, Message, Suspend, Reinstate | `POST /admin/affiliates/:id/tier` |
| Products list + detail | Approve, Reject, Unlist temporarily, Remove | `POST /admin/products/:id/approve` · `/reject` |
| Orders detail | Confirm Order, Issue refund, Cancel Order | `POST /admin/orders/:ref/refund` · `/cancel` |
| Payouts detail | Approve & schedule, Hold, Reject, Retry, Download receipt | `POST /admin/payouts/run` · `:ref/approve` · `/hold` · `/retry` · `/cancel` |
| Bookings detail | Accept, Reject, Mark completed, Cancel | `POST /admin/bookings/:ref/accept` · `/start` · `/complete` · `/reject` · `/cancel` |
| Reviews | Keep, Remove | `POST /admin/reviews/:id/keep` · `/remove` · `/flag` |
| Support | Mark as resolved | `POST /admin/support/tickets/:ref/reply` · `/assign` · `/close` |
| Campaign detail | (submissions are view-only) | `POST /admin/campaigns/submissions/:sid/approve` · `/reject` |
| Several lists | Filter, Export CSV / ledger | — no endpoint; see §5 |

### 2.1 The chain that blocks creator payouts

`CommissionsService.confirmEligible()` promotes a creator's commission from
PENDING to CONFIRMED **only if the campaign post was approved**:

> *"influencer commissions additionally require an APPROVED post submission with #ad"*

Nothing in the admin portal can approve a submission — the campaign detail page
links to the post URL and stops. So a creator's earnings stay PENDING for ever,
and the money never reaches their wallet or a payout batch.

Combined with `POST /admin/payouts/run` being unwired, **there is currently no
UI path by which anyone gets paid.** Both work fine over the API.

---

## 3. Whole features with no interface anywhere

| Feature | API | UI |
|---|---|---|
| **Support ticketing** | `POST/GET /support/tickets`, replies, plus the admin side | **None in any portal.** Customers cannot raise a ticket; the admin Support page lists but cannot reply, assign or close |
| **Product reviews** | `GET /products/:id/reviews`, `POST /reviews`, vendor respond, admin moderate | **Storefront shows no reviews and cannot submit one.** The vendor portal can respond; nothing produces a review to respond to |
| **Customer accounts** | `/auth/*`, `GET /orders`, `GET /bookings` | **No sign-in, order history or booking history on the storefront.** Guests can buy and claim their history later by registering — but there is no page to register or sign in on |

Reviews is the notable one: the vendor portal has a reviews screen, admin has
moderation endpoints, and the data model supports it — but no customer can ever
write one, so the entire chain is inert.

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
- **Message a user** from admin (endpoint exists, `POST /admin/users/:id/message`, but no compose UI).
- **Offer retainer** on the influencer detail page — no concept in the data model.

---

## 6. Blocked by configuration, not code

| Item | Detail |
|---|---|
| **KYC** | `POST /me/bank-accounts` → 503. A Paystack key is set and lists banks, but Paystack rejects it for name enquiry (401/403). KYC needs a bank account, so the whole step is impassable. Needs a key with resolve permissions |
| **Card payment** | No live payment key, so Paystack returns `simulated: true` and a fake checkout URL. Only Pay on Delivery completes |
| **Email/SMS** | The dev mailer logs OTPs to the console. No real email or SMS is sent to anyone, ever |
| **File uploads** | No upload endpoint exists anywhere. KYC documents, product images and quote attachments all have nowhere to go |
| **Product imagery** | Every product returns `image: null` / `images: []` |

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

1. **Wire the admin write actions** (§2). Biggest gap, no new API needed, and it
   unblocks payouts and moderation. Start with campaign submission approval and
   the payout run, since those unblock money.
2. **Customer accounts on the storefront** (§3) — sign-in, order and booking
   history. The API and the guest-claim path already exist.
3. **Support ticketing UI** (§3), customer and admin sides.
4. **Product reviews on the storefront** (§3), which activates the vendor and
   admin review features already built.
5. **Resolve the Paystack key** (§6) to unblock KYC and card payment.
6. **Build an upload endpoint** (§6), then restore document, image and
   attachment fields.
7. Decide the open product questions in §7.
