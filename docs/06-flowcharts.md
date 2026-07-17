# Lifecycle Flowcharts & State Machines

Canonical state machines for every stateful entity. Transitions map 1:1 to the
endpoints in [03-endpoints](./03-endpoints.md) and the rules in
[04-business-rules](./04-business-rules.md).

## Order

```mermaid
stateDiagram-v2
    [*] --> new: order placed (paid / POD)
    new --> confirmed: Confirm Order
    confirmed --> packed: Mark Packed
    packed --> shipped: Mark Shipped
    shipped --> delivered: Mark Delivered
    delivered --> [*]
    new --> cancelled: Cancel
    confirmed --> cancelled: Cancel
    confirmed --> refunded: Issue Refund
    delivered --> refunded: Issue Refund (window)
    cancelled --> [*]
    refunded --> [*]
    note right of refunded: reverses attributed commission
```

## Booking (services)

```mermaid
stateDiagram-v2
    [*] --> requested: quote submitted
    requested --> confirmed: Accept
    requested --> cancelled: Reject
    confirmed --> in_progress
    in_progress --> completed: Mark completed
    confirmed --> cancelled: Cancel Booking
    in_progress --> cancelled: Cancel Booking
    completed --> [*]
    cancelled --> [*]
```

## Product moderation

```mermaid
stateDiagram-v2
    [*] --> draft: Save as draft
    draft --> pending: Submit for review
    pending --> published: Admin Approve
    pending --> rejected: Admin Reject
    rejected --> pending: resubmit
    published --> out_of_stock: stock <= 0
    out_of_stock --> published: restock
    note right of pending: reviewed within 4 business hours
```

## Campaign

```mermaid
stateDiagram-v2
    [*] --> draft: Save as draft
    [*] --> live: Create & publish
    draft --> live: Publish
    draft --> scheduled: future window
    scheduled --> live: window starts
    live --> paused: Pause
    paused --> live: Resume
    live --> ended: End early (confirm)
    paused --> ended: End early
    scheduled --> ended: End early
    ended --> [*]
    note right of ended: terminal — all mutation locked
```

## Post submission

```mermaid
stateDiagram-v2
    [*] --> submitted: influencer submits post URL
    submitted --> approved: admin approves (has #ad)
    submitted --> rejected: admin rejects
    approved --> [*]
    rejected --> [*]
    note right of approved: unlocks CPA payout eligibility
```

## Payout batch

```mermaid
stateDiagram-v2
    [*] --> scheduled: Monday run (aka Queued)
    scheduled --> review: enters compliance review
    review --> scheduled: Approve & schedule (checks pass)
    review --> cancelled: Reject batch
    scheduled --> held: Hold Batch
    held --> scheduled: Release
    scheduled --> paid: all transfers settle
    scheduled --> failed: transfer failures
    failed --> scheduled: Retry failed transfers
    failed --> cancelled: Cancel Payout
    paid --> [*]
    cancelled --> [*]
    note right of review: gate = KYC + bank validated + Paystack float
```

## Commission

```mermaid
stateDiagram-v2
    [*] --> pending: paid order attributed
    pending --> confirmed: return window passed / delivered
    confirmed --> disbursed: payout item paid
    pending --> reversed: refund/cancel
    confirmed --> reversed: refund claw-back
    disbursed --> [*]
    reversed --> [*]
```

## Onboarding application + KYC

```mermaid
flowchart TD
    A[Register] --> B[Verify OTP]
    B --> C{Choose role}
    C -->|customer| C1[Shop — done]
    C -->|affiliate| D[KYC: gov ID + bank]
    C -->|influencer| E[KYC + creator details]
    C -->|vendor| F[Business + KYC + payouts]
    D --> G[Tutorial 5 lessons]
    G --> H[Assessment 10Q · 8min]
    H -->|score >= 60%| I[Activated: code + pay-link]
    H -->|fail| H2{retakes left?}
    H2 -->|yes, up to 10| H
    H2 -->|no| HX[Locked out]
    E --> R[Admin review ~24h]
    F --> R
    R -->|approved| I
    R -->|rejected| RX[Reviewer note → resubmit KYC]
    RX --> D
```

## KYC record

```mermaid
stateDiagram-v2
    [*] --> unverified
    unverified --> pending: submit (Smile ID)
    pending --> verified: identity + bank match ok
    pending --> rejected: mismatch / bad docs
    rejected --> pending: resubmit
    verified --> [*]
    note right of verified: required before any payout
```

## Attribution channel resolution (per order)

```mermaid
flowchart TD
    O[Order placed] --> P{promo code used?}
    P -->|yes| INF[channel = influencer<br/>→ CPA commission]
    P -->|no| U{UTM utm_source=creator?}
    U -->|yes| INF
    U -->|no| R{recent ?ref= click<br/>within 30d?}
    R -->|yes| AFF[channel = affiliate<br/>→ ₦10,000 flat]
    R -->|no| W[channel = web/direct<br/>no commission]
```
