# FrameWorkshop ERP — architecture

FrameWorkshop is a modular monolith for a Russian framing workshop: CRM, framing
calculator, POS, inventory, procurement, production, payroll and analytics in
one Next.js application.

## Runtime

| Layer | Choice |
| --- | --- |
| UI | React 19, Next.js 15 App Router, Tailwind CSS 4 |
| API | Route handlers under `src/app/api/*`, Zod validation |
| Domain | TypeScript modules in `src/server/modules/*` |
| Persistence | PostgreSQL 16, Prisma 7 |
| Auth | bcrypt passwords, httpOnly session cookie, CSRF header |
| Tests | Vitest — unit (pure engines) and integration (full order lifecycle) |

## Project layout

```
frameworkshop/
  prisma/                 schema, migrations, demo seed
  src/app/(app)/          authenticated screens (RSC)
  src/app/api/            REST endpoints
  src/app/login/          public login
  src/components/         client widgets + design system
  src/lib/                money, units, format, statuses
  src/server/auth/        session, RBAC
  src/server/modules/     domain services
  src/server/api/         route wrapper + Zod schemas
  tests/unit/             engine tests (no database)
  tests/integration/      lifecycle test (TEST_DATABASE_URL)
  docs/                   ADR, ERD, this file
```

## Domain modules

| Module | Responsibility |
| --- | --- |
| `framing` | Geometry: mats, stacked frames, glazing, backing, waste |
| `pricing` | Retail from a rule (multiplier, chop/join, matrix, formula) |
| `catalog` | Items, snapshots for calculation, search, price history |
| `customers` | CRM card, LTV, notes vs communications |
| `orders` | CustomerOrder + WorkItem lifecycle, totals |
| `inventory` | On-hand / reserved / available, consume, shortages |
| `procurement` | Purchase orders from shortages |
| `production` | Tech card, kanban stages, time, quality gate, cut optimizer |
| `payments` | Invoices, partial payments, voids |
| `payroll` | Piecework from finished tasks |
| `reports` | Dashboard, ABC, finance, consumption — all from transactions |
| `audit` | Who changed what, old/new values |
| `notifications` | Internal inbox + outbound provider ports |

UI components do not compute prices or stock. They call the API; the API calls
a service; the service calls an engine inside a transaction when money, stock
or a status changes.

## Request path

```
Browser
  → api-client (CSRF header)
    → route() wrapper (session, permission, Zod, rate limit)
      → domain service
        → prisma.$transaction when money / stock / status moves
          → audit row
```

Server Components load data with the same services (no second API hop) and
pass DTOs into client widgets for mutations.

## Order lifecycle (happy path)

1. Receptionist creates a `Customer` (phone is the search key).
2. `createOrder` opens a `CustomerOrder` in `CALCULATION` / `UNPAID` / `WAITING`.
3. Constructor builds a `FramingSpec`. Preview hits `/api/pricing/calculate`.
4. `addWorkItem` persists geometry, `WorkItemComponent[]` and priced totals.
5. `confirmOrder` (one transaction): commercial → `CONFIRMED`, reserve stock,
   spawn `ProductionOrder` + quality checklist. Shortages do not roll back.
6. Payments update `paidTotal` / `balance` / `paymentStatus` only.
7. Master moves stages, starts/finishes tasks (timer + piecework).
8. Quality checklist is a gate: required items must be checked before `READY`.
9. `issueOrder` requires every active piece `READY`. `closeOrder` requires
   issue + zero balance.

## Security

- Passwords: bcrypt.
- Session: random token in DB + signed cookie; TTL from `AUTH_SESSION_TTL`.
- CSRF: double-submit cookie, required on POST/PATCH/DELETE.
- RBAC: see `src/server/auth/permissions.ts`.
- SQL: Prisma only. No string-built queries in UI.
- Multi-tenant: `organizationId` on every business row; services take it from
  the session, never from the client body as an override.

## What is intentionally not in this release

Adapter *ports* exist or are sketched for supplier APIs, CMC cutters,
Telegram/SMS and S3 storage. Concrete third-party adapters, PDF print pack,
PWA offline cache and the Tauri desktop wrapper are follow-up work. The
engines, ledger and screens needed to run a workshop day are implemented and
tested.

## Self-check commands

```bash
cd frameworkshop
npm run typecheck
npm run test:unit
npm run test:integration   # needs TEST_DATABASE_URL
npm run build
```
