# Orders & Fulfillment — Zentro (domain: orders)

> Evidence: `orders/views.py` (`update_order_status`, guest create, `_award_loyalty`,
> punch-card redemption order), `loyalty/views.py` (reward redeem, punch confirm),
> `pos/views.py` (create_pos_order, split, refund), `merchants` MenuItem snapshots.
> Source of truth: `docs/architecture/database.md` + `backend.md`.

## Placement → award path (one arrow per verified call site)

```mermaid
sequenceDiagram
    participant DT as Dining-table screen
    participant API as /api/orders/... (views)
    participant ORM as orders app
    participant PG as PostgreSQL
    participant LOY as loyalty app
    participant NW as notifications app
    participant WS as Channels

    DT->>API: place order (guest / POS / customer)
    API->>ORM: create Order (+ items snapshot) source=table_qr|pos|mobile
    ORM->>PG: INSERT order rows
    ORM->>LOY: service award (points / punch / streak)
    ORM->>NW: send_notification (order events)
    ORM->>WS: group_send merchant_{mid}_preparation_* / user_{customer}
```

## Status machine (verified against orders `OrderStatus`)

```mermaid
stateDiagram-v2
    [*] --> pending
    pending --> confirmed: merchant confirms
    confirmed --> preparing: prep begins
    preparing --> ready: prep complete
    ready --> completed: served / paid
    pending --> cancelled: void (customer/merchant)
    confirmed --> cancelled: refund
    completed --> [*]
```

## Loyalty award coupling (the risky, destined-rework edge)

Loyalty awarding **lives inside order-confirm**, not in the loyalty engine:
`orders/views.py:_award_loyalty(profile, order, ...)` is called from `update_order_status`
(pending→confirmed), and `pos/views.py` re-imports `_award_loyalty` for the POS confirm
path. `loyalty/views.py` uses `Order(order_type=...)` for punch/reward redemptions.

```mermaid
flowchart TB
    CONFIRM[order confirm] --> AWARD[_award_loyalty<br/>orders/views]
    AWARD --> PTS[wallet points ledger]
    AWARD --> PUNCH[punch card add]
    AWARD --> STREAK[streak update]
    POS[POS payment confirm] -.reuses._award_loyalty.-> AWARD
    REDEEM[loyalty redeem confirm] --> ORD2[creates Order reward_redemption]
```

> Coupling flag: loyalty awarding + mission progress + punch are triggered from
> **orders** on confirm. Loyalty engine then *reads* those orders to build missions,
> punch cards, leaderboard, streak. This is a control-flow inversion — see `health.md`
> dependency risk #ORD-LOY.
