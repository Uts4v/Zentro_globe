"""
Zentro Offers — merchant promotions customers discover, claim and redeem.

    PromotionCampaign   the offer and its rules (one benefit, optional condition,
                        product/category/variant targets)
    VoucherClaim        one customer's saved offer, with a unique code + QR token
    VoucherRedemption   permanent proof the offer was used (never deleted)

Money for an order is never computed here: an applied claim becomes an
OrderAdjustment (kind "promotion") and the pricing engine calls back into
offers.engine to recompute its benefit from the order's current lines.
"""

import secrets

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone


def _link_token():
    return secrets.token_urlsafe(12)


class PromotionCampaign(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_PUBLISHED = "published"
    STATUS_PAUSED = "paused"
    STATUS_ENDED = "ended"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"),
        (STATUS_PUBLISHED, "Published"),
        (STATUS_PAUSED, "Paused"),
        (STATUS_ENDED, "Ended"),
        (STATUS_ARCHIVED, "Archived"),
    ]

    VISIBILITY_PUBLIC = "public"
    VISIBILITY_LINK = "link_only"
    VISIBILITY_CHOICES = [(VISIBILITY_PUBLIC, "Public"), (VISIBILITY_LINK, "Private link / QR poster")]

    CHANNEL_ALL = "all"
    CHANNEL_ONLINE = "online"
    CHANNEL_IN_STORE = "in_store"
    CHANNEL_CHOICES = [
        (CHANNEL_ALL, "Online and in store"),
        (CHANNEL_ONLINE, "Online orders only"),
        (CHANNEL_IN_STORE, "In store (POS) only"),
    ]

    merchant = models.ForeignKey(
        "merchants.MerchantProfile", on_delete=models.CASCADE, related_name="promotion_campaigns",
    )
    title = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    terms = models.TextField(blank=True, default="")
    image_url = models.URLField(blank=True, default="")

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=STATUS_DRAFT, db_index=True)
    visibility = models.CharField(max_length=12, choices=VISIBILITY_CHOICES, default=VISIBILITY_PUBLIC)
    channels = models.CharField(max_length=10, choices=CHANNEL_CHOICES, default=CHANNEL_ALL)
    link_token = models.CharField(max_length=32, unique=True, default=_link_token, editable=False)

    starts_at = models.DateTimeField(null=True, blank=True, help_text="Null = as soon as published.")
    ends_at = models.DateTimeField(null=True, blank=True, help_text="Null = no end date.")
    claim_valid_days = models.PositiveIntegerField(
        null=True, blank=True, help_text="How long a claim stays usable after claiming (capped at ends_at).",
    )

    max_claims = models.PositiveIntegerField(null=True, blank=True)
    max_redemptions = models.PositiveIntegerField(null=True, blank=True)
    per_customer_limit = models.PositiveIntegerField(default=1)
    min_order_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    max_discount_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    exclude_discounted_items = models.BooleanField(
        default=True, help_text="Items already on a Today's Special neither qualify nor get discounted.",
    )
    restore_on_cancel = models.BooleanField(
        default=True, help_text="Give the use back if a redeemed order is later cancelled or refunded.",
    )

    version = models.PositiveIntegerField(default=1)
    currency_code = models.CharField(max_length=3, default="NPR")

    # Counters, only ever changed under a row lock on the campaign.
    claims_count = models.PositiveIntegerField(default=0)
    reserved_count = models.PositiveIntegerField(default=0)
    redemptions_count = models.PositiveIntegerField(default=0)

    is_hidden_by_admin = models.BooleanField(default=False)
    published_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "promotion_campaigns"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "visibility", "ends_at"], name="promo_discovery_idx"),
            models.Index(fields=["merchant", "status"], name="promo_merchant_status_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=Q(per_customer_limit__gte=1), name="promo_per_customer_limit_min_1"),
            models.CheckConstraint(
                condition=Q(ends_at__isnull=True) | Q(starts_at__isnull=True) | Q(ends_at__gt=models.F("starts_at")),
                name="promo_ends_after_start",
            ),
        ]

    def __str__(self):
        return f"{self.title} ({self.merchant})"

    # ── state ────────────────────────────────────────────────────────────────

    def effective_status(self, now=None) -> str:
        """draft | scheduled | active | paused | ended | archived."""
        now = now or timezone.now()
        if self.status == self.STATUS_PUBLISHED:
            if self.ends_at and now >= self.ends_at:
                return "ended"
            if self.starts_at and now < self.starts_at:
                return "scheduled"
            return "active"
        return self.status

    def is_claimable(self, now=None) -> bool:
        return (
            self.effective_status(now) == "active"
            and not self.is_hidden_by_admin
            and (self.max_claims is None or self.claims_count < self.max_claims)
        )

    @property
    def has_claims(self) -> bool:
        return self.claims_count > 0


