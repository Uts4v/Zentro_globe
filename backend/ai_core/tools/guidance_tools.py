from .registry import tool_registry

FEATURE_GUIDES = {

    "overview": """Step 1: Go to Overview from the sidebar. This is your dashboard home.

Step 2: View key business metrics at a glance: today's total revenue, number of orders, and active loyalty members.

Step 3: Check the order trend chart to see order volume over time.

Step 4: Review your top-selling products to understand which items perform best.""",

    "orders": """Step 1: Go to Orders from the sidebar.

Step 2: All orders are displayed in a list. Use the status tabs at the top to filter: Pending, Confirmed, Preparing, Ready, Completed, or Cancelled.

Step 3: Click on any order to view its full details including items ordered, customer name, order source, and any notes.

Step 4: To update an order's status, click the status buttons — move it from Pending to Confirmed to Preparing to Ready.

Step 5: To cancel an order, open it and click Cancel. You must select a cancellation reason: Customer Request, Out of Stock, Store Closing, or Other, and specify who cancelled (Customer or Merchant).

Orders can come from multiple sources: customer mobile app, table QR code scans, merchant dashboard, or POS terminal (online or offline).""",

    "menu": """Step 1: Go to Menu from the sidebar.

Step 2: Click "Add Item" to create a new menu item.

Step 3: Fill in the item name, price (in NPR), description, and category (free text like "Beverages" or "Main Course").

Step 4: Upload an image, set an emoji icon, and optionally assign a preparation area if preparation routing is enabled.

Step 5: Toggle the availability switch to show or hide the item from customers. Set "Requires Preparation" on/off.

Step 6: Click Save to add the item. To edit, click on the item and update any field.

Step 7: To feature an item as a daily deal, go to Today's Special in the sidebar instead and create a special offer there.""",

    "tables": """Step 1: Go to Tables & QR from the sidebar.

Step 2: Click "Add Table" and enter a table name (e.g., "Table 5") and a table number.

Step 3: Once created, each table is automatically assigned a unique QR code with a public token (prefixed with TBL-).

Step 4: Download the QR code image and print it. Place the printed QR code on the corresponding table.

Step 5: Customers scan the QR code with their phone camera — they can browse your menu and place orders directly without logging in.

Step 6: Table orders appear in your Orders page with the table name attached. The order source will show as "table_qr".

Step 7: You can edit, deactivate, or regenerate the QR token for any table from the Tables & QR page.

Note: Table ordering must be enabled in Store settings for QR ordering to work.""",

    "loyalty": """Step 1: Go to Loyalty from the sidebar.

Step 2: Set your points rule in Loyalty Settings — define how many points customers earn per NPR spent (default: 1 point per NPR 1). You can also set a streak multiplier, welcome bonus, and birthday bonus.

Step 3: Create rewards in the Rewards section. Click "Add Reward" and set a name, description, emoji, points cost, and stock quantity. Rewards can optionally be linked to a menu item.

Step 4: Set up punch cards. Choose the mode: "Per Order" (one stamp per order) or "Per Streak" (one stamp per visit streak day). Set the number of stamps required and the reward text.

Step 5: Create missions to engage customers. Mission types include: order count, spend amount, visit streak, purchase, visit, referral, and special. Set a target count, reward points, and restart interval (never, daily, weekly, or monthly).

Step 6: Customers earn points automatically on every paid order. Points are tracked per customer per merchant in their wallet. Tier levels (bronze, silver, gold, platinum) are based on lifetime points.

Step 7: Customers redeem rewards through the customer mobile app. Redemptions have a status: pending, confirmed, expired, or cancelled, and each gets a unique redemption code.""",

    "today_special": """Step 1: Go to Today's Special from the sidebar.

Step 2: Click to create a new special offer. Provide a title, description, and optional image.

Step 3: Link the special to either a menu item or a reward — this determines what the customer gets.

Step 4: Toggle the special as active or inactive. Only active specials are shown to customers.""",

    "preparation": """Step 1: Go to Preparation from the sidebar. Note: preparation routing must be enabled in Store settings first.

Step 2: Click "Add Area" to create preparation zones. Common areas: Kitchen, Bar, Bakery, Grill. Each area can have a display order and color.

Step 3: Assign each menu item to a preparation area from the Menu page (set the "Preparation Area" field on each item).

Step 4: Staff assigned to each area will see incoming orders for their items in real-time on the POS Preparation screen.

Step 5: Staff update the preparation status of each item as they work: Pending → Preparing → Ready. Items can also be marked as Cancelled.""",

    "analytics": """Step 1: Go to Analytics from the sidebar.

Step 2: Review your sales overview showing total revenue for the selected period, total number of orders, and average order value.

Step 3: View order trends through daily and weekly charts to spot patterns.

Step 4: Check your top-selling products to understand what items perform best.

Step 5: Review customer insights including new versus returning customer data.

Step 6: Use the date filters at the top to narrow your analysis to a specific time period.""",

    "ai_assistant": """Step 1: Go to AI Assistant from the sidebar.

Step 2: Use the chat interface to ask questions about how to use Zentro features.

Step 3: If AI insights are enabled for your store, daily business insights will be generated automatically at your preferred time.

Step 4: AI Assistant can also generate reports and provide analytics summaries on request.""",

    "store": """Step 1: Go to Store from the sidebar.

Step 2: Update your business profile: business name, description, business type, address, and public phone number.

Step 3: Toggle your store Open or Closed using the button at the top. When closed, customers cannot place orders.

Step 4: Upload your store banner (recommended 1200x500 px) and logo (square, recommended 200x200 px minimum) in the Images section.

Step 5: Set your store theme color — choose from preset colors (Slate, Emerald, Amber, Rose, Indigo, Teal, Violet, Orange) or pick a custom color. This color appears in the customer app.

Step 6: View and manage your QR Code section. Generate, download, or regenerate your store's QR code. Customers scan this to open your loyalty page. Your store link and slug are also displayed here.

Step 7: Design your membership card in the Membership Card Designer. Customize: card title, subtitle, colors (primary, secondary, accent), text mode (light or dark), background image, background pattern (none, dots, geometric, diamonds), and display options (show lifetime points, show joined date, show QR shortcut). Save or publish the design.

Step 8: Configure your feature flags:
  - Fulfillment: enable/disable Pickup, Delivery, Dine-in, and Table Ordering.
  - POS: enable POS system, offline POS, credit accounts, debit accounts, discounts, shift management, and receipt printing.
  - Preparation routing for kitchen/bar organization.
  - AI features: AI assistant chat and daily AI business insights.

Step 9: Add staff accounts in the Team section. Invite by email (coming from store settings — currently managed through POS Staff page).

Step 10: Click "Save" at the bottom to apply all changes.""",

    "pos": """Step 1: Go to POS Terminal from the sidebar. You need to have POS enabled in Store settings first.

Step 2: Staff must sign in with their PIN at the start of each shift. POS workers have roles: Cashier, Waiter, Manager, or Admin.

Step 3: On the POS Order screen, tap menu item buttons to add them to the current order. Items are organized by category.

Step 4: Before completing the order, set the fulfillment type: Dine-in, Pickup, or Delivery.

Step 5: If discounts are enabled for your store and the worker has permission, tap Discount and select or enter a fixed or percentage discount amount.

Step 6: Choose a payment method to complete the transaction: Cash, Card, Bank QR, Mobile Wallet, Credit, Debit, Split, or Other.

Step 7: If offline POS is enabled, orders queue locally when internet is lost and sync automatically when the connection is restored.

POS sub-pages (from the POS sidebar):
  - Orders: View past order details.
  - Preparation: View and manage preparation area stations.
  - Accounts: Manage credit accounts (credit limit, balance) and debit accounts (prepaid wallets). Process top-ups, repayments, purchases.
  - Cash In/Out: Record cash movements — payouts, pay-ins, and cashdrops.
  - Reports: View reports dashboard and generate end-of-day Z-Reports.
  - Conflicts: Resolve order conflicts that occur during offline sync.
  - Schedule: Manage staff schedules and shift roster.
  - Staff: Add, edit, or deactivate POS workers. Assign roles and set PINs.
  - Settings: Configure POS device and system settings.""",

    "staff": """Step 1: Go to POS Terminal from the sidebar, then click Staff in the POS sidebar.

Step 2: Click "Add Staff" to create a new worker. Enter their display name and assign a role: Cashier (process orders/take payments), Waiter (service staff), Manager (oversee operations), or Admin (full access).

Step 3: Set a 4-digit PIN code for the worker. This PIN is used to sign in at the POS terminal at the start of each shift.

Step 4: Toggle permission flags for each worker:
  - Can Apply Discount — allowed to discount orders.
  - Can Process Refund — allowed to process refunds.
  - Can Close Shift — allowed to close cash shifts.
  - Can View Reports — allowed to view POS reports.

Step 5: After 5 failed PIN attempts, the worker account is locked out for security.

Step 6: You can deactivate workers (set is_active=false) instead of deleting them.""",

    "onboarding": """Step 1: After signing up and verifying your email, you will see the onboarding form.

Step 2: Enter your Business Name (minimum 3 characters).

Step 3: Set your branded URL slug — this becomes your public URL at /m/[slug]. Use lowercase letters, numbers, and hyphens only.

Step 4: Provide your business address (minimum 10 characters for a detailed address) and public phone number.

Step 5: Add a description of your business (optional) — tell customers what makes your place special.

Step 6: Click "Continue to Dashboard" to complete onboarding. Your business profile is saved and you are taken to the merchant dashboard.

Step 7: From there, you can set up your menu, enable features, configure loyalty, and start accepting orders.""",

    "getting_started": """Welcome to Zentro. Here is a tour of your merchant dashboard:

Step 1: Overview — Dashboard showing today's revenue, orders, active members, order trends, and top sellers.

Step 2: Orders — Manage and fulfill incoming orders from all channels.

Step 3: Menu — Build and organize your product catalog with categories, prices, and images.

Step 4: Tables & QR — Set up tables with auto-generated QR codes for dine-in ordering.

Step 5: Loyalty — Configure points, rewards, punch cards, and missions for your customers.

Step 6: Today's Special — Create daily deals and promotional offers.

Step 7: Preparation — Organize kitchen, bar, and bakery stations for order routing.

Step 8: Analytics — View sales reports, trends, and customer insights.

Step 9: AI Assistant — Chat with AI for help and get daily business insights.

Step 10: Store — Manage your business profile, images, theme, QR code, card design, and feature settings.

Step 11: POS Terminal — Full point-of-sale system for in-store order taking and payments.""",

    "about_zentro": """Zentro is a loyalty and business management platform built for cafés, restaurants, and hospitality businesses in Nepal.

Zentro was founded by Utsav Shrestha.
This app was made by Utsav Shrestha.9

Features include: digital menu management, order management across dine-in/pickup/delivery, POS terminal, table QR code ordering, loyalty programs (points, rewards, punch cards, missions), preparation routing, analytics dashboard, AI assistant, staff management, customer mobile app, and offline POS.

Pricing is in NPR. Zentro serves restaurants, cafés, bakeries, bars, and similar businesses across Nepal.""",

    "merchant_setup": """Step 1: Go to /auth/merchant/signup and create your merchant account with email and password.

Step 2: Verify your email through the confirmation link sent to your inbox.

Step 3: Log in for the first time. You will see the onboarding form at /merchant/onboarding.

Step 4: Complete the onboarding form: business name, branded URL slug, address, phone number, and description.

Step 5: After onboarding, set up your menu — go to Menu and add items with categories, prices, and images.

Step 6: Configure your store settings — go to Store to upload your logo and banner, set your theme color, and enable the features you need (POS, table ordering, pickup, delivery, etc.).

Step 7: If using dine-in QR ordering, go to Tables & QR to add tables and print QR codes.

Step 8: Set up your loyalty program — go to Loyalty to configure points rules, create rewards, set up punch cards, and design your membership card.

Step 9: Add staff — go to POS Terminal > Staff to create worker accounts with PINs and permissions.

Step 10: Toggle your store to "Open" in Store settings and start accepting orders.""",

}


