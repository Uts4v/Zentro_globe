You are a Senior Product Designer, Senior React/TypeScript Engineer,
Senior Django/DRF Engineer, and Restaurant Inventory UX Architect
working on Zentro.

Your task is to REDESIGN and SIMPLIFY the existing Zentro Inventory system.

This is NOT a request to rebuild the inventory backend.

The current backend is already sophisticated and must remain authoritative.

The primary goal is:

Make inventory so simple that a restaurant employee with very little technical
experience can learn the main workflows quickly after basic training.

The interface should use plain language, large touch targets, obvious actions,
minimal jargon, and task-based navigation.

At the same time, preserve the advanced inventory architecture needed by managers,
owners, reporting, audits, receiving, stock counts, suppliers, and purchasing.

Also add:

- CSV inventory import
- CSV inventory export
- CSV template download
- PDF inventory export/download
- PDF inventory import through a SAFE REVIEW workflow

============================================================
1. FIRST — AUDIT THE EXISTING INVENTORY IMPLEMENTATION
============================================================

Before changing anything, inspect:

backend/inventory/

src/features/inventory/

src/lib/api/inventory.ts

inventory routes

InventoryMovementService

InventoryItem

InventoryBalance

InventoryMovement

StockCount

Receiving

Transfers

Waste

Adjustments

Suppliers

Purchase Orders

InventorySettings

InventoryAuditLog

permissions

reports

existing import/export utilities elsewhere in Zentro

existing PDF generation utilities

existing CSV utilities

existing AI/document parsing integration if any

Do NOT immediately create new models.

Return a short audit first:

Existing components that can be reused:
Existing APIs that can be reused:
Current navigation:
Current role/permission behavior:
Current reports:
Current stock-count workflow:
Current file/export infrastructure:
Critical bugs that affect this project:
Recommended migration approach:

Then implement.

============================================================
2. DO NOT REBUILD THE INVENTORY CORE
============================================================

Preserve the existing architecture:

InventoryItem
=
What the thing is

InventoryBalance
=
How much exists right now

InventoryMovement
=
Why it changed

InventoryMovement is permanent history.

InventoryBalance must NOT become directly editable.

All stock changes must continue through the existing authoritative movement service.

Do NOT create a second stock-calculation system.

Do NOT bypass:

InventoryMovementService.apply_change()

Preserve:

transaction.atomic()

select_for_update()

tenant validation

negative-stock rules

idempotency

weighted average cost

movement history

audit trail

reversals instead of deletion

============================================================
3. PRODUCT DESIGN PRINCIPLE
============================================================

Design around:

"What is the employee trying to do?"

NOT:

"What inventory database model are they editing?"

A normal staff member thinks:

How much do we have?

New stock arrived.

I need to count stock.

Something spoiled.

I need to move something.

The number looks wrong.

They do NOT naturally think:

Inventory Movement

Reconciliation

PAR

Variance

Adjustment

Ledger

Transfer Document

Receiving Document

Design Zentro around the first mental model.

============================================================
4. NEW PRIMARY INVENTORY NAVIGATION
============================================================

Replace the current overloaded navigation with a much simpler structure.

Recommended:

Inventory

Overview

Stock

Count Stock

Add / Move Stock

Suppliers

Reports

History

Settings

However, role-based visibility should reduce this further.

For basic staff:

Inventory

Stock

Count Stock

Add / Move Stock

For manager:

+ Suppliers
+ Reports
+ History

For owner/admin:

+ Settings
+ Audit details
+ Cost information

Do not expose everything to everyone.

============================================================
5. INVENTORY HOME / OVERVIEW
============================================================

The Inventory homepage should answer:

What needs attention?

and

What do you want to do?

Recommended:

Inventory

Good morning, Ram.

What do you want to do?

[ Check Stock ]
See what is available now

[ Count Stock ]
Count what is physically there

[ Add Delivery ]
New stock arrived

[ Move Stock ]
Move stock between locations

[ Record Waste ]
Something spoiled, broke or was lost


Needs Attention

Milk
Bar
2 L left
LOW

Chicken
Kitchen
0 kg
OUT

Paper Cups
Front Counter
25 left
VERY LOW


Manager Tools

[ Suppliers ]
[ Reports ]
[ History ]

Do NOT lead with six large analytics cards.

Staff actions are more important than dashboards.

============================================================
6. FRIENDLY TERMINOLOGY
============================================================

Do not rename backend models/enums unless technically necessary.

Change DISPLAY terminology only.

Use:

Inventory Item
→ Stock Item

Receiving
→ Add Delivery

Transfer
→ Move Stock

Stock Count
→ Count Stock

Manual Adjustment
→ Fix Stock

Ledger
→ Stock History

Book Quantity
→ System Says

Physical Quantity
→ You Counted

Variance
→ Difference

PAR Level
→ Keep Around