class PromotionBenefit(models.Model):
    """What the customer gets. Exactly one per campaign."""

    KIND_PERCENT = "percent_off"
    KIND_AMOUNT = "amount_off"
    KIND_FREE_ITEM = "free_item"
    KIND_BXGY = "buy_x_get_y"
    KIND_CHOICES = [
        (KIND_PERCENT, "Percentage off"),
        (KIND_AMOUNT, "Amount off"),
        (KIND_FREE_ITEM, "Free item"),
        (KIND_BXGY, "Buy X get Y"),
    ]

    SCOPE_ORDER = "order"
    SCOPE_TARGETS = "targets"
    SCOPE_CHOICES = [(SCOPE_ORDER, "Whole order"), (SCOPE_TARGETS, "Selected products")]

    SELECT_CUSTOMER = "customer_choice"
    SELECT_CHEAPEST = "cheapest"
    SELECT_CHOICES = [(SELECT_CUSTOMER, "Customer chooses"), (SELECT_CHEAPEST, "Cheapest eligible")]

    campaign = models.OneToOneField(PromotionCampaign, on_delete=models.CASCADE, related_name="benefit")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    scope = models.CharField(max_length=10, choices=SCOPE_CHOICES, default=SCOPE_ORDER)
    value = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Percent (0–100) or amount for percent_off / amount_off.",
    )
    reward_quantity = models.PositiveIntegerField(default=1)
    reward_discount_percent = models.DecimalField(max_digits=5, decimal_places=2, default=100)
    reward_selection = models.CharField(max_length=16, choices=SELECT_CHOICES, default=SELECT_CUSTOMER)
    max_applications = models.PositiveIntegerField(default=1)
    include_modifiers = models.BooleanField(
        default=False, help_text="Add-ons on a reward item are free too (otherwise still charged).",
    )

    class Meta:
        db_table = "promotion_benefits"
        constraints = [
            models.CheckConstraint(condition=Q(reward_quantity__gte=1), name="promo_reward_qty_min_1"),
            models.CheckConstraint(condition=Q(max_applications__gte=1), name="promo_max_apps_min_1"),
            models.CheckConstraint(
                condition=Q(reward_discount_percent__gt=0) & Q(reward_discount_percent__lte=100),
                name="promo_reward_pct_range",
            ),
        ]


class PromotionCondition(models.Model):
    """A rule that must hold for the benefit to apply (AND-ed)."""

    KIND_QUALIFYING_ITEMS = "qualifying_items"
    KIND_CHOICES = [(KIND_QUALIFYING_ITEMS, "Buy at least N of the qualifying products")]

    campaign = models.ForeignKey(PromotionCampaign, on_delete=models.CASCADE, related_name="conditions")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    quantity = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = "promotion_conditions"
        constraints = [
            models.CheckConstraint(condition=Q(quantity__gte=1), name="promo_condition_qty_min_1"),
        ]


class PromotionTarget(models.Model):
    """A product, category or variant the campaign refers to (real FKs, merchant-checked)."""

    ROLE_BENEFIT = "benefit"        # discounted / reward set
    ROLE_QUALIFYING = "qualifying"  # what must be bought (buy X get Y)
    ROLE_CHOICES = [(ROLE_BENEFIT, "Benefit"), (ROLE_QUALIFYING, "Qualifying")]

    campaign = models.ForeignKey(PromotionCampaign, on_delete=models.CASCADE, related_name="targets")
    role = models.CharField(max_length=12, choices=ROLE_CHOICES)
    menu_item = models.ForeignKey("merchants.MenuItem", on_delete=models.CASCADE, null=True, blank=True)
    category = models.ForeignKey("merchants.MenuCategory", on_delete=models.CASCADE, null=True, blank=True)
    option = models.ForeignKey("merchants.MenuOption", on_delete=models.CASCADE, null=True, blank=True)

    class Meta:
        db_table = "promotion_targets"
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(menu_item__isnull=False, category__isnull=True, option__isnull=True)
                    | Q(menu_item__isnull=True, category__isnull=False, option__isnull=True)
                    | Q(menu_item__isnull=True, category__isnull=True, option__isnull=False)
                ),
                name="promo_target_exactly_one",
            ),
        ]


