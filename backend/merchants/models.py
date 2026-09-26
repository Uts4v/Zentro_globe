# merchants/models.py
import secrets
from django.db import models
from django.conf import settings


def _generate_table_token():
    return f"TBL-{secrets.token_urlsafe(8)}".upper()


def _generate_pdf_menu_token():
    return f"MENU-{secrets.token_urlsafe(8)}".upper()


class MerchantProfile(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="merchant_profile",
    )

    # Renamed: store_name → business_name, store_slug → slug
    # db_column keeps the existing DB column so no data is lost
    business_name = models.CharField(max_length=255, db_column="store_name")
    slug = models.SlugField(unique=True, db_column="store_slug")

    business_type = models.CharField(max_length=100, blank=True)
    address = models.TextField(blank=True)
    phone = models.CharField(max_length=20, blank=True)
    logo_url = models.URLField(blank=True)
    banner_url = models.URLField(blank=True)
    description = models.TextField(blank=True)
    is_approved = models.BooleanField(default=False)
    is_open = models.BooleanField(default=True)

    # New fields
    onboarding_complete = models.BooleanField(default=False)
    latitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    longitude = models.DecimalField(
        max_digits=9, decimal_places=6, null=True, blank=True
    )
    qr_code = models.TextField(blank=True)  # stores the public URL or SVG string

    store_theme_color = models.CharField(max_length=7, blank=True, default="", help_text="Hex color for customer store view, e.g. #1e293b")
    card_text_color = models.CharField(max_length=7, blank=True, default="", help_text="Hex color for loyalty card text, e.g. #ffffff")
    card_background_image = models.URLField(blank=True, default="", help_text="Background image URL for the customer loyalty card")

    # Table ordering settings
    table_ordering_enabled = models.BooleanField(
        default=False,
        help_text="Enable table-based ordering for dine-in customers",
    )
    allow_pickup = models.BooleanField(default=True)
    allow_delivery = models.BooleanField(default=False)
    allow_dine_in = models.BooleanField(default=False)
    allow_point_transfer = models.BooleanField(
        default=False,
        help_text="Allow customers to transfer points to other members of this business",
    )

    # ── POS feature flags ─────────────────────────────────────────────────────
    pos_enabled = models.BooleanField(
        default=False,
        help_text="Enable the Point of Sale system for this merchant",
    )
    offline_pos_enabled = models.BooleanField(
        default=False,
        help_text="Allow POS to queue orders offline and sync later",
    )
    credit_accounts_enabled = models.BooleanField(
        default=False,
        help_text="Allow customers to purchase on credit",
    )
    discounts_enabled = models.BooleanField(
        default=False,
        help_text="Allow staff to apply discounts at POS",
    )
    shift_management_enabled = models.BooleanField(
        default=False,
        help_text="Require cash shifts for POS operations",
    )
    receipt_printing_enabled = models.BooleanField(
        default=False,
        help_text="Enable receipt printing from POS",
    )

    # POS settings
    max_worker_discount_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text="Maximum discount percentage a worker can apply without manager approval",
    )
    manager_approval_threshold = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Discount amount above which manager approval is required",
    )
    offline_discounts_allowed = models.BooleanField(
        default=False,
        help_text="Allow applying discounts while offline",
    )
    offline_credit_allowed = models.BooleanField(
        default=False,
        help_text="Allow credit sales while offline",
    )
    payment_qr_url = models.URLField(
        blank=True, default="",
        help_text="Merchant's own payment QR image, shown at POS for QR payments",
    )
    debit_accounts_enabled = models.BooleanField(
        default=False,
        help_text="Enable prepaid debit accounts (customer wallet / stored value)",
    )
    tax_enabled = models.BooleanField(
        default=True,
        help_text="Master toggle: enable/disable tax calculations system-wide",
    )
    tax_rate_percent = models.DecimalField(
        max_digits=5, decimal_places=2, default=6.00,
        help_text="Legacy VAT rate. Kept for backward compat; prefer tax_components.",
    )

    # ── Currency & multi-tax ──────────────────────────────────────────────────
    currency_code = models.CharField(
        max_length=3, default="NPR",
        help_text="ISO 4217 currency code (e.g. NPR, INR, USD, THB)",
    )
    currency_symbol = models.CharField(
        max_length=5, default="Rs",
        help_text="Display currency symbol (e.g. Rs, ₹, $, ฿)",
    )
    tax_components = models.JSONField(
        default=list, blank=True,
        help_text=(
            'List of tax components, e.g. '
            '[{"name":"VAT","rate":13}] or [{"name":"CGST","rate":9},{"name":"SGST","rate":9}]. '
            "Falls back to tax_rate_percent when empty."
        ),
    )

    # ── Preparation routing ────────────────────────────────────────────────────
    preparation_routing_enabled = models.BooleanField(
        default=False,
        help_text="Route order items to separate preparation areas (bar, kitchen, etc.)",
    )

    # ── AI feature flags ───────────────────────────────────────────────────────
    ai_enabled = models.BooleanField(
        default=False,
        help_text="Enable AI features for this merchant (assistant chat, insights)",
    )
    ai_insights_enabled = models.BooleanField(
        default=False,
        help_text="Enable daily AI-generated business insights",
    )
    ai_insights_time = models.TimeField(
        null=True, blank=True,
        help_text="Preferred local time for daily insight generation",
    )
    timezone = models.CharField(
        max_length=50, default="Asia/Kathmandu",
        help_text="Merchant's local timezone for scheduling",
    )

    # ── PDF Menu ────────────────────────────────────────────────────────────────
    pdf_menu_url = models.URLField(
        blank=True,
        default="",
        help_text="URL of the uploaded PDF menu file",
    )
    pdf_menu_token = models.CharField(
        max_length=64,
        blank=True,
        editable=False,
        help_text="Public token for accessing the PDF menu via QR",
    )
    pdf_menu_page_count = models.IntegerField(
        default=0,
        help_text="Number of pages rendered as images from the uploaded PDF menu",
    )

    # ── Payment recording settings ──────────────────────────────────────────────
    # Zentro *records* how a customer paid; it does not process the card or
    # wallet transaction. Every method (Cash, Card, QR, Bank Transfer, Mobile
    # Wallet, Other) is confirmed manually by staff with no external terminal.
    # `accepted_payment_methods` is an ordered list of PosPayment.METHOD_*
    # values; `payment_methods_configured` distinguishes "merchant never
    # touched this setting" (all methods offered) from an explicit selection.
    payment_methods_configured = models.BooleanField(
        default=False,
        help_text="True once the merchant has saved an explicit accepted-methods list",
    )
    accepted_payment_methods = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "Ordered list of payment method keys this merchant accepts, e.g. "
            '["cash", "card", "bank_qr", "other"]. Empty means "not configured".'
        ),
    )
    payment_method_labels = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            'Optional per-method display overrides, e.g. '
            '{"bank_qr": "Fonepay QR", "mobile_wallet": "eSewa"}.'
        ),
    )

    # Merchant-specific payment QR shown at POS / on the customer menu when the
    # QR method is selected. Single QR per merchant, image-only, no HTML.
    payment_qr_enabled = models.BooleanField(
        default=False,
        help_text="Show this merchant's payment QR when a QR payment is selected",
    )
    payment_qr_url = models.URLField(
        blank=True,
        default="",
        help_text="Merchant's own payment QR image, shown at POS for QR payments",
    )
    payment_qr_name = models.CharField(
        max_length=80,
        blank=True,
        default="",
        help_text='Display name for the QR, e.g. "Fonepay QR" or "eSewa"',
    )
    payment_qr_instructions = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text='Short customer-facing hint, e.g. "Scan the QR and show confirmation to staff."',
    )
    payment_qr_account_name = models.CharField(
        max_length=120,
        blank=True,
        default="",
        help_text="Account or display name printed under the QR",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "merchant_profiles"

    def save(self, *args, **kwargs):
        if not self.pdf_menu_token:
            self.pdf_menu_token = self._unique_pdf_menu_token()
        super().save(*args, **kwargs)

    def _unique_pdf_menu_token(self):
        token = _generate_pdf_menu_token()
        while MerchantProfile.objects.filter(pdf_menu_token=token).exclude(pk=self.pk).exists():
            token = _generate_pdf_menu_token()
        return token

    def regenerate_pdf_menu_token(self):
        self.pdf_menu_token = self._unique_pdf_menu_token()
        self.save(update_fields=["pdf_menu_token", "updated_at"])

    # ── Payment method helpers ───────────────────────────────────────────────
    def accepted_payment_method_keys(self):
        """
        Return the ordered list of payment method keys this merchant accepts.

        Falls back to every method Zentro can record when the merchant has never
        saved the setting, so existing merchants keep working untouched.
        `split` is never offered: it is resolved automatically when a tender is
        split across methods rather than chosen by staff.
        """
        from pos.models import PosPayment

        selectable = [k for k, _ in PosPayment.METHOD_CHOICES if k != PosPayment.METHOD_SPLIT]
        if not self.payment_methods_configured:
            return selectable

        stored = self.accepted_payment_methods
        if not isinstance(stored, (list, tuple)):
            return selectable
        chosen = [k for k in stored if k in selectable]
        # Preserve METHOD_CHOICES order so the UI never reorders itself based on
        # however the merchant ticked the boxes.
        return [k for k in selectable if k in set(chosen)]

    def accepts_payment_method(self, method):
        return method in self.accepted_payment_method_keys()

    def payment_method_label(self, method):
        """Display label for `method`, honouring any merchant override."""
        from pos.models import PosPayment

        overrides = self.payment_method_labels if isinstance(self.payment_method_labels, dict) else {}
        custom = (overrides.get(method) or "").strip()
        if custom:
            return custom
        return dict(PosPayment.METHOD_CHOICES).get(method, method)

    def can_accept_qr_payment(self):
        """QR is only offered when enabled *and* an actual QR image is set."""
        return bool(self.payment_qr_enabled and self.payment_qr_url)

    def __str__(self):
        return self.business_name


class MenuCategory(models.Model):
    """Structured category for a merchant's menu (replaces free-text category)."""

    merchant = models.ForeignKey(
        MerchantProfile,
        on_delete=models.CASCADE,
        related_name="menu_categories",
    )
    name = models.CharField(max_length=100)
    emoji = models.CharField(max_length=10, blank=True, default="")
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "menu_categories"
        ordering = ["display_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "name"],
                name="unique_category_name_per_merchant",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"


class MenuOptionGroup(models.Model):
    """
    A selectable group attached to a menu item.

    Two kinds:
      - variant:  mutually-exclusive choices that change the base product
                  (Size, Temperature, Serving). Each option carries an
                  absolute `price`.
      - modifier: optional ad-ons you can pick multiple of (Extra cheese,
                  no onion). Each option carries a `price_delta`.
    """

    KIND_VARIANT = "variant"
    KIND_MODIFIER = "modifier"
    KIND_CHOICES = [
        (KIND_VARIANT, "Variant"),
        (KIND_MODIFIER, "Modifier"),
    ]

    merchant = models.ForeignKey(
        MerchantProfile,
        on_delete=models.CASCADE,
        related_name="option_groups",
    )
    menu_item = models.ForeignKey(
        "MenuItem",
        on_delete=models.CASCADE,
        related_name="option_groups",
    )
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_MODIFIER)
    required = models.BooleanField(default=False)
    min_select = models.PositiveIntegerField(default=0)
    max_select = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "menu_option_groups"
        ordering = ["display_order", "id"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(min_select__gte=0) & models.Q(max_select__gte=1),
                name="menu_option_group_selection_bounds",
            ),
            # A required group can never have min_select == 0: "required"
            # must mean the customer cannot skip it.
            models.CheckConstraint(
                condition=~models.Q(required=True, min_select=0),
                name="menu_option_group_required_has_min",
            ),
            # A group that allows picking at least two options cannot be a
            # single-select variant group (variant groups are max_select=1).
            models.CheckConstraint(
                condition=~models.Q(kind="variant", max_select__gt=1),
                name="menu_option_group_variant_single_select",
            ),
            # Selection counts must never require more picks than the group
            # permits, otherwise no valid selection could ever exist.
            models.CheckConstraint(
                condition=models.Q(min_select__lte=models.F("max_select")),
                name="menu_option_group_min_le_max",
            ),
        ]

    def save(self, *args, **kwargs):
        """
        Normalise the selection bounds so callers never have to remember them.

        The CheckConstraints above are a backstop for raw SQL, but the merchant
        product editor and the public API both legitimately create groups with
        just `required=True` and nothing else, so the invariant is enforced here
        rather than pushed onto every call site:

          * "required" means at least one pick, so min_select floors at 1.
          * min_select can never exceed max_select, or the group could never
            be satisfied and the product would become unorderable.
          * variant groups are single-select by definition.
        """
        if self.required and (self.min_select or 0) < 1:
            self.min_select = 1

        if self.max_select is None or self.max_select < 1:
            self.max_select = 1

        if self.kind == self.KIND_VARIANT and self.max_select > 1:
            self.max_select = 1

        if (self.min_select or 0) > self.max_select:
            self.min_select = self.max_select

        super().save(*args, **kwargs)

    def __str__(self):
        kind_label = "Variant" if self.kind == self.KIND_VARIANT else "Modifier"
        return f"{self.name} ({kind_label}) — {self.menu_item.name}"