Reorder Point
→ Warn Me Below

Critical Level
→ Very Low Level

Opening Quantity
→ How much do you have now?

Base Unit
→ Count In

Default Location
→ Usually Kept In

Purchase Unit
→ How You Buy It

Conversion Factor
→ Pack Size

Approve & Post Variance
→ Approve & Update Stock

Reverse
→ Undo This Change

Purchase Order
→ Supplier Order

Do not show technical terms such as:

PAR

delta

ledger

variance

reconciliation

conversion factor

PO

to normal frontline users.

============================================================
7. STOCK PAGE
============================================================

The Stock page should be the easiest inventory page.

Header:

Stock

Search:
[ Search stock... ]

Simple filters:

[ All ]
[ Good ]
[ Low ]
[ Very Low ]
[ Out ]

Optional:

Location

Category

Each row/card:

Chicken Breast

Main Kitchen

18 kg left

● Good


Milk

Bar

3 L left

⚠ Low


Paper Cups

Front Counter

0 pieces

● Out

Use:

icon
+
label
+
color

Never color alone.

============================================================
8. STOCK STATUS
============================================================

Keep current backend status logic.

Display:

HEALTHY
→ Good

LOW
→ Low

CRITICAL
→ Very Low

OUT
→ Out

OVERSTOCK
→ More Than Usual

Recommended styling:

Good:
green/olive

Low:
amber

Very Low:
red/orange

Out:
red

More Than Usual:
blue/info

Keep status language simple.

============================================================
9. STOCK DETAIL
============================================================

Tapping an item opens:

Chicken Breast

Current Stock
18 kg

Usually Kept In
Main Kitchen

Status
Good

Last Counted
Sep 28

Last Delivery
Sep 29


Quick actions:

[ Count ]
[ Add Delivery ]
[ Move ]
[ Record Waste ]

Manager:

[ Edit Item ]
[ Fix Stock ]
[ View History ]

Advanced information should be collapsed.

============================================================
10. ADD STOCK ITEM
============================================================

The normal Add Item form should ask approximately FIVE questions.

Add Stock Item

1.
What is it called?

[ Chicken Breast ]

2.
What kind of item is it?

○ Food / Ingredient
○ Prepared Here
○ Drink / Sold As-Is
○ Packaging / Supply

Map these to existing backend enum values.

3.
How do you count it?

[ kg ]

4.
Where is it usually stored?

[ Main Kitchen ]

5.
How much do you have now?

[ 20 ] kg

[ Add Item ]

Everything else should be under:

Advanced

============================================================
11. ADVANCED ITEM SETTINGS
============================================================

Advanced may contain:

Category

SKU

Barcode

Preferred Display Unit

Stock Alerts

Keep Around

Warn Me Below

Very Low Level

Buying & Supplier

Purchase Unit

Pack Size

Cost

Menu Links

Do not remove advanced functionality.

Just hide it from the primary workflow.

============================================================
12. PURCHASE UNIT UX
============================================================

Do not ask users for:

conversion factor

Instead show:

How do you buy this item?

○ Same way I count it

● In bags / boxes / cases


I buy it as:

[ Sack ]


One sack contains:

[ 25 ] [ kg ]


Summary:

1 sack = 25 kg

This should map to the existing purchase-unit conversion data.

============================================================
13. COUNT STOCK
============================================================

This should be one of Zentro's strongest inventory experiences.

Use mobile-first design.

Start:

Count Stock

Where are you counting?

[ Main Kitchen ]

[ Bar ]

[ Dry Storage ]

[ Freezer ]

[ Everything ]


Then:

Main Kitchen

12 of 30 counted

[ Search item... ]


Chicken Breast

System says:
18 kg

How much do you see?

[        ] kg


After entry:

System says:
18 kg

You counted:
15 kg

Difference:
3 kg less


Another:

System says:
20 kg

You counted:
20 kg

Difference:
Matches

Use clear plain language.

============================================================
14. COUNT PROGRESS
============================================================

Show:

12 of 30 counted

progress bar

Allow:

Save & Continue Later

Finish Count

Autosave values safely.

Do not create annoying "Saved!" popups after every field.

Use subtle:

Saved ✓

============================================================
15. COUNT APPROVAL
============================================================

If approval is required:

Employee:

Finish Count

Message:

Count finished.

A manager will review the differences before stock is updated.

Manager screen:

Review Count

Chicken

System Said
18 kg

Counted
15 kg

Difference
3 kg less


Milk

System Said
10 L

Counted
12 L

Difference
2 L more


[ Approve & Update Stock ]

Keep existing backend reconciliation behavior.

Do not directly overwrite balances.

============================================================
16. ADD / MOVE STOCK ACTION CENTER
============================================================

This page contains:

[ Add Delivery ]

[ Move Stock ]

[ Record Waste ]

Manager only:

