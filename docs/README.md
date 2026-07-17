# Daniliya API — Design Documentation

Pre-implementation design for `daniliya-api` (NestJS). These docs define the
data model, endpoints, and flows **before** any backend code is written, derived
from the five frontend surfaces and the decided stack.

## Contents

| # | Doc | What's in it |
|---|---|---|
| 01 | [Architecture](./01-architecture.md) | Stack, system context, module map, actors, cross-cutting conventions |
| 02 | [Data model & ERD](./02-data-model.md) | Every entity, field, relationship; Mermaid ERD |
| 03 | [Endpoint catalog](./03-endpoints.md) | All REST endpoints per module — auth, roles, request/response shape |
| 04 | [Business rules](./04-business-rules.md) | Commission/payout math, statuses & state machines, invariants |
| 05 | [Sequence diagrams](./05-sequence-diagrams.md) | Key flows: checkout, attribution, payout run, KYC, onboarding, campaigns |
| 06 | [Flowcharts](./06-flowcharts.md) | Lifecycle flowcharts: order, booking, payout batch, campaign, moderation |
| 07 | [UI → endpoint mapping](./07-ui-endpoint-map.md) | Every screen/action across the 5 portals → the endpoints it calls |
| 08 | [Delivery plan](./08-delivery-plan.md) | Module breakdown + phased build plan; Phase 0 account setup (from Gmail), QA gates, timeline |
| — | [Phase 0 checklist](./phase-0-account-setup-checklist.md) | Printable account-setup checklist: signup links, DNS records, env tracker, KYB docs |

## How to read this

- Start with **01 Architecture** for the shape of the system.
- **02 Data model** is the source of truth for entities; **03 Endpoints** and
  **07 UI map** both reference those entity names.
- **04 Business rules** is where the money/status logic is pinned down — read it
  before implementing anything financial.
- Diagrams are Mermaid and render on GitHub.

## Conventions used throughout

- Money is **integer kobo**; ₦ shown only for readability.
- IDs are UUIDs unless a human-facing reference is noted (e.g. order `ref`).
- `🔒` = authenticated, `👤` = role-scoped, `🛡️` = admin/RBAC, `🌐` = public.
- Status enums are quoted verbatim from the frontend types where they exist.
