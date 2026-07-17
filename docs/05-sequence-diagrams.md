# Sequence Diagrams

End-to-end flows across clients, API, DB, and third parties. Mermaid renders on
GitHub.

## 1. Checkout & payment (Pay Now)

```mermaid
sequenceDiagram
    actor C as Customer
    participant WEB as daniliya-web
    participant API
    participant DB as Postgres
    participant PAY as Paystack/Flutterwave

    C->>WEB: Checkout (mode, contact, Pay Now)
    WEB->>API: POST /checkout/quote
    API->>API: compute subtotal+delivery+tax+gift (kobo)
    API-->>WEB: totals
    C->>WEB: Place order
    WEB->>API: POST /orders (Idempotency-Key)
    API->>DB: create ORDER(status=new), ORDER_ITEMs, PAYMENT(pending)
    API->>PAY: initialize transaction (amount, ref)
    PAY-->>API: authorization_url + provider_ref
    API-->>WEB: order.ref + payment URL
    C->>PAY: pays on hosted page
    PAY-->>API: POST /webhooks/paystack (signed, retried)
    API->>API: verify signature + dedupe provider_ref
    API->>DB: PAYMENT=paid, ORDER=confirmed
    API->>API: if attributed → CONVERSION + COMMISSION(pending)
    API->>DB: LEDGER credit (vendor net accrues)
    API-->>C: email receipt (Resend)
    Note over C,API: Pay-on-Delivery skips PAY; order=confirmed on placement
```

## 2. Affiliate attribution → commission

```mermaid
sequenceDiagram
    actor V as Visitor
    participant WEB as daniliya-web
    participant API
    participant DB

    V->>WEB: opens ?ref=DEX-GXY7 link
    WEB->>API: POST /track/click {ref, utm, url}
    API->>DB: CLICK(ref_code, ip, ts)
    Note over V,WEB: attribution window = 30d, last-click wins
    V->>WEB: later places & pays for order
    WEB->>API: POST /orders
    API->>DB: match latest CLICK by visitor/ref
    API->>DB: CONVERSION(order, click, channel=affiliate)
    API->>DB: COMMISSION(beneficiary=affiliate, ₦10,000, pending)
    Note over API,DB: on delivery/return-window pass → COMMISSION=confirmed
    Note over API,DB: on refund → COMMISSION=reversed (claw-back)
```

## 3. Influencer campaign — assign → post → convert

```mermaid
sequenceDiagram
    participant ADM as Admin
    participant API
    participant DB
    participant INF as Influencer
    participant WEB as Shopper on web

    ADM->>API: POST /admin/campaigns (brief, cpa, deliverables)
    ADM->>API: POST /admin/campaigns/:id/assign (influencerIds)
    API->>DB: CAMPAIGN_ASSIGNMENT + per-creator UTM & promo
    INF->>API: GET /influencer/campaigns/:id (brief, assets)
    INF->>API: POST /campaigns/:id/accept
    INF->>API: PATCH checklist (toggle items)
    INF->>API: POST /submissions {post_url, #ad}
    API->>DB: POST_SUBMISSION(status=submitted)
    ADM->>API: approve/reject submission (24h SLA)
    WEB->>API: order via creator UTM/promo
    API->>DB: CONVERSION(assignment) + COMMISSION(cpa, pending)
    Note over API,DB: eligible only if submission approved + #ad present
```

## 4. Weekly Monday payout run

```mermaid
sequenceDiagram
    participant CRON as Scheduler (Mon)
    participant API
    participant DB
    participant FIN as Finance admin
    participant RAIL as Paystack Transfers

    CRON->>API: trigger payout run
    API->>DB: select confirmed commissions / vendor net,<br/>filter KYC=verified, approved, active, ≥ ₦5,000
    API->>DB: create PAYOUT_BATCH per audience + PAYOUT_ITEMs
    API->>DB: run COMPLIANCE_CHECKs (KYC, bank, float)
    API-->>FIN: batches in status=review
    FIN->>API: POST /admin/payouts/:ref/approve
    API->>API: gate on all checks passed
    API->>DB: batch=scheduled
    loop each item
        API->>RAIL: transfer (idempotency_key)
    end
    RAIL-->>API: POST /webhooks/transfer (per item)
    API->>DB: item=paid → COMMISSION=disbursed, LEDGER debit
    Note over API,DB: failed items → retry or cancel; batch=paid when all settle
```

## 5. KYC verification (Smile ID)

```mermaid
sequenceDiagram
    actor U as Applicant
    participant P as Portal (aff/inf/vendor)
    participant API
    participant SMILE as Smile ID
    participant BANK as Bank name-enquiry

    U->>P: upload gov ID + bank account
    P->>API: POST /kyc {gov_id_url, bank_account_id}
    API->>BANK: resolve {bank_code, account_number}
    BANK-->>API: account_name (must match applicant)
    API->>SMILE: submit identity verification
    API->>DB: KYC_RECORD(status=pending)
    SMILE-->>API: POST /webhooks/smile-id (result)
    API->>DB: KYC=verified | rejected(+note)
    Note over API: verified → unblock payouts / activation<br/>rejected → resubmit
```

## 6. Onboarding (affiliate path with assessment)

```mermaid
sequenceDiagram
    actor U as User
    participant P as Portal
    participant API
    participant MAIL as Resend/Termii

    U->>API: POST /auth/register
    API->>MAIL: send 6-digit OTP
    U->>API: POST /auth/verify-otp
    U->>API: POST /onboarding/role (affiliate)
    U->>API: POST /kyc (gov ID + bank)
    U->>API: GET /onboarding/tutorial (5 lessons)
    U->>API: GET /onboarding/assessment (10 Q, 8-min)
    U->>API: POST /assessment/submit (answers)
    API->>API: score ≥ 60% ?
    alt pass
        API->>DB: activate affiliate, issue code + pay-link
    else fail
        API->>DB: retakes_left-- (up to 10) → retry
    end
    Note over U,API: influencer/vendor → manual admin review instead of assessment
```

## 7. Vendor order fulfilment

```mermaid
sequenceDiagram
    actor VEN as Vendor
    participant VP as vendor portal
    participant API
    participant DB
    actor CUS as Customer

    Note over API,DB: order arrives status=new (payment=paid)
    VEN->>VP: open order
    VP->>API: POST /vendor/orders/:ref/advance (Confirm)
    API->>DB: status new→confirmed (audit)
    VEN->>API: advance → packed → shipped (tracking) → delivered
    API->>DB: each transition audited; SHIPMENT updated
    API-->>CUS: status notifications (Resend)
    Note over API,DB: on delivered → vendor net becomes confirmed for payout
```
