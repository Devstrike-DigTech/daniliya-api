# Data Model & ERD

Source of truth for entities. Derived from the five frontends (`daniliya-web`,
`-affiliate`, `-influencer`, `-vendor`, `-admin`) and reconciled into one model.

> ⚠️ **This document is the target model. An earlier `prisma/schema.prisma`
> (555 lines) already exists in the repo and diverges from it** — see
> [Divergences from the current schema](#divergences) at the bottom. Reconcile
> per phase; do not assume the live schema matches this doc.

## Modeling decisions (reconciliations)

The frontends were built independently, so a few things are unified here:

1. **One `User`, many role profiles.** A person is a single `User` who may hold
   `Customer`, `Affiliate`, `Influencer`, `Vendor`, and/or `AdminUser` profiles.
   Codes like `DEX-GXY7` (affiliate/influencer) and `VND-71BT` (vendor) are
   per-profile referral/handle codes.
2. **Money is `Decimal(12,2)` naira** (Postgres `NUMERIC` — exact, *not* a float),
   matching the live schema. Prisma returns `Decimal` objects and the API
   serialises them as strings (`"50000.00"`); frontends format at the edge.
   **Never cast a money value to a JS `number` for arithmetic** — use
   `Prisma.Decimal`. (Decided 2026-07-16, superseding an earlier integer-kobo
   proposal: `NUMERIC` is already exact and avoids BigInt JSON pitfalls.)
3. **One `PayoutStatus`:** `scheduled | review | paid | failed` (+ `held`,
   `cancelled`). The admin command-centre `Queued` maps to `scheduled`.
4. **KYC uses Smile ID + bank name-enquiry, not NIN/BVN forms.** The live
   affiliate/vendor KYC forms collect a government ID upload + bank account
   (name auto-resolved). NIN/BVN appear only in stale display copy — the model
   keeps optional `nin`/`bvn` fields (encrypted) for Smile ID results but does
   not require them at submission.
5. **Commission lifecycle:** `pending → confirmed → disbursed`, with `reversed`
   on refund. This is the `Commission` entity's status.
6. **Attribution** is unified: a referral `?ref={code}` (affiliate) or a campaign
   UTM `utm_source=creator&utm_campaign={slug}&ref={code}` (influencer) creates a
   `Click`; a resulting order creates a `Conversion` → a `Commission`.
7. **Products** span two scopes: `platform` (digital, e.g. Daniliya Books) and
   `vendor` (marketplace). Moderation status is unified (see below).

## Enum reference (canonical)

| Enum | Values |
|---|---|
| `UserStatus` | `active` · `pending` · `suspended` |
| `Role` | `customer` · `affiliate` · `influencer` · `vendor` · `admin` |
| `AdminRole` (RBAC) | `superadmin` · `finance` · `support` · `user_manager` |
| `KycStatus` | `unverified` · `pending` · `verified` · `rejected` |
| `ApplicationStatus` | `pending` · `approved` · `rejected` (affiliate/influencer/vendor onboarding decision) |
| `AccountStanding` | `active` · `suspended` (separate axis from application decision) |
| `AffiliateTier` | `bronze` · `silver` · `gold` · `platinum` (loyalty rank by lifetime earnings — **not** a commission rate) |
| `ProductScope` | `platform` · `vendor` |
| `ProductStatus` | `draft` · `pending` · `published` · `rejected` · `out_of_stock` |
| `OrderStatus` | `new` · `confirmed` · `packed` · `shipped` · `delivered` · `cancelled` |
| `PaymentStatus` | `pending` · `paid` · `failed` · `refunded` |
| `PaymentMethod` | `paystack` · `flutterwave` · `pay_on_delivery` |
| `FulfilmentMode` | `delivery` · `pickup` |
| `BookingStatus` | `requested` · `confirmed` · `in_progress` · `completed` · `cancelled` |
| `CampaignScope` | `platform` · `vendor` |
| `CampaignType` | `cpa` · `hybrid` |
| `CampaignStatus` | `draft` · `scheduled` · `live` · `paused` · `ended` |
| `SubmissionStatus` | `submitted` · `approved` · `rejected` |
| `CommissionType` | `affiliate_flat` · `influencer_cpa` · `vendor_sale` |
| `CommissionStatus` | `pending` · `confirmed` · `disbursed` · `reversed` |
| `PayoutStatus` | `scheduled` · `review` · `held` · `paid` · `failed` · `cancelled` |
| `PayoutAudience` | `affiliate` · `influencer` · `vendor` |
| `ReviewStatus` | `published` · `flagged` · `removed` |
| `TicketPriority` | `low` · `normal` · `high` · `urgent` |
| `LedgerEntryType` | `debit` · `credit` |

## ERD — Identity, roles & KYC

```mermaid
erDiagram
    USER ||--o| CUSTOMER_PROFILE : has
    USER ||--o| AFFILIATE_PROFILE : has
    USER ||--o| INFLUENCER_PROFILE : has
    USER ||--o| VENDOR_PROFILE : has
    USER ||--o| ADMIN_USER : has
    USER ||--o{ KYC_RECORD : submits
    USER ||--o{ BANK_ACCOUNT : owns
    USER ||--o{ SESSION : opens
    USER ||--o{ OTP : receives
    USER ||--o| WALLET : has

    USER {
        uuid id PK
        string email UK
        string phone
        string password_hash
        string full_name
        date dob
        enum status "UserStatus"
        bool two_factor_enabled
        timestamp created_at
    }
    ADMIN_USER {
        uuid id PK
        uuid user_id FK
        enum role "AdminRole"
        timestamp last_active
    }
    AFFILIATE_PROFILE {
        uuid id PK
        uuid user_id FK
        string code UK "e.g. DEX-GXY7"
        enum tier "AffiliateTier"
        enum application_status "ApplicationStatus"
        enum standing "AccountStanding"
        int assessment_score
        bigint lifetime_earnings_kobo
    }
    INFLUENCER_PROFILE {
        uuid id PK
        uuid user_id FK
        string code UK
        string handle
        string niche
        string following
        enum application_status
        enum standing
        json socials "ig/x/yt/tiktok"
    }
    VENDOR_PROFILE {
        uuid id PK
        uuid user_id FK
        string code UK "e.g. VND-71BT"
        string business_name
        string legal_name
        string rc_number
        string category
        string city
        string address
        int take_rate_bps "default 1000 = 10%"
        enum application_status
        enum standing
        numeric store_rating
    }
    KYC_RECORD {
        uuid id PK
        uuid user_id FK
        enum status "KycStatus"
        string gov_id_type
        string gov_id_url
        string nin_enc "nullable, encrypted"
        string bvn_enc "nullable, encrypted"
        string smile_id_ref
        string reviewer_note
        timestamp reviewed_at
    }
    BANK_ACCOUNT {
        uuid id PK
        uuid user_id FK
        string bank_name
        string bank_code
        string account_number
        string account_name "resolved via name-enquiry"
        bool is_default
        bool verified
    }
```

## ERD — Catalog, orders & bookings

```mermaid
erDiagram
    VENDOR_PROFILE ||--o{ PRODUCT : lists
    PRODUCT ||--o{ PRODUCT_IMAGE : has
    PRODUCT ||--o{ ORDER_ITEM : "sold as"
    ORDER ||--|{ ORDER_ITEM : contains
    CUSTOMER_PROFILE ||--o{ ORDER : places
    ORDER ||--o| PAYMENT : "paid by"
    ORDER ||--o| SHIPMENT : fulfilled_by
    ORDER ||--o{ REVIEW : "reviewed in"
    SERVICE_VERTICAL ||--o{ BOOKING : requested_in
    CUSTOMER_PROFILE ||--o{ BOOKING : requests
    BOOKING ||--o{ BOOKING_ATTACHMENT : has

    PRODUCT {
        uuid id PK
        string name
        string sku
        enum scope "ProductScope"
        uuid vendor_id FK "null when platform"
        string category
        bigint price_kobo
        bigint cost_kobo
        int stock
        int min_stock
        int sold
        enum status "ProductStatus"
        string description
    }
    ORDER {
        uuid id PK
        string ref UK "DNL-1Z5X5B"
        uuid customer_id FK
        uuid vendor_id FK "nullable"
        enum status "OrderStatus"
        enum channel "web|direct|affiliate|influencer"
        uuid attribution_id FK "nullable -> CLICK/REFERRAL"
        enum fulfilment_mode "FulfilmentMode"
        bigint subtotal_kobo
        bigint delivery_fee_kobo
        bigint tax_kobo
        bigint gift_addon_kobo
        bigint total_kobo
        json ship_to
        timestamp created_at
    }
    ORDER_ITEM {
        uuid id PK
        uuid order_id FK
        uuid product_id FK
        int qty
        bigint unit_price_kobo
        bool gift_wrap
        json gift_meta "recipient/name/message"
    }
    PAYMENT {
        uuid id PK
        uuid order_id FK
        enum method "PaymentMethod"
        enum status "PaymentStatus"
        string provider_ref "paystack/flutterwave ref"
        bigint amount_kobo
        timestamp paid_at
    }
    SHIPMENT {
        uuid id PK
        uuid order_id FK
        string courier
        string tracking_number
        timestamp estimated_delivery
    }
    SERVICE_VERTICAL {
        uuid id PK
        string slug UK "laundry|dry-cleaning|interior-decoration|construction"
        string name
        bool coming_soon
    }
    BOOKING {
        uuid id PK
        string ref UK
        uuid customer_id FK
        uuid vertical_id FK
        enum status "BookingStatus"
        string description
        bigint quoted_amount_kobo
        string city
        string address
        date preferred_date
        bigint budget_kobo
    }
```

## ERD — Attribution, campaigns & submissions

```mermaid
erDiagram
    AFFILIATE_PROFILE ||--o{ REFERRAL_LINK : owns
    REFERRAL_LINK ||--o{ CLICK : generates
    CLICK ||--o| CONVERSION : "may become"
    ORDER ||--o| CONVERSION : triggers
    CONVERSION ||--|| COMMISSION : earns
    ADMIN_USER ||--o{ CAMPAIGN : creates
    CAMPAIGN ||--o{ CAMPAIGN_ASSIGNMENT : "assigns to"
    INFLUENCER_PROFILE ||--o{ CAMPAIGN_ASSIGNMENT : receives
    CAMPAIGN_ASSIGNMENT ||--o{ POST_SUBMISSION : produces
    CAMPAIGN ||--o{ CAMPAIGN_ASSET : has
    CAMPAIGN ||--o{ CONVERSION : attributes

    REFERRAL_LINK {
        uuid id PK
        uuid affiliate_id FK
        string slug "product slug or master"
        string url
        string qr_url
    }
    CLICK {
        uuid id PK
        uuid referral_link_id FK "nullable"
        uuid campaign_assignment_id FK "nullable"
        string ref_code
        string utm_source
        string utm_campaign
        string ip
        timestamp created_at
    }
    CONVERSION {
        uuid id PK
        uuid order_id FK
        uuid click_id FK "nullable"
        enum channel "affiliate|influencer"
        uuid affiliate_id FK "nullable"
        uuid campaign_assignment_id FK "nullable"
        bigint order_value_kobo
        timestamp converted_at
    }
    COMMISSION {
        uuid id PK
        uuid conversion_id FK "nullable"
        uuid order_id FK
        uuid beneficiary_user_id FK
        enum type "CommissionType"
        enum status "CommissionStatus"
        bigint amount_kobo
        uuid payout_id FK "nullable"
        timestamp confirmed_at
    }
    CAMPAIGN {
        uuid id PK
        string ref UK "CMP-A21"
        enum scope "CampaignScope"
        string name
        string product
        enum type "CampaignType"
        enum status "CampaignStatus"
        bigint budget_kobo
        bigint spent_kobo
        bigint cpa_kobo "per-conversion payout"
        date window_start
        date window_end
        string brief_headline
        string brief_body
        json deliverables
        json checklist
        json dos
        json donts
        string promo_code
        string utm_base
    }
    CAMPAIGN_ASSIGNMENT {
        uuid id PK
        uuid campaign_id FK
        uuid influencer_id FK
        string per_creator_utm
        string per_creator_promo
        json checklist_state
        int clicks
        int conversions
        bigint earned_kobo
    }
    POST_SUBMISSION {
        uuid id PK
        uuid assignment_id FK
        string post_url
        bool has_ad_disclosure
        enum status "SubmissionStatus"
        string reviewer_note
        timestamp submitted_at
    }
    CAMPAIGN_ASSET {
        uuid id PK
        uuid campaign_id FK
        string title
        string url
        string meta "e.g. 12 images · ZIP · 24MB"
    }
```

## ERD — Money: wallet, ledger & payouts

```mermaid
erDiagram
    USER ||--o| WALLET : has
    WALLET ||--o{ LEDGER_ENTRY : records
    PAYOUT_BATCH ||--o{ PAYOUT_ITEM : contains
    PAYOUT_ITEM ||--o| BANK_ACCOUNT : "pays to"
    PAYOUT_ITEM ||--o{ COMMISSION : settles
    PAYOUT_BATCH ||--o{ COMPLIANCE_CHECK : gated_by
    PAYOUT_ITEM ||--o| TRANSFER : "executed by"

    WALLET {
        uuid id PK
        uuid user_id FK
        bigint balance_kobo "cached from ledger"
        bigint pending_kobo
    }
    LEDGER_ENTRY {
        uuid id PK
        uuid wallet_id FK
        enum type "LedgerEntryType"
        bigint amount_kobo
        string source "order|commission|payout|refund|adjustment"
        uuid source_id
        bigint balance_after_kobo
        timestamp created_at
    }
    PAYOUT_BATCH {
        uuid id PK
        string ref UK "PB-2026-27A"
        enum audience "PayoutAudience"
        enum status "PayoutStatus"
        int recipients
        bigint total_kobo
        date run_date "weekly Monday"
        uuid approved_by FK "AdminUser, nullable"
    }
    PAYOUT_ITEM {
        uuid id PK
        uuid batch_id FK
        uuid beneficiary_user_id FK
        uuid bank_account_id FK
        bigint amount_kobo
        enum status "PayoutStatus"
        string failure_reason
    }
    TRANSFER {
        uuid id PK
        uuid payout_item_id FK
        string provider "paystack|flutterwave"
        string provider_ref
        enum status "pending|success|failed|reversed"
        string idempotency_key UK
    }
    COMPLIANCE_CHECK {
        uuid id PK
        uuid batch_id FK
        string label "KYC verified|Bank validated|Paystack float"
        bool passed
    }
```

## ERD — Reviews, support, onboarding & system

```mermaid
erDiagram
    USER ||--o{ REVIEW : writes
    PRODUCT ||--o{ REVIEW : receives
    VENDOR_PROFILE ||--o{ REVIEW : receives
    REVIEW ||--o| REVIEW_RESPONSE : "answered by"
    USER ||--o{ SUPPORT_TICKET : opens
    SUPPORT_TICKET ||--o{ TICKET_MESSAGE : contains
    USER ||--o{ ONBOARDING_APPLICATION : submits
    ONBOARDING_APPLICATION ||--o{ ASSESSMENT_ATTEMPT : has
    ADMIN_USER ||--o{ AUDIT_LOG : writes
    USER ||--o{ NOTIFICATION : receives

    REVIEW {
        uuid id PK
        uuid author_id FK
        uuid product_id FK "nullable"
        uuid vendor_id FK "nullable"
        int rating "1-5"
        string body
        enum status "ReviewStatus"
        timestamp created_at
    }
    REVIEW_RESPONSE {
        uuid id PK
        uuid review_id FK
        uuid vendor_id FK
        string body
    }
    SUPPORT_TICKET {
        uuid id PK
        string ref UK "TCK-1234"
        uuid opened_by FK
        string subject
        enum priority "TicketPriority"
        uuid assigned_to FK "AdminUser"
        enum status "open|pending|closed"
    }
    TICKET_MESSAGE {
        uuid id PK
        uuid ticket_id FK
        uuid author_id FK
        bool from_admin
        string body
        timestamp created_at
    }
    ONBOARDING_APPLICATION {
        uuid id PK
        uuid user_id FK
        enum role "affiliate|influencer|vendor"
        enum status "ApplicationStatus"
        json details "role-specific"
        int retakes_left
    }
    ASSESSMENT_ATTEMPT {
        uuid id PK
        uuid application_id FK
        int score
        bool passed
        json answers
        timestamp submitted_at
    }
    AUDIT_LOG {
        uuid id PK
        uuid actor_id FK "nullable (System)"
        string action
        string target
        json before
        json after
        string ip
        timestamp created_at
    }
    NOTIFICATION {
        uuid id PK
        uuid user_id FK
        string type
        string title
        string body
        bool read
        timestamp created_at
    }
```

## Notes & open questions

- **Assessment content** (`AssessmentQuestion`) and **tutorial lessons** are
  affiliate-onboarding config — store as `AssessmentQuestion` / `TutorialLesson`
  reference tables (seeded), separate from user attempts.
- **`AffiliateTier`** thresholds (Bronze ₦0 / Silver ₦50k / Gold ₦250k /
  Platinum ₦1M) are lifetime-earnings ranks; recompute on commission
  confirmation. They gate perks only, never commission amount.
- **Review → product** currently joins by name in the vendor UI; here it's a
  real FK (`product_id`) with optional `vendor_id`.
- **Pricing config** (delivery ₦8,500, tax ₦2,500, gift +₦1,500, affiliate flat
  ₦10,000, min payout ₦5,000, vendor take-rate 10%) belongs in a `PlatformConfig`
  table so finance can tune without a deploy — see [Business rules](./04-business-rules.md).
- **Reconciliation**: `Transfer.provider_ref` + `Payment.provider_ref` are the
  join keys against Paystack/Flutterwave settlement reports.

## Divergences from the current schema <a name="divergences"></a>

`prisma/schema.prisma` (pre-existing, migrated as `init`) differs from this
target model. Each gap is a decision to make in the phase that needs it — the
Phase 1 auth work runs fine on the current schema as-is.

| Area | Current schema | This doc | Phase to resolve |
|---|---|---|--:|
| **Money** | `Decimal(12,2)` on Product/Order/Commission | integer **kobo** | P3/P6 |
| **Roles** | single `User.role` enum + optional profiles | multi-role profiles | P2 |
| **Affiliate commission** | `CommissionRule` with **rate** %s | **flat ₦10,000** (rates don't model it) | P5 |
| **Payout batch** | `PayoutBatchStatus { PENDING, DISBURSED }` | `scheduled→review→held→paid/failed` + compliance checks | P6 |
| **Wallet / ledger** | absent | double-entry `LEDGER_ENTRY` + `WALLET` | P6 |
| **Payments** | `Order.paymentRef` string only | `PAYMENT` + `TRANSFER` entities | P3/P6 |
| **KYC** | `KycSubmission` 1:1 **affiliate only**; `nin/bvnEncrypted` | per-user KYC; NIN/BVN optional (forms dropped them) | P2 |
| **Bank accounts** | `bankDetailsJson` string on profiles | `BANK_ACCOUNT` entity + name-enquiry | P2 |
| **Attribution** | `ClickEvent` (influencerCode only), no conversion | `CLICK` + `CONVERSION` for both channels | P5 |
| **Campaign status** | `ACTIVE/PAUSED/ENDED` | + `draft`, `scheduled` (admin UI has both) | P5 |
| **Product status** | `DRAFT/PENDING_REVIEW/ACTIVE/REJECTED/REMOVED` | + `out_of_stock` | P3 |
| **Order status** | `PENDING…PROCESSING…COMPLETED/REFUNDED` | vendor UI uses `packed`; no `completed` | P3 |
| **Bookings / Reviews / Support / Notifications / PlatformConfig** | absent (`QuoteRequest` only) | full entities | P4/P7 |
| **Shipments** | absent | `SHIPMENT` (courier, tracking) | P3 |