class VoucherClaim(models.Model):
    STATUS_AVAILABLE = "available"
    STATUS_RESERVED = "reserved"
    STATUS_REDEEMED = "redeemed"
    STATUS_EXPIRED = "expired"
    STATUS_REVOKED = "revoked"
    STATUS_CHOICES = [
        (STATUS_AVAILABLE, "Available"),
        (STATUS_RESERVED, "Reserved on an order"),
        (STATUS_REDEEMED, "Used"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_REVOKED, "Revoked"),
    ]

    SOURCE_MARKETPLACE = "marketplace"
    SOURCE_LINK = "link"
    SOURCE_MERCHANT = "merchant_issued"
    SOURCE_AUTOMATION = "automation"
    SOURCE_CHOICES = [
        (SOURCE_MARKETPLACE, "Marketplace"),
        (SOURCE_LINK, "Private link"),
        (SOURCE_MERCHANT, "Issued by merchant"),
        (SOURCE_AUTOMATION, "Automation"),
    ]

    campaign = models.ForeignKey(PromotionCampaign, on_delete=models.CASCADE, related_name="claims")
    customer = models.ForeignKey("accounts.CustomerProfile", on_delete=models.CASCADE, related_name="voucher_claims")
    merchant = models.ForeignKey("merchants.MerchantProfile", on_delete=models.CASCADE, related_name="voucher_claims")
    code = models.CharField(max_length=16, unique=True, help_text="Normalised human code (no prefix/dashes).")
    qr_token = models.CharField(max_length=40, unique=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STATUS_AVAILABLE, db_index=True)
    uses_allowed = models.PositiveIntegerField(default=1)
    uses_count = models.PositiveIntegerField(default=0)
    reserved_order = models.ForeignKey(
        "orders.Order", on_delete=models.SET_NULL, null=True, blank=True, related_name="reserved_voucher_claims",
    )
    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default=SOURCE_MARKETPLACE)
    campaign_version = models.PositiveIntegerField(default=1)
    claimed_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "voucher_claims"
        ordering = ["-claimed_at"]
        constraints = [
            models.UniqueConstraint(fields=["campaign", "customer"], name="one_claim_per_customer_per_campaign"),
            models.CheckConstraint(condition=Q(uses_count__lte=models.F("uses_allowed")), name="claim_uses_within_allowed"),
        ]
        indexes = [models.Index(fields=["customer", "status"], name="claim_customer_status_idx")]

    def __str__(self):
        return f"{self.display_code} → {self.customer}"

    @property
    def display_code(self) -> str:
        from .codes import format_code
        return format_code(self.code)

    @property
    def uses_remaining(self) -> int:
        return max(self.uses_allowed - self.uses_count, 0)

    def is_expired(self, now=None) -> bool:
        return bool(self.expires_at and (now or timezone.now()) >= self.expires_at)

    def customer_status(self, now=None) -> str:
        """What the customer's My Offers tab should show: available | used | expired."""
        if self.status == self.STATUS_REDEEMED:
            return "used"
        if self.status in (self.STATUS_EXPIRED, self.STATUS_REVOKED):
            return "expired"
        if self.status == self.STATUS_AVAILABLE and self.is_expired(now):
            return "expired"
        return "available"