[ Fix Stock ]

Each is a large action card.

No technical tabs.

============================================================
17. ADD DELIVERY
============================================================

Use simple language.

New Delivery

Where did it arrive?

[ Main Kitchen ]

Who delivered it?

[ ABC Foods ]
optional

Reference / invoice

[            ]
optional

What arrived?

Chicken Breast

[ 2 ] sacks

1 sack = 25 kg

Cost

[ 12000 ]
optional


[ + Add Another Item ]


[ Add to Stock ]

Do not ask user to manually convert sacks to kg/g.

Existing backend handles conversion.

============================================================
18. DELIVERY RESULT
============================================================

After success:

Delivery Added

Chicken Breast

+50 kg

Main Kitchen

New stock:
68 kg

[ Done ]

[ Add Another Delivery ]

============================================================
19. MOVE STOCK
============================================================

Move Stock

Move from:

[ Dry Storage ]

Move to:

[ Main Kitchen ]

What are you moving?

[ Rice ]

How much?

[ 10 ] kg

Note
optional

[ Move Stock ]

If current backend requires Complete lifecycle, simplify UI wording.

Possible status labels:

DRAFT
→ Not Started

IN_TRANSIT
→ Being Moved

RECEIVED / COMPLETE
→ Moved

Avoid exposing internal enums.

============================================================
20. RECORD WASTE
============================================================

Record Waste

What was wasted?

[ Milk ]

How much?

[ 2 ] L

Where?

[ Bar ]

Why?

[ Expired ]

Friendly reasons:

Spoiled

Expired

Dropped

Damaged

Over-prepared

Kitchen mistake

Customer return

Staff meal

Other

Note:
optional

[ Record Waste ]

Waste must remain explicit.

Never infer waste from stock count difference.

============================================================
21. FIX STOCK
============================================================

Manager permission only.

Do NOT show:

delta = -5

Instead:

Fix Stock

Item:

[ Milk ]

Current stock:

12 L


What needs to change?

○ Add Stock

○ Remove Stock


Amount

[ 2 ] L


Why?

[ Data entry mistake ]

Note

[ optional ]


[ Update Stock ]

Backend may continue using signed adjustment values.

Frontline UI should not.

============================================================
22. STOCK HISTORY
============================================================

Rename Ledger to:

Stock History

Use timeline/event language.

Example:

Today · 10:32 AM

Chicken Breast
+50 kg

Delivery added

ABC Foods

Added by Ram


Yesterday · 4:10 PM

Milk
-2 L

Waste · Expired

Recorded by Sita


Sep 28

Rice

20 kg → 17 kg

Stock Count

Approved by Manager

Filters:

All

Deliveries

Counts

Waste

Moves

Corrections

Sales

Undo

============================================================
23. REVERSAL UX
============================================================

Do not say:

Reverse Movement

Say:

Undo This Change

Confirmation:

Undo this change?

This will create an opposite stock entry.

The original record will remain in Stock History.

[ Cancel ]

[ Undo Change ]

Preserve append-only movement history.

============================================================
24. SUPPLIERS
============================================================

Keep Suppliers as a manager feature.

Simplify naming:

Suppliers

Orders From Suppliers

New Supplier

New Supplier Order

Receiving supplier orders should reuse Add Delivery concepts where practical.

Do not expose inventory accounting terminology unnecessarily.

============================================================
25. REPORTS
============================================================

Create one clear Reports page.

Reports:

Current Stock

Low Stock

Stock Movements

Stock Counts

Count Differences

Waste

Purchasing

Each report gets:

Date filter if applicable

Location

Category

Export

============================================================
26. CSV / PDF EXPORT
============================================================

Every relevant report should support:

[ Download CSV ]

[ Download PDF ]

CSV:
for spreadsheet/data work

PDF:
for managers, owners, auditors, printing and sharing

Current Stock export should include:

Item

Item Type

Category

Location

Current Quantity

Unit

Status

Keep Around

Warn Me Below

Very Low Level

Last Counted

Last Received

Optional cost fields when permission allows:

Average Cost

Latest Cost

Stock Value

Never leak cost data to users without view_cost permission.

============================================================
27. MAIN IMPORT / EXPORT CENTER
============================================================

Add:

Import / Export

to Inventory.

Recommended modal/page:

Inventory Import & Export


IMPORT

[ Import Inventory CSV ]

[ Import Inventory PDF ]


TEMPLATES

[ Download CSV Template ]


EXPORT

[ Export Current Stock CSV ]

[ Download Inventory PDF ]

[ Export Stock History ]

[ Export Waste ]

[ Export Stock Counts ]

============================================================
28. CSV TEMPLATE
============================================================

Provide a downloadable template.

Basic columns:

item_name

item_type

category

unit

location

opening_quantity

opening_unit_cost

sku

barcode

keep_around

warn_me_below

