# Zentro Inventory Implementation Report

Zentro Inventory & Stock Management System — implementation report for the food-business,
multi-location stock ledger. Backend is Django 6 / DRF at `backend/inventory`; frontend is
a TanStack Start merchant area at `/merchant/inventory`.

---

## 1. Purpose
One authoritative, tenant-scoped inventory ledger for every Zentro merchant. Stock is never
auto-deducted by orders; it changes only through explicit, auditable operations.

## 2. Design pillars
Immutable movement ledger, Decimal-only math, tenant scoping, idempotent mutations,
`transaction.atomic` + `select_for_update`, audit trail, forward-only model versioning.

## 3. App wiring
`"inventory"` added to `INSTALLED_APPS` (`backend/config/settings.py`); routes mounted at
`/api/inventory/` via `path("api/inventory/", include("inventory.urls"))` in
`backend/config/urls.py`. Migration `backend/inventory/migrations/0001_initial.py`.

## 4. Reference data
`seed_default_units` (18 system units: mg/g/kg/ml/L + count kinds with `factor_to_base`),
`seed_merchant_reference_data` (19 default categories + 8 locations), auto-seeded lazily on
first access to `/api/inventory/`.

## 5. Item model
`InventoryItem`: `item_type` (INGREDIENT/PREPARED/DIRECT_SALE/SUPPLY), base unit +
`purchase_unit_label`/`purchase_unit_conversion`, PAR/reorder/critical levels, count
schedule linkage, `last_count_at`/`next_count_due`/`last_received_at`, SKU/barcode,
archive flag (`archived` — never hard-deleted).

## 6. Balance model
`InventoryBalance`: unique (item, location), `on_hand`, `avg_cost` (weighted average),
`latest_cost`; the only source of truth for current stock.

## 7. Movement ledger
`InventoryMovement`: signed `quantity_change`, `balance_before`/`balance_after`, unit cost,
`source_type`/`source_id`, reversal link (`reversal_of`), unique nullable
`idempotency_key`.

## 8. Receiving
`InventoryReceiving` + `InventoryReceivingLine` (purchase quantity → base quantity
conversion, `line_total`). Receiving numbers `RCV-0001`.

## 9. Transfers
`InventoryTransfer` + `InventoryTransferLine`; lifecycle DRAFT → IN_TRANSIT → RECEIVED (or
CANCELLED). No stock change until `complete`.

## 10. Stock counts
`StockCount` + `StockCountLine` with `book_quantity` snapshot and `physical_quantity`;
lifecycle DRAFT → SUBMITTED → APPROVED (or CANCELLED).

## 11. Waste & adjustments
`InventoryWasteRecord` (9 reasons + custom) and `InventoryAdjustment` (explicit ±). Both
wrap the movement service — never auto-derived.

## 12. Suppliers & purchasing
`Supplier` + `SupplierItem` mappings (supplier SKU, purchase unit, latest cost, lead time)
and `PurchaseOrder` + lines with `received_quantity` and `remaining`.

## 13. Settings
`InventorySettings`: `require_count_approval` (default on), `require_adjustment_approval`,
`prevent_negative_stock`. `for_merchant` singleton per tenant.

## 14. Audit log
`InventoryAuditLog` records item create/update, supplier edits, count actions, transfers,
settings changes — all tenant-scoped with user attribution.

## 15. Schedules
`InventoryCountSchedule` (ITEM/CATEGORY/LOCATION scope, EVERY_N_DAYS) with next_due
assignment onto matching items.

## 16. Service hub
`services.py` is the single mutation engine: `InventoryMovementService` (apply_change,
opening_balance, receive, record_waste, manual_adjustment, transfer, reverse),
`StockCountService` (create/upsert_line/submit/approve/cancel), `PurchaseOrderService`
(create/receive_lines).

## 17. Absolutely never
Orders/POS/QR/AI-Waiter/KDS paths contain no inventory hooks; nothing is auto-deducted.
Item `PATCH` cannot touch balances; "current stock" is always read-only computed.

## 18. Count reconciliation rule
Approval posts `COUNT_RECONCILIATION` movements that set balance exactly to the physical
quantity (book 70 → observed 43 → 43, never 16). Variance is never relabelled waste/usage.

## 19. Waste rule
Waste exists only via explicit `record_waste`; it decrements stock immediately by the
recorded quantity.

## 20. PO rule
PO creation is pure paperwork; stock changes only when `receive_lines` runs at receiving
time (quantity purchase-units × conversion, cost → weighted-average `avg_cost`).

## 21. Stock status logic
OUT ≤ 0; CRITICAL ≤ critical_level (else reorder/2); LOW ≤ reorder_point; OVERSTOCK >
PAR×1.5; else HEALTHY. `suggested_order_qty = max(PAR − on-hand, 0)`.

## 22. Decimal-only math
All quantities/costs are `Decimal` end-to-end; DRF renders decimals to the client as
strings (e.g. `"5000.000000"`); frontend formats on display.

## 23. Idempotency
Unique `idempotency_key` (tenant-scoped lookup) on receiving records, waste, adjustments,
transfer completion and PO batch receive (per-batch keys `{key}-line-{id}`); retries are
no-ops, never double-posted.

## 24. Atomicity
Every multi-record mutation is wrapped in `@transaction.atomic` with `select_for_update`,
so a failed count/waste/transfer cannot orphan records or post partial stock changes.

## 25. Tenant isolation
Every query and every FK resolution validates `merchant`; cross-merchant supplier/location
is rejected (wrapped as 400 `ValidationError` in Receiving).

## 26. Permissions
`InvPerm` capability set + `IsMerchantOrSuperuser`, `view_cost_allowed` gating cost fields;
count submit/approve require respective capabilities.