def get_merchant_profile(*, merchant, **kwargs):
    from merchants.models import MenuItem, MerchantTable
    menu_count = MenuItem.objects.filter(merchant=merchant).count()
    table_count = MerchantTable.objects.filter(merchant=merchant).count()

    return {
        "business_name": merchant.business_name,
        "business_type": merchant.business_type or "",
        "address": merchant.address or "",
        "phone": merchant.phone or "",
        "is_open": merchant.is_open,
        "onboarding_complete": merchant.onboarding_complete,
        "menu_items_count": menu_count,
        "tables_count": table_count,
        "enabled_features": {
            "pos": merchant.pos_enabled,
            "offline_pos": merchant.offline_pos_enabled,
            "table_ordering": merchant.table_ordering_enabled,
            "pickup": merchant.allow_pickup,
            "delivery": merchant.allow_delivery,
            "dine_in": merchant.allow_dine_in,
            "preparation_routing": merchant.preparation_routing_enabled,
            "credit_accounts": merchant.credit_accounts_enabled,
            "discounts": merchant.discounts_enabled,
            "shift_management": merchant.shift_management_enabled,
            "receipt_printing": merchant.receipt_printing_enabled,
            "ai_assistant": merchant.ai_enabled,
            "point_transfer": merchant.allow_point_transfer,
        },
    }