Optional advanced columns:

very_low_level

preferred_display_unit

purchase_unit_label

purchase_unit_quantity

supplier

supplier_sku

menu_item_code

quantity_per_sale

Do not require every optional column.

============================================================
29. CSV TEMPLATE UX
============================================================

When user clicks:

Download CSV Template

download:

zentro_inventory_template.csv

Include:

header row

2–3 sample rows

or provide:

template
+
example instructions

If sample rows could accidentally import, clearly mark/remove them.

Prefer a separate:

zentro_inventory_example.csv

if necessary.

============================================================
30. CSV IMPORT
============================================================

Flow:

Import Inventory

Step 1

Upload CSV

[ Choose File ]


Step 2

Read file


Step 3

Validate


Step 4

Preview


Step 5

Fix errors


Step 6

Confirm Import


Step 7

Import results

Never immediately mutate inventory after upload.

============================================================
31. CSV IMPORT PREVIEW
============================================================

Example:

Inventory Import

File:
inventory.csv

82 rows found

76 ready

4 warnings

2 errors


Chicken Breast
✓ Ready

Milk
✓ Ready

Cooking Oil
⚠ Unknown unit "tin"

Paper Cups
⚠ Location "Counter 2" does not exist

Rice
✕ Quantity cannot be negative


[ Download Error Report ]

[ Fix File ]

[ Import 76 Ready Items ]

or:

[ Import Only When Everything Is Valid ]

Choose the safest UX consistent with implementation.

============================================================
32. CSV IMPORT MODES
============================================================

Do not blindly overwrite live inventory.

Provide import intent.

What are you importing?

[ New Stock Items ]

Create item definitions.

Opening quantity is allowed only for newly created items.


[ Update Item Details ]

Update names/categories/alerts/purchase metadata.

Do NOT directly overwrite current stock quantity.


[ Physical Stock Count ]

Import counted physical quantities.

Create a StockCount draft.

Merchant reviews/approves it.

Then existing count reconciliation updates stock.

This is extremely important.

Do NOT set InventoryBalance directly from CSV.

============================================================
33. EXISTING ITEM MATCHING
============================================================

Prefer stable identifiers.

Matching order:

SKU

barcode

explicit Zentro item ID/code

then exact normalized item name only if safe

If uncertain:

Possible Match

CSV:
Chicken Breast

Existing:
Chicken Breast

[ Update Existing ]

[ Create New ]

Do not silently duplicate.

============================================================
34. OPENING STOCK IMPORT
============================================================

For NEW items only:

opening_quantity may create opening stock.

That must go through:

InventoryMovementService.opening_balance()

Do not directly set InventoryBalance.

============================================================
35. EXISTING STOCK QUANTITY IMPORT
============================================================

Do not directly overwrite existing quantity.

If user wants to import physical stock levels:

CSV
→ create StockCount draft
→ show System Says / Imported Count
→ merchant reviews
→ submit
→ approve
→ COUNT_RECONCILIATION

This preserves the inventory ledger.

============================================================
36. CSV ERROR HANDLING
============================================================

Validate:

required fields

merchant scope

item type

category

unit

location

numeric quantities

cost

purchase unit conversion

duplicate SKU

duplicate barcode

cross-kind unit conversion

negative quantities

invalid relationships

Provide row number.

Example:

Row 17

Cooking Oil

Problem:

Unit "box" is not configured.

[ Choose Existing Unit ]

or fix CSV and upload again.

============================================================
37. IMPORT AUDIT
============================================================

Every import session should record:

merchant

uploaded_by

file_name

file_type

started_at

completed_at

rows_total

rows_imported

rows_failed

import_type

Do not expose sensitive file data unnecessarily.

If existing audit infrastructure can capture this, reuse it.

============================================================
38. IDEMPOTENT IMPORT
============================================================

Prevent accidental double import.

Use import session ID / hash / idempotency key.

If same import is submitted again:

warn:

This file appears to have already been imported.

[ View Previous Import ]

[ Import Again Anyway ]
manager only if needed

============================================================
39. PDF EXPORT
============================================================

Add a professional Inventory PDF.

Example:

ZENTRO INVENTORY REPORT

Silver Fir

Sep 30, 2026


SUMMARY

Total Stock Items

Low Stock

Very Low

Out of Stock

Inventory Value
if permission allows


NEEDS ATTENTION

Item

Location

Quantity

Status


CURRENT STOCK

Item

Category

Location

Quantity

Unit

Status


Optional sections:

Waste Summary

Count Differences

Recent Deliveries

Purchasing

Use pagination.

Repeat table header on new pages.

Include generated date/time.

============================================================
40. PDF EXPORT TYPES
============================================================

Allow:

Current Stock PDF

Low Stock PDF

Waste Report PDF

Count History PDF

Purchasing PDF

Full Inventory Summary PDF