class MenuOption(models.Model):
    """A single selectable option inside a MenuOptionGroup."""

    merchant = models.ForeignKey(
        MerchantProfile,
        on_delete=models.CASCADE,
        related_name="menu_options",
    )
    group = models.ForeignKey(
        MenuOptionGroup,
        on_delete=models.CASCADE,
        related_name="options",
    )
    name = models.CharField(max_length=100)
    sku = models.CharField(max_length=100, blank=True, default="")
    price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Absolute price for variant options. Falls back to the item price when null.",
    )
    price_delta = models.DecimalField(
        max_digits=10, decimal_places=2, default=0,
        help_text="Price add-on for modifier options (e.g. +50 for extra cheese).",
    )
    is_default = models.BooleanField(default=False)
    is_available = models.BooleanField(default=True)
    display_order = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "menu_options"
        ordering = ["display_order", "id"]
        constraints = [
            # Modifier add-ons can only ever *raise* the price, never lower it.
            models.CheckConstraint(
                condition=models.Q(price_delta__gte=0),
                name="menu_option_price_delta_non_negative",
            ),
            # A variant price, when set, must not be negative.
            models.CheckConstraint(
                condition=models.Q(price__isnull=True) | models.Q(price__gte=0),
                name="menu_option_price_non_negative",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.group.name})"