## 27. Serializers
_InventoryItem_ (progressive create with optional opening balance + idempotent key),
_Movement_, _Waste/Adjustment_ (idempotency via context), _Receiving (create + list)_,
_Transfer (create + list, nested lines)_, _StockCount (+ line upsert/create)_,
_Supplier (+ mapping)_, _PO (create/receive/list, `received` dict of `{line_id: {qty, cost}}`)_, plus
_Schedule/Location/Category/Unit/Settings/Audit/Overview_. `_balance_map` is attached
before serialization so `status`/`current_stock` are correct, and total/balance iterators
use `.values()` of the item map.

## 28. Endpoints — reference & overview
`GET /api/inventory/` root (configuration + permissions), `GET /overview/`, `GET,POST
/schedules/`, `PATCH,DELETE /schedules/{id}/`.

## 29. Endpoints — items
`GET,POST /items/` (search q, type, category, location, supplier, post-aggregation status
filter; `?include_balance=0` to skip balance prefetch), `GET,PATCH /items/{id}/`,
`POST /items/{id}/archive/`, `GET /items/{id}/movements/` (date-range + pagination +
movement total).

## 30. Endpoints — movements & corrections
`GET /movements/` (type filter), `POST /movements/{id}/reversal/`,
`GET,POST /waste/`, `GET,POST /adjustments/`.

## 31. Endpoints — operations
`GET,POST /receiving/` + `GET /receiving/{id}/`; `GET,POST /transfers/` +
`POST /transfers/{id}/complete/` (idempotency key) + `/cancel/`; `GET,POST /counts/` +
`GET /counts/{id}/`, `POST /counts/{id}/lines/`, `/submit/`, `/approve/`, `/cancel/`.

## 32. Endpoints — purchasing
`GET,POST /suppliers/`, `GET,PATCH,DELETE /suppliers/{id}/` (DELETE = soft archive),
`POST /suppliers/{id}/mappings/`, `GET,POST /purchase-orders/`,
`GET,PATCH /purchase-orders/{id}/`, `POST /purchase-orders/{id}/receive/`.

## 33. Reports & audit
`GET /reports/?report=movements|variance|waste|purchasing|stock|low-stock|count-history`;
`GET /audit/`. Cost fields auto-hidden when `view_cost_allowed` is false.

## 34. Admin
Unfold `ModelAdmin`s for all 20+ models (inline lines, filters, `search_fields`
incl. `code,name` on units, read-only balance/movement displays), produced via a PEP 502+
compatible admin module.

## 35. Migration
`0001_initial` generated and applied to the local SQLite DB; `makemigrations --check
--dry-run` → "No changes detected"; `manage.py check` passes.

## 36. Backend tests
`inventory/tests.py` (service-level) + `inventory/test_api.py` (endpoint-level): 45 tests
covering the regression matrix — count sets balance to physical; multi-batch PO receiving;
idempotent retries; tenant isolation; failure atomicity; waste/adjustment/transfer flows.
`Ran 45 tests … OK`.

## 37. Full backend suite
From `backend/` working dir: `Ran 333 tests … OK (skipped=2)` — skips are pre-existing and
unrelated to inventory.

## 38. CI parity
`.github/workflows/ci.yml` runs PostgreSQL 16 + `manage.py test` + migration check from
`backend/` cwd, and a frontend typecheck/build + informational lint — matching local
verification.

## 39. Known env quirk
A leftover repo-root `test_register.py` performs network I/O at import; running
`manage.py test` with repo-root cwd trips it. Resolved by always running the suite from
`backend/` (as CI does).

## 40. Frontend API client
`src/lib/api/inventory.ts`: typed models mirroring serializers (decimals as strings,
status enums, paginated `{results,count}`) + `inventoryApi` covering every endpoint +
`uid()` idempotency helpers; exported from `src/lib/api/index.ts`.

## 41. Frontend feature area
`src/features/inventory/` — shared bits (`StatusBadge`, `StatCard`, `EmptyState`,
`LoadingBlock`/`ErrorBlock`, `SectionHeader`, `Field`, formatting helpers) and tab
components, following the merchant area's `useState/useEffect` + `djangoFetch` fetch
pattern and Zentro design tokens.

## 42. Frontend tabs
Overview (stats + needs-attention + recent movements + counts-due), Items (search/type/
status/category filters, add/edit dialog with optional opening balance, archive,
pagination — stock shown read-only), Receiving (record with item lines), Transfers
(create + complete/cancel), Stock Counts (start, per-line physical entry auto-save,
submit/approve posting variance, cancel), Waste & Adjustments (record waste by reason +
manual ± adjustment), Suppliers & POs (suppliers, create PO, idempotent batch receive),
Movement Ledger (type filter + reversal), Settings (guards + audit trail).

## 43. Route & navigation
`src/routes/merchant.inventory.tsx` (thin route wrapper with `head` meta) registered in
the regenerated `routeTree.gen.ts`; Inventory added to the merchant sidebar under
Operations (`navItems` in `src/routes/merchant.tsx`).

## 44. Frontend verification
`npx tsc --noEmit` → 0 errors; `npm run build` → success (all bundles built, PWA copied,
route tree regenerated); `eslint` on the new files → 0 errors (only fast-refresh warnings,
consistent with the repo's informational lint step).

## 45. Status & next steps
Phase 1 complete end-to-end (models → service → API → admin → migration → 333 passing
tests → typed client → tabbed merchant UI → route/nav → verified build). Recommended
follow-ups: seeded demo data for onboarding, low-stock/PO-due notifications, CSV/PDF report
export for the new report endpoints, and a PWA cache-bust on the inventory route.