Do not cram every report into one document unless user selects Full Report.

============================================================
41. PDF IMPORT
============================================================

PDF import is fundamentally different from CSV.

Do NOT allow:

PDF
→ automatically change stock

Use:

PDF
→ Extract
→ Draft
→ Review
→ Confirm
→ Inventory service

============================================================
42. PDF IMPORT TYPES
============================================================

Support:

text PDFs

and, if existing AI/document parsing integration exists:

scanned inventory PDFs

photos embedded in PDFs

Do not introduce a completely new AI provider solely for this feature without
reviewing the existing Zentro AI infrastructure.

If no safe extraction capability exists:

support text-based PDF first.

============================================================
43. PDF IMPORT REVIEW
============================================================

Example:

Import from PDF

inventory-september.pdf


Zentro found:

38 stock items

31 high confidence

5 need review

2 could not be read


Chicken Breast

Quantity
18 kg

✓ Looks good


Cooking Oil

Quantity
[ 10 ]

Unit
[ L ]

⚠ Please confirm


Unknown Item

[ Edit Name ]

[ Skip ]


[ Review 7 Issues ]

[ Continue ]

============================================================
44. PDF IMPORT CONFIDENCE
============================================================

If AI/document extraction is used:

store/display confidence for uncertain fields.

Do not show fake precision to user.

Example:

Quantity unclear

Zentro read:
70 kg

Original text:
10 kg ?

[ Confirm 10 kg ]

[ Confirm 70 kg ]

============================================================
45. PDF IMPORT SAFETY
============================================================

PDF-extracted current quantities should become:

StockCount draft

NOT:

direct InventoryBalance values.

New item opening quantity may use opening balance only after user confirms.

Never allow AI/PDF parser to directly call stock-changing APIs without merchant review.

============================================================
46. IMPORT IMAGES
============================================================

Inventory item photos do not need to be part of CSV/PDF import in V1.

If an image URL column exists later:

treat it as optional metadata.

Do not let image handling block inventory import.

============================================================
47. ROLE-BASED UI
============================================================

Use the existing permission framework.

Suggested experience:

BASIC STAFF

Stock

Count Stock

Record Waste


KITCHEN / BAR STAFF

Stock

Count Stock

Record Waste

Move Stock


MANAGER

Everything above

Add Delivery

Fix Stock

Suppliers

Reports

History


OWNER / ADMIN

Everything

Settings

Costs

Audit Log

Import / Export

Role defaults may vary according to existing Zentro role model.

============================================================
48. CRITICAL PERMISSION FIX
============================================================

Audit current inventory permission enforcement.

Do not rely only on frontend tab hiding.

Every sensitive endpoint must enforce permission server-side.

The UI should hide unavailable actions,
but backend permissions remain authoritative.

Verify capabilities such as:

view inventory

view costs

manage items

count

submit count

approve count

receive

adjust

record waste

manage suppliers

purchase

transfer

view reports

manage settings

import/export

Add new permission only if genuinely necessary.

============================================================
49. COST PRIVACY
============================================================

Normal employees should not automatically see:

unit cost

average cost

stock value

purchase cost

waste cost

Only display these if:

view_cost_allowed(user)

or equivalent existing permission passes.

Exports must apply the same rule.

CSV/PDF cannot become a cost-data leak.

============================================================
50. FIX CROSS-MERCHANT REPORT COST LEAK
============================================================

Before exposing new report/export functionality:

audit the existing variance report cost lookup.

Every cost/balance query must explicitly remain merchant-scoped.

Never use an unscoped .balances.first() or equivalent.

Add regression test:

Merchant A must never receive Merchant B cost values.

============================================================
51. FIX STOCK PAGINATION
============================================================

Current Stock must support real backend pagination.

Implement:

page

page_size / per_page

total_count

next/previous metadata

Do not refetch and render the entire inventory for every page.

Search/filter must work with pagination.

This matters for merchants with:

100

500

1000+

items.

============================================================
52. ADJUSTMENT APPROVAL
============================================================

Inspect:

require_adjustment_approval

If the setting exists but currently does nothing:

either implement the workflow correctly

or clearly mark it unavailable and do not mislead merchants.

Do not leave a settings toggle that promises approval but does not enforce it.

If implementing:

PENDING

APPROVED

REJECTED

Stock must only change according to the defined approved workflow.

============================================================
53. DOCUMENT NUMBER SAFETY
============================================================

Review receipt / PO number generation if touching import/export/receiving.

Do not rely on:

count() + 1

for concurrency-sensitive document numbers.

Use a safe sequence strategy if necessary.

Do not broaden this project unnecessarily, but do not make new import workflows
depend on collision-prone identifiers.

============================================================
54. SETTINGS PAGE
============================================================

Keep Settings simple.

Stock Safety

Manager approves stock counts
[ ON ]

Prevent stock below zero
[ ON ]