class MenuItem(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_DRAFT = "draft"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_DRAFT, "Draft"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    DISCOUNT_NONE = "none"
    DISCOUNT_PERCENTAGE = "percentage"
    DISCOUNT_FIXED = "fixed"
    DISCOUNT_TYPE_CHOICES = [
        (DISCOUNT_NONE, "No discount"),
        (DISCOUNT_PERCENTAGE, "Percentage"),
        (DISCOUNT_FIXED, "Fixed amount"),
    ]
    DISCOUNT_SOURCE_MANUAL = "manual"
    DISCOUNT_SOURCE_SPECIAL = "special"
    DISCOUNT_SOURCE_CHOICES = [
        (DISCOUNT_SOURCE_MANUAL, "Set by merchant"),
        (DISCOUNT_SOURCE_SPECIAL, "Synced from Today's Special"),
    ]

    merchant = models.ForeignKey(
        MerchantProfile,
        on_delete=models.CASCADE,
        related_name="menu_items",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    short_description = models.CharField(
        max_length=200, blank=True,
        help_text="One-line subtitle shown under the product tile name.",
    )
    price = models.DecimalField(max_digits=10, decimal_places=2)
    discount_type = models.CharField(
        max_length=20, choices=DISCOUNT_TYPE_CHOICES, default=DISCOUNT_NONE,
        help_text="Item-level discount applied to the base price (variants keep their own price).",
    )
    discount_value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Percentage (0-100) or fixed amount depending on discount_type.",
    )
    discount_source = models.CharField(
        max_length=20, choices=DISCOUNT_SOURCE_CHOICES, default=DISCOUNT_SOURCE_MANUAL,
        help_text="Whether the discount was set directly or synced from a Today's Special.",
    )
    image_url = models.URLField(blank=True)
    category = models.CharField(max_length=100, blank=True)
    category_ref = models.ForeignKey(
        MenuCategory,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="menu_items",
    )
    is_available = models.BooleanField(default=True)
    is_featured = models.BooleanField(default=False)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_ACTIVE,
        help_text="Lifecycle status; archived items are hidden everywhere.",
    )
    loyalty_reward = models.BooleanField(default=True)
    points_per_item = models.IntegerField(default=1)
    emoji = models.CharField(max_length=10, default="☕")
    dietary_tags = models.JSONField(
        default=list, blank=True,
        help_text='e.g. ["vegetarian", "vegan", "spicy", "gluten-free", "bestseller"]',
    )
    allergens = models.JSONField(
        default=list, blank=True,
        help_text='e.g. ["dairy", "nuts", "shellfish"]',
    )
    display_order = models.PositiveIntegerField(default=0)

    # ── Preparation routing (optional) ─────────────────────────────────────────
    preparation_area = models.ForeignKey(
        "orders.PreparationArea",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="menu_items",
        help_text="Specific preparation area for this item (overrides category default)",
    )
    requires_preparation = models.BooleanField(
        default=True,
        help_text="Whether this item requires preparation (set False for packaged goods)",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "menu_items"
        ordering = ["category", "name"]

    def __str__(self):
        # updated to use new field name
        return f"{self.name} - {self.merchant.business_name}"


class MerchantTable(models.Model):
    merchant = models.ForeignKey(
        MerchantProfile,
        on_delete=models.CASCADE,
        related_name="tables",
    )
    name = models.CharField(
        max_length=100,
        help_text="User-facing label, e.g. 'Table 4', 'Patio A', 'VIP Lounge'",
    )
    table_number = models.PositiveIntegerField(
        help_text="Numeric ordering label for sorting",
    )
    public_token = models.CharField(
        max_length=64,
        unique=True,
        editable=False,
        default=_generate_table_token,
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "merchant_tables"
        constraints = [
            models.UniqueConstraint(
                fields=["merchant", "table_number"],
                name="unique_table_number_per_merchant",
            ),
        ]
        ordering = ["table_number"]

    def __str__(self):
        return f"{self.name} ({self.merchant.business_name})"

    def regenerate_token(self):
        self.public_token = _generate_table_token()
        self.save(update_fields=["public_token", "updated_at"])