class VoucherRedemption(models.Model):
    STATUS_APPLIED = "applied"
    STATUS_VOIDED = "voided"
    STATUS_CHOICES = [(STATUS_APPLIED, "Applied"), (STATUS_VOIDED, "Voided")]

    CHANNEL_ONLINE = "online"
    CHANNEL_POS = "pos"
    CHANNEL_IN_STORE = "in_store"   # confirmed at the counter without a Zentro order
    CHANNEL_CHOICES = [(CHANNEL_ONLINE, "Online order"), (CHANNEL_POS, "POS order"), (CHANNEL_IN_STORE, "In store")]

    # History outlives its parents: deleting a customer account, a campaign or an
    # order must not be blocked, and must not erase the record of the discount
    # given (rules_snapshot and the money columns keep it self-describing).
    claim = models.ForeignKey(VoucherClaim, on_delete=models.SET_NULL, null=True, related_name="redemptions")
    campaign = models.ForeignKey(PromotionCampaign, on_delete=models.SET_NULL, null=True, related_name="redemptions")
    merchant = models.ForeignKey("merchants.MerchantProfile", on_delete=models.CASCADE, related_name="voucher_redemptions")
    customer = models.ForeignKey(
        "accounts.CustomerProfile", on_delete=models.SET_NULL, null=True, related_name="voucher_redemptions",
    )
    order = models.ForeignKey(
        "orders.Order", on_delete=models.SET_NULL, null=True, blank=True, related_name="voucher_redemptions",
    )
    channel = models.CharField(max_length=10, choices=CHANNEL_CHOICES)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default=STATUS_APPLIED)
    voided_at = models.DateTimeField(null=True, blank=True)
    void_reason = models.CharField(max_length=120, blank=True, default="")

    currency_code = models.CharField(max_length=3, default="NPR")
    order_subtotal = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    discount_amount = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
        help_text="Priced by the engine; null for in-store confirmations without an order.",
    )
    order_total = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    rules_snapshot = models.JSONField(default=dict)

    CONFIRMED_ORDER = "order"          # applied to a Zentro order, used when it settled
    CONFIRMED_POS = "pos"              # staff confirmed at the POS without an order
    CONFIRMED_DASHBOARD = "dashboard"  # staff confirmed from the merchant dashboard
    CONFIRMED_PIN = "pin"              # staff typed the store PIN on the customer's phone
    CONFIRMED_CHOICES = [
        (CONFIRMED_ORDER, "Order"),
        (CONFIRMED_POS, "POS"),
        (CONFIRMED_DASHBOARD, "Merchant dashboard"),
        (CONFIRMED_PIN, "Store PIN"),
    ]
    confirmed_via = models.CharField(max_length=10, choices=CONFIRMED_CHOICES, default=CONFIRMED_ORDER)

    redeemed_by_worker = models.ForeignKey(
        "pos.ShiftWorker", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    redeemed_by_user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    idempotency_key = models.CharField(max_length=64, unique=True, null=True, blank=True)

    is_new_customer = models.BooleanField(default=False)
    returned_within_7d = models.BooleanField(null=True, blank=True)
    returned_within_30d = models.BooleanField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "voucher_redemptions"
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["order"],
                condition=Q(status="applied") & Q(order__isnull=False),
                name="one_applied_redemption_per_order",
            ),
        ]


class PromotionDailyStats(models.Model):
    campaign = models.ForeignKey(PromotionCampaign, on_delete=models.CASCADE, related_name="daily_stats")
    date = models.DateField()
    views = models.PositiveIntegerField(default=0)
    unique_viewers = models.PositiveIntegerField(default=0)
    claims = models.PositiveIntegerField(default=0)
    redemptions = models.PositiveIntegerField(default=0)
    voids = models.PositiveIntegerField(default=0)
    discount_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    sales_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    new_customers = models.PositiveIntegerField(default=0)
    returning_customers = models.PositiveIntegerField(default=0)

    class Meta:
        db_table = "promotion_daily_stats"
        constraints = [models.UniqueConstraint(fields=["campaign", "date"], name="one_stats_row_per_day")]


class MerchantRedemptionPin(models.Model):
    """
    Optional counter PIN: staff type it on the customer's phone to confirm an
    offer when the store has no device to scan with. Only a hash is stored.
    """

    merchant = models.OneToOneField(
        "merchants.MerchantProfile", on_delete=models.CASCADE, related_name="offer_redemption_pin",
    )
    pin_hash = models.CharField(max_length=128)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "merchant_redemption_pins"