Manager approves stock corrections
[ OFF / only if actually supported ]


Advanced

Audit History

Import / Export defaults

Do not expose internal engine settings.

============================================================
55. MOBILE DESIGN
============================================================

Inventory must work extremely well on phone.

Especially:

Count Stock

Record Waste

Move Stock

Add Delivery

Use:

44px+ touch targets

large numeric fields

numeric keyboard

sticky primary action

simple cards

minimal table layouts

avoid horizontal scrolling

============================================================
56. DESKTOP DESIGN
============================================================

Desktop may use tables for:

Stock

Reports

Suppliers

History

But keep actions task-based.

Do not turn the homepage into an accounting dashboard.

============================================================
57. VISUAL SYSTEM
============================================================

Use existing Zentro UI system.

Manrope.

Warm Ivory:
#FBF7EF

Porcelain:
#FFFDF9

Deep Café Teal:
#0F3D3A

Espresso:
#172A2B

Oat:
#F3E7D5

Olive:
#596B32

Warning:
#B98134

Danger:
#A63D40

Use icons + text.

Do not use excessive colors.

============================================================
58. FORM DESIGN
============================================================

Always place labels ABOVE fields.

Bad:

[ Name................ ]

Good:

Item name

[ Chicken Breast ]

Use helper text when useful.

Example:

Keep Around

[ 20 ] kg

Try to keep about this much in stock.

============================================================
59. CONFIRMATIONS
============================================================

Do not ask confirmation for harmless navigation.

Do ask for:

stock correction

waste

transfer completion

count approval

reversal

large bulk import

archive

Use clear consequence text.

============================================================
60. NOTIFICATIONS / TOASTS
============================================================

Good:

Delivery added.

Stock updated to 68 kg.

Bad:

Operation successful.

Use human language.

============================================================
61. ACCESSIBILITY
============================================================

Requirements:

44px touch targets

keyboard accessible

visible focus

proper labels

screen reader support

icon + text

never color only

numeric input semantics

modal focus trapping

escape closes dialogs where safe

mobile screen reader testing

============================================================
62. LOCALIZATION READINESS
============================================================

Do not hard-code UI strings throughout components.

Keep copy ready for localization.

Future Zentro may support Nepali.

Use simple English that is easy to translate.

Avoid slang and jargon.

============================================================
63. OFFLINE / FAILURE STATES
============================================================

Do not fake successful stock mutations.

If request fails:

Delivery was not added.

Your stock has not changed.

[ Try Again ]

If count autosave fails:

Not saved.

Keep value locally and retry safely if architecture supports it.

Idempotency must prevent duplicates.

============================================================
64. LOADING STATES
============================================================

Use lightweight skeletons.

Do not block whole Inventory unnecessarily.

Example:

Stock list skeleton

Count line skeleton

Reports skeleton

============================================================
65. EMPTY STATES
============================================================

No items:

No stock items yet.

Add your first item or import inventory.

[ Add Item ]

[ Import Inventory ]


No low stock:

Everything looks good.

No items need attention right now.


No history:

No stock changes yet.

============================================================
66. SEARCH
============================================================

Search stock by:

name

SKU

barcode

category where appropriate

Debounce search.

Do not search only client-side if data is paginated.

============================================================
67. IMPORT PERFORMANCE
============================================================

Do not process huge CSV imports synchronously in a way that times out.

Small imports:
can be synchronous if safe.

Large imports:
use background processing if existing Celery infrastructure is appropriate.

Status:

Uploading

Validating

Ready to Review

Importing

Completed

Failed

Do not notify "completed" before stock mutations finish.

============================================================
68. IMPORT TRANSACTIONS
============================================================

Do not put an enormous multi-thousand-row import inside one fragile transaction if
the existing architecture cannot safely support it.

Process predictably.

Each stock mutation must retain:

atomicity

idempotency

audit history

merchant scope

Provide import result summary.

============================================================
69. EXPORT PERFORMANCE
============================================================

For small reports:
generate immediately.

For very large exports:
consider background generation using existing worker infrastructure.

Do not load millions of movements into browser memory.

============================================================
70. FILE SECURITY
============================================================

Validate uploads.

Allowed CSV:

.csv
text/csv

Allowed PDF:

.pdf
application/pdf

Set reasonable file size limits.

Never execute uploaded content.

Do not trust extension alone.

Store temporarily if needed.

Delete temporary import files according to retention policy.

Tenant-scope import sessions.

============================================================
71. IMPORT RESULT
============================================================

After import:

Inventory Import Complete

76 items imported

4 skipped

2 failed

Opening Stock Added:
42 items

No Existing Stock Was Overwritten


[ View Stock ]

[ Download Result CSV ]

============================================================
72. EXPORT FILE NAMES
============================================================

Use meaningful names.

Examples:

silver-fir-current-stock-2026-09-30.csv