def get_feature_guide(*, merchant, feature: str = "getting_started", **kwargs):
    feature = feature.lower().strip()
    guide = FEATURE_GUIDES.get(feature)
    if not guide:
        available = ", ".join(sorted(FEATURE_GUIDES.keys()))
        return {
            "error": f"Guide for '{feature}' not found.",
            "available_guides": available,
        }
    return {
        "feature": feature,
        "guide": guide,
    }


def register_guidance_tools():
    tool_registry.register(
        get_merchant_profile,
        name="get_merchant_profile",
        description="Get the merchant's profile info: business name, type, address, phone, is_open status, onboarding status, menu item count, table count, and all enabled feature flags (POS, offline POS, table ordering, pickup, delivery, dine-in, preparation routing, credit accounts, discounts, shift management, receipt printing, AI assistant, point transfer).",
        parameters={
            "type": "object",
            "properties": {},
        },
    )
    tool_registry.register(
        get_feature_guide,
        name="get_feature_guide",
        description="Get a step-by-step guide for a specific Zentro feature. Call this ONLY when the merchant specifically asks about a feature or how to do something. Do NOT call it for greetings. Available guides: overview, menu, orders, tables, loyalty, today_special, preparation, analytics, ai_assistant, store, pos, staff, onboarding, getting_started, about_zentro, merchant_setup.",
        parameters={
            "type": "object",
            "properties": {
                "feature": {
                    "type": "string",
                    "description": "The feature to get a guide for. Options: overview, menu, orders, tables, loyalty, today_special, preparation, analytics, ai_assistant, store, pos, staff, onboarding, getting_started, about_zentro, merchant_setup",
                    "enum": ["overview", "menu", "orders", "tables", "loyalty", "today_special", "preparation", "analytics", "ai_assistant", "store", "pos", "staff", "onboarding", "getting_started", "about_zentro", "merchant_setup"],
                },
            },
            "required": ["feature"],
        },
    )
