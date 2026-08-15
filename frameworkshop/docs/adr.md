# Architecture Decision Records — FrameWorkshop ERP

Decisions are listed oldest-first. Each record states the context, the choice,
and the consequence that later work must respect.

## ADR-001. Modular monolith, not microservices

**Context.** A framing workshop is one business: an order change must update
geometry, materials, stock, production and money in the same breath.

**Decision.** One Next.js application, one PostgreSQL database, domain modules
under `src/server/modules/*`. Modules talk through typed functions, not HTTP.

**Consequence.** Deployments stay simple. Cross-module invariants (payment
updates the order balance, confirmation reserves stock) are enforced with
Prisma transactions rather than sagas.

## ADR-002. Multi-tenant from day one

**Context.** The product is intended for more than one workshop.

**Decision.** Every business table carries `organizationId`. Sessions bind a
user to exactly one organisation. Queries always filter by that id.

**Consequence.** A later SaaS split does not require a data migration of the
core model. Branch-level stock is a child of the organisation, not a tenant.

## ADR-003. Money is integer kopecks

**Context.** Float roubles accumulate rounding error across discounts, tax and
weighted-average cost.

**Decision.** Persist amounts as `Int` kopecks. Convert at the form/API
boundary via `src/lib/money.ts`. Display with `Intl.NumberFormat('ru-RU')`.

**Consequence.** `18 500,00 ₽` is stored as `1_850_000`. Pricing, payroll and
reports never multiply floats that represent money.

## ADR-004. Lengths are millimetres

**Context.** Receptionists enter cm, mm or inches; cutters work in mm.

**Decision.** Store every dimension as an integer millimetre. Parse and convert
in `src/lib/units.ts`. Fractional inches (`1 1/2"`) are accepted at input.

**Consequence.** Geometry, cut plans and labels share one unit. Display can
switch to cm or inches without rewriting the database.

## ADR-005. Work items are component lists, not fixed slots

**Context.** A piece can have seven mats, two frames, or no glass. Fixed
columns (`frame1`, `mat1`) force schema changes for every new construction.

**Decision.** `WorkItem` owns `WorkItemComponent[]`. Each line has a catalog
group, a quantity, a role (`OUTER_FRAME`, `MAT_1`) and its own price/cost.

**Consequence.** New material types are catalog rows, not migrations. Reports
and inventory consume the same lines the constructor produced.

## ADR-006. Three independent statuses on an order

**Context.** A prepaid order is not automatically “in production”, and a ready
order may still have a balance.

**Decision.** `commercialStatus`, `productionStatus` and `paymentStatus` are
separate enums. Payments never flip commercial or production status.

**Consequence.** The receptionist can take a 50 % deposit on a confirmed order
without the floor thinking the job is finished.

## ADR-007. Engines are pure and layered

**Context.** Pricing that secretly computes geometry, or inventory that
recalculates prices, cannot be tested or reasoned about.

**Decision.**

```
Geometry engine  →  Material lines  →  Pricing engine
        ↓                                    ↓
   Order service  →  Inventory  →  Production  →  Finance
```

Each engine is a TypeScript module with unit tests and no Prisma dependency
except the services that persist results.

**Consequence.** The constructor preview hits `/api/pricing/calculate` and
reuses the same functions that `addWorkItem` uses to write the database.

## ADR-008. Pricing rules live in the database

**Context.** Workshops change multipliers, chop/join tariffs and size matrices
without a release.

**Decision.** `PriceRule`, `PriceFormula` and `PriceMatrix` are data. The
engine accepts a rule plus dimensions/cost and returns a `PriceResult`.
`CHOP`/`JOIN` apply an optional cost `factor`. Every rule can set `minMarkup`
so retail never falls below `cost × minMarkup`.

**Consequence.** Seed data and admin edits change prices. Code changes only
when a new *method* is introduced.

## ADR-009. Financial rows are voided, never deleted

**Context.** An accidental payment must remain visible to audit.

**Decision.** `Payment` and `Invoice` have `voided` / `VOIDED` states, a
reason, and who voided them. Physical `DELETE` is forbidden.

**Consequence.** Ledgers stay reconstructable. `recalcOrderTotals` ignores
voided payments.

## ADR-010. Inventory is a ledger plus a cache

**Context.** “On hand = 7.6 m” is useless without knowing why.

**Decision.** Every receive, reserve, issue, waste, adjust and write-off
writes `InventoryTransaction`. `InventoryItem.quantityOnHand` /
`quantityReserved` are updated in the same transaction and rounded to 4
decimals to kill float drift.

**Consequence.** Confirmation creates reservations; finishing a piece consumes
them (net + waste). Shortages do not block confirmation — they feed purchase
suggestions.

## ADR-011. RBAC is a permission catalog, not role checks in UI

**Context.** A receptionist may take payment but must not edit price rules.

**Decision.** Permissions are strings (`orders.view_cost`, `payments.refund`).
Roles are assemblies of those strings. `*` is reserved for ADMIN. API routes
declare the permission they need; screens hide actions the session lacks.

**Consequence.** A new role is a seed change. Cost and payroll columns
disappear for roles without `orders.view_cost` / `payroll.view`.

## ADR-012. Sessions are server-side, CSRF is cookie + header

**Context.** A cookie-only session is enough for a same-origin ERP, but form
posts need CSRF protection.

**Decision.** Session token in an httpOnly cookie, JWT-signed payload,
matching CSRF cookie echoed as `x-csrf-token` on mutating fetches. Passwords
are bcrypt hashes.

**Consequence.** The browser client in `src/lib/api-client.ts` is the only
place that has to remember the CSRF header.

## ADR-013. Demo seed is a real workflow, not fixtures

**Context.** A workshop evaluating the product must open a finished order, not
an empty schema.

**Decision.** `prisma/seed.ts` creates the organisation «Рама и свет», 100+
mouldings, customers, and drives orders through `createOrder` → `addWorkItem`
→ `confirmOrder` → `recordPayment` → production → `issueOrder`.

**Consequence.** Seed failures are product bugs. Integration tests use a
smaller fixture on `TEST_DATABASE_URL` so they never wipe the demo database.