silver-fir-inventory-report-2026-09-30.pdf

silver-fir-waste-report-2026-09.csv

Do not expose internal IDs unnecessarily.

============================================================
73. KEEP EXISTING STOCK RULES
============================================================

Do not alter business rules unintentionally.

Preserve:

Receiving changes stock when saved.

PO creation does not change stock.

PO receiving changes actual received stock.

Transfers move stock according to existing completion rules.

Waste changes stock immediately.

Adjustments use authoritative service.

Counts reconcile only according to existing approval workflow.

Reversals never delete history.

============================================================
74. DO NOT OVERENGINEER
============================================================

Do NOT introduce:

microservices

new database

separate inventory backend

new state library

generic workflow engine

new permission framework

new audit system

unless absolutely necessary.

Use existing:

Django

DRF

PostgreSQL

React

React Query

InventoryMovementService

existing serializers/services

existing Zentro design system.

============================================================
75. COMPONENT ARCHITECTURE
============================================================

Audit existing inventory components and reuse them.

Potential structure:

InventoryHome

StockList

StockCard

StockStatus

StockItemDetail

AddStockItem

InventoryActionCenter

AddDeliveryForm

MoveStockForm

WasteForm

FixStockForm

CountStart

CountSession

CountItemRow

CountReview

SupplierList

InventoryReports

StockHistory

InventoryImportExport

CsvImportWizard

PdfImportWizard

ImportReviewTable

ExportDialog

Do not create duplicate mobile/desktop implementations unless needed.

============================================================
76. API DESIGN
============================================================

Reuse existing inventory APIs where possible.

Potential NEW endpoints only where necessary:

GET
/inventory/import/template/

POST
/inventory/import/csv/validate/

POST
/inventory/import/csv/commit/

POST
/inventory/import/pdf/parse/

POST
/inventory/import/pdf/commit/

GET
/inventory/exports/stock.csv

GET
/inventory/exports/stock.pdf

GET
/inventory/exports/report.csv

GET
/inventory/exports/report.pdf

Exact paths should follow current API conventions.

Do not create duplicate item/stock APIs.

============================================================
77. IMPORT SESSION
============================================================

If a persistent import object is needed, keep it simple.

InventoryImportSession

merchant

user

type

file_name

status

import_mode

created_at

completed_at

summary

Do not store unnecessary raw data forever.

Temporary parsed rows may live in structured JSON or supporting rows depending size.

Choose based on existing project conventions.

============================================================
78. EXPORT SOURCE OF TRUTH
============================================================

CSV/PDF exports must read from authoritative backend data.

Do not export from what happens to be visible in the React table.

Filters selected in UI can be passed to server.

Server generates file.

============================================================
79. CSV FORMAT
============================================================

Use UTF-8.

Stable headers.

Decimal values serialized predictably.

Dates:

YYYY-MM-DD

Date/time:

ISO where appropriate.

Do not export localized formatted numbers like:

1,200.50

if it will make reimport ambiguous.

Use raw machine-friendly values in CSV.

PDF may use human-friendly formatting.

============================================================
80. TESTS — CORE SAFETY
============================================================

Existing inventory tests must continue passing.

Add tests proving imports never directly edit InventoryBalance.

All quantity changes must create the appropriate InventoryMovement.

============================================================
81. TESTS — CSV IMPORT
============================================================

Test:

valid file

missing required column

unknown unit

wrong unit type

unknown location

duplicate SKU

duplicate barcode

negative opening qty

invalid cost

new item opening stock

existing item metadata update

existing item quantity does not directly overwrite balance

stock count import creates draft count

cross-merchant references rejected

duplicate upload/idempotency

large file behavior

============================================================
82. TESTS — PDF IMPORT
============================================================

Test:

valid extracted data

uncertain fields require confirmation

no automatic stock write

new item opening balance after confirmation

existing stock becomes StockCount draft

failed parser

wrong file type

oversized file

tenant isolation

============================================================
83. TESTS — EXPORT
============================================================

Test:

stock CSV

stock PDF

filtered exports

cost field hidden without permission

cost included with permission

tenant scope

empty inventory

large inventory

Unicode names

decimal quantities

============================================================
84. TESTS — PERMISSIONS
============================================================

Test:

staff cannot manage settings

staff cannot see costs

staff cannot fix stock if not allowed

manager permissions

owner permissions

cashier restrictions

backend endpoints reject unauthorized actions

not only frontend hiding

============================================================
85. TEST — CROSS-MERCHANT DATA
============================================================

Merchant A must never receive:

Merchant B stock

Merchant B costs

Merchant B suppliers

Merchant B counts

Merchant B import records

Merchant B exports

Merchant B audit data

Add explicit regression tests.

============================================================
86. TEST — PAGINATION
============================================================

Create >100 stock items.

Verify:

page 1 only returns requested rows

page 2 returns next rows

search preserves pagination

filters preserve pagination

total count correct

============================================================
87. TEST — STOCK COUNT IMPORT
============================================================

Book:
70 kg

Imported physical count:
43 kg

After APPROVAL:

movement:
-27 kg

final:
43 kg

NOT:
16 kg

Never classify -27 as waste.

============================================================
88. TEST — REVERSAL
============================================================

Import opening balance:

+50

Undo:

create reversal:
-50

Original remains.

Do not delete original movement.

============================================================
89. FINAL USER EXPERIENCE TEST
============================================================

Give the interface to someone unfamiliar with inventory terminology.

They should be able to answer:

How much milk do we have?

How do I add today's delivery?

How do I record broken bottles?

How do I count the kitchen?

How do I move rice to another storage room?

Where do I download the inventory?

How do I import a spreadsheet?

without learning database terminology.

============================================================
90. IMPLEMENTATION ORDER
============================================================

PHASE 1

Audit current frontend/backend.

PHASE 2

Fix permission enforcement.

PHASE 3

Fix cross-merchant cost leak.

PHASE 4

Fix stock-list pagination.

PHASE 5

Simplify navigation and terminology.

PHASE 6

Redesign Overview + Stock.

PHASE 7

Redesign Count Stock.

PHASE 8

Redesign Add Delivery / Move / Waste / Fix.

PHASE 9

Simplify Suppliers / Reports / History.

PHASE 10

CSV template download.

PHASE 11

CSV export.

PHASE 12

CSV import + preview.

PHASE 13

PDF exports.

PHASE 14

PDF import + safe review.

PHASE 15

Mobile/accessibility QA.

PHASE 16

Full regression testing.

============================================================
91. REQUIRED VERIFICATION
============================================================

Backend:

python manage.py check

python manage.py makemigrations --check

inventory tests

POS/order inventory integration tests

permission tests

import/export tests

full relevant backend suite

Frontend:

npx tsc --noEmit

frontend tests

npm run build

Do not claim success if important tests fail.

Document pre-existing failures separately.

============================================================
92. FINAL REPORT
============================================================

Return a concise implementation report:

1. Existing components reused

2. Inventory navigation changes

3. Terminology changes

4. Stock page redesign

5. Count Stock redesign

6. Add Delivery redesign

7. Move/Waste/Fix redesign

8. Permission fixes

9. Pagination fix

10. Tenant-data leak fix

11. CSV template

12. CSV import

13. CSV export

14. PDF import

15. PDF export

16. Database/migration changes

17. Files changed

18. Tests added

19. Backend result

20. Frontend result

21. Build result

22. Remaining limitations

============================================================
NON-NEGOTIABLE RULES
============================================================

1. Do not rebuild the inventory backend unnecessarily.

2. InventoryBalance must never become directly editable.

3. InventoryMovement remains permanent history.

4. Stock mutations continue through InventoryMovementService.

5. CSV import must not directly overwrite balances.

6. PDF import must never directly update stock after AI/document extraction.

7. Imported physical quantities should use the StockCount workflow.

8. New-item opening stock should use opening_balance.

9. Waste remains explicit.

10. Count variance is not waste.

11. Corrections use reversals/adjustments, not history deletion.

12. Cross-tenant safety is mandatory.

13. Backend permissions are authoritative.

14. Cost visibility follows permissions in UI AND exports.

15. Normal staff should not see unnecessary accounting terminology.

16. Use plain language.

17. Keep primary forms short.

18. Advanced fields stay available but hidden by default.

19. Inventory should be mobile-friendly.

20. CSV is the machine-friendly import/export format.

21. PDF is primarily a human report format.

22. PDF import always requires review.

23. Do not overengineer.

24. Keep the system ready for hundreds/thousands of inventory items.

25. A lightly trained employee should understand the main workflows without needing
to understand how the inventory database works.

============================================================
FINAL PRODUCT TARGET
============================================================

The normal employee should experience Zentro Inventory like this:

Stock arrived
→ Add Delivery

Need to know what is left
→ Stock

Doing physical inventory
→ Count Stock

Moving something
→ Move Stock

Something spoiled/broke
→ Record Waste

Number is wrong
→ Manager → Fix Stock

Need spreadsheet
→ Export CSV

Need printed/shared report
→ Download PDF

Moving data into Zentro
→ Import CSV

Only have an old PDF stock sheet
→ Import PDF
→ Review
→ Confirm

The frontend should be SIMPLE.

The backend should remain STRICT.

The inventory ledger should remain TRUSTWORTHY.

The import process should remain SAFE.

The reports should remain ACCURATE.

The system should feel easy enough for a small café,
but remain powerful enough for multi-location restaurants and larger merchants.
Also i want to have a edit and delete button for all if incase staff added duplicate or wrong product they can edit or delete it.
