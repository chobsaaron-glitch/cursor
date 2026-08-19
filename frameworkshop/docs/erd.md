# FrameWorkshop ERP — entity relationship overview

Money fields are integer kopecks. Dimensions are integer millimetres.
Quantities are floats rounded to 4 decimals. Every business table includes
`organizationId` (omitted on the diagram for readability).

```mermaid
erDiagram
  Organization ||--o{ Branch : has
  Organization ||--o{ User : has
  Organization ||--o{ Role : has
  Role ||--o{ RolePermission : grants
  User }o--|| Role : "assigned"
  User ||--o{ Session : opens

  Organization ||--o{ Customer : has
  Customer }o--o| CustomerSource : "came from"
  Customer ||--o{ CustomerNote : notes
  Customer ||--o{ CustomerCommunication : "external"
  Customer ||--o{ CustomerOrder : places

  Organization ||--o{ CatalogItem : sells
  CatalogItem }o--o| Supplier : supplied
  CatalogItem }o--o| PriceRule : priced
  PriceRule }o--o| PriceFormula : formula
  PriceRule }o--o| PriceMatrix : matrix
  CatalogItem ||--o{ PriceHistory : "never overwrite"
  CatalogItem ||--o{ MouldingSpec : "0..1"
  CatalogItem ||--o{ SheetSpec : "0..1"
  CatalogItem ||--o{ HardwareSpec : "0..1"
  CatalogItem ||--o{ ServiceSpec : "0..1"

  CustomerOrder ||--|{ WorkItem : contains
  WorkItem ||--|{ WorkItemComponent : "BOM"
  WorkItemComponent }o--o| CatalogItem : "uses"
  WorkItem ||--o{ WorkItemStatusHistory : trail
  WorkItem ||--o{ WorkItemComment : internal
  WorkItem ||--o{ DesignVariant : options

  CustomerOrder ||--o{ Invoice : billed
  Invoice ||--|{ InvoiceItem : lines
  CustomerOrder ||--o{ Payment : paid
  Payment }o--o| Invoice : "may attach"

  CatalogItem ||--o{ InventoryItem : stocked
  InventoryItem ||--o{ InventoryTransaction : ledger
  InventoryItem ||--o{ InventoryReservation : reserved
  WorkItem ||--o{ InventoryReservation : "holds"

  Organization ||--o{ PurchaseOrder : buys
  PurchaseOrder }o--|| Supplier : from
  PurchaseOrder ||--|{ PurchaseOrderItem : lines

  WorkItem ||--o| ProductionOrder : "job"
  ProductionOrder ||--|{ ProductionTask : operations
  ProductionTask ||--o{ ProductionTimeEntry : timer
  WorkItem ||--o{ QualityCheck : qc
  QualityCheck ||--|{ QualityCheckItem : checklist

  User ||--o| Employee : "payroll profile"
  Employee ||--o{ PayrollRecord : period
  PayrollRecord ||--o{ PayrollEntry : lines
  ProductionTask ||--o{ PayrollEntry : "piecework"

  Organization ||--o{ AuditLog : records
  Organization ||--o{ Notification : inbox
  Organization ||--o{ Document : files
```

## Cardinality notes

- One `CustomerOrder` holds many `WorkItem`s (a client may drop off three
  pieces in one visit).
- Components are generic: two mouldings are two rows, not `frame1`/`frame2`.
- `InventoryReservation` links a work item to a stock row. Status is `ACTIVE`,
  `RELEASED` or `CONSUMED`.
- `Payment.kind` is `PAYMENT` or `REFUND`; rows are voided, not deleted.
- Photos hang off `(entityType, entityId)` so intake and finished shots share
  one table without a forest of foreign keys.

## Status sets (independent)

| Entity | Tracks |
| --- | --- |
| `CustomerOrder.commercialStatus` | CALCULATION → QUOTE → CONFIRMED / CANCELLED |
| `CustomerOrder.productionStatus` | WAITING / IN_PRODUCTION / READY / ISSUED (derived) |
| `CustomerOrder.paymentStatus` | UNPAID / PARTIAL / PAID / REFUNDED |
| `WorkItem.status` | DRAFT … READY / ISSUED / CLOSED / CANCELLED |
| `ProductionOrder.stage` | kanban column (CUTTING, ASSEMBLY, …) |

Production status on the parent order is derived from its pieces
(`deriveOrderProductionStatus`) whenever a piece moves.
