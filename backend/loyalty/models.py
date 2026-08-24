"""
loyalty/models.py
"""
import secrets
import string
import uuid
from django.db import models
from django.utils import timezone
from datetime import timedelta


# Characters that exclude visually ambiguous pairs (0/O, 1/I/L)
_SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _generate_membership_number(slug: str) -> str:
    """Generate a non-sequential, merchant-prefixed membership number.

    Format: ``PREFIX-XXXXXX`` where PREFIX is derived from the merchant slug
    and XXXXXX is a random token from a safe 32-character alphabet.

    Examples: ``CAF-A91K22``, ``RES-X82M11``
    """
    prefix_chars = [c for c in slug if c.isalpha()]
    prefix = "".join(prefix_chars[:3]).upper()
    prefix = prefix.ljust(3, "X")

    random_part = "".join(
        secrets.choice(_SAFE_ALPHABET) for _ in range(6)
    )
    return f"{prefix}-{random_part}"

class TodaySpecial(models.Model):
    DISCOUNT_NONE = "none"
    DISCOUNT_PERCENTAGE = "percentage"
    DISCOUNT_FIXED = "fixed"
    DISCOUNT_CHOICES = [
        (DISCOUNT_NONE, "No discount"),
        (DISCOUNT_PERCENTAGE, "Percentage"),
        (DISCOUNT_FIXED, "Fixed amount"),
    ]

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="today_specials",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    image_url = models.URLField(blank=True)
    linked_menu_item = models.ForeignKey(
        "merchants.MenuItem",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="specials",
    )
    linked_reward = models.ForeignKey(
        "loyalty.Reward",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="specials",
    )
    discount_type = models.CharField(
        max_length=20,
        choices=DISCOUNT_CHOICES,
        default=DISCOUNT_NONE,
    )
    discount_value = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Percentage (0-100) or fixed amount depending on discount_type",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "today_specials"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.title} — {self.merchant.business_name}"


class CustomerMerchantProfile(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_INACTIVE = "inactive"
    STATUS_CHOICES = [
        (STATUS_ACTIVE, "Active"),
        (STATUS_INACTIVE, "Inactive"),
    ]

    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="merchant_profiles",
    )
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="customer_profiles",
    )
    membership_number = models.CharField(
        max_length=20,
        unique=True,
        blank=True,
        null=True,
        db_index=True,
        help_text="Unique merchant-specific membership ID, e.g. CAF-A91K22",
    )
    joined_at = models.DateTimeField(auto_now_add=True)
    last_active_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default=STATUS_ACTIVE,
        db_index=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customer_merchant_profiles"
        unique_together = ["customer", "merchant"]

    def __str__(self):
        return f"{self.customer} @ {self.merchant}"

    def save(self, *args, **kwargs):
        if not self.membership_number:
            self.membership_number = _generate_membership_number(
                self.merchant.slug
            )
        super().save(*args, **kwargs)


class CustomerMerchantWallet(models.Model):
    TIER_BRONZE = "bronze"
    TIER_SILVER = "silver"
    TIER_GOLD = "gold"
    TIER_PLATINUM = "platinum"
    TIER_CHOICES = [
        (TIER_BRONZE, "Bronze"),
        (TIER_SILVER, "Silver"),
        (TIER_GOLD, "Gold"),
        (TIER_PLATINUM, "Platinum"),
    ]

    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="merchant_wallets",
    )
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="customer_wallets",
    )
    membership = models.ForeignKey(
        "CustomerMerchantProfile",
        on_delete=models.CASCADE,
        related_name="wallets",
        null=True,
        blank=True,
    )
    points_balance = models.IntegerField(default=0)
    lifetime_points = models.IntegerField(default=0)
    redeemed_points = models.IntegerField(default=0)
    expired_points = models.IntegerField(default=0)
    order_count = models.IntegerField(default=0)
    streak_days = models.IntegerField(default=0)
    last_order_datetime = models.DateTimeField(null=True, blank=True)
    last_point_earned_at = models.DateTimeField(null=True, blank=True)
    tier_level = models.CharField(
        max_length=20,
        choices=TIER_CHOICES,
        default=TIER_BRONZE,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customer_merchant_wallets"
        unique_together = ["customer", "merchant"]
        indexes = [
            models.Index(fields=["merchant", "-points_balance"]),
        ]

    def __str__(self):
        return f"{self.customer} @ {self.merchant} — {self.points_balance} pts"


class LoyaltyRules(models.Model):
    merchant = models.OneToOneField(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="loyalty_rules",
    )
    points_per_npr = models.FloatField(default=1.0)
    streak_multiplier = models.FloatField(default=1.5)
    welcome_bonus = models.IntegerField(default=50)
    birthday_bonus = models.IntegerField(default=100)
    streak_min_amount = models.DecimalField(max_digits=10, decimal_places=2, default=100)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "loyalty_rules"

    def __str__(self):
        return f"Rules for {self.merchant.business_name}"


class MerchantPunchCard(models.Model):
    MODE_PER_ORDER = "per_order"
    MODE_PER_STREAK = "per_streak"
    MODE_CHOICES = [
        (MODE_PER_ORDER, "Per Order"),
        (MODE_PER_STREAK, "Per Streak"),
    ]

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="punch_cards",
    )
    name = models.CharField(max_length=255)
    mode = models.CharField(max_length=20, choices=MODE_CHOICES, default=MODE_PER_ORDER)
    stamps_required = models.IntegerField(default=5)
    reward_text = models.CharField(max_length=255)
    background_image = models.URLField(blank=True)
    animated_gif_background = models.URLField(blank=True)
    color_scheme = models.CharField(max_length=20, default="#FFFFFF")
    stamp_icon = models.CharField(max_length=255, default="☕")
    stamp_gif_url = models.URLField(blank=True, default="", null=True, help_text="Optional GIF URL to use instead of emoji stamp")
    logo = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "merchant_punch_cards"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} - {self.merchant}"


class CustomerPunchCard(models.Model):
    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="punch_cards",
    )
    punch_card = models.ForeignKey(
        MerchantPunchCard,
        on_delete=models.CASCADE,
        related_name="customer_progress",
    )
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="customer_punch_cards",
    )
    current_stamps = models.IntegerField(default=0)
    is_completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    is_redeemed = models.BooleanField(default=False)
    # Add inside CustomerPunchCard model, after is_redeemed fields:
    proof_code            = models.CharField(max_length=10, blank=True, default="")
    proof_code_expires_at = models.DateTimeField(null=True, blank=True)
    proof_code_used       = models.BooleanField(default=False)
    redeemed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customer_punch_cards"
        # No unique_together here — partial constraint handled in application logic

    def __str__(self):
        return f"{self.customer} - {self.punch_card.name}: {self.current_stamps}/{self.punch_card.stamps_required}"
    def generate_proof_code(self) -> str:
    
    
        if not self.is_completed:
            raise ValueError("Card is not completed yet.")
        if self.is_redeemed:
            raise ValueError("Card is already redeemed.")
        self.proof_code            = uuid.uuid4().hex[:6].upper()
        self.proof_code_expires_at = timezone.now() + timedelta(minutes=30)
        self.proof_code_used       = False
        self.save(update_fields=["proof_code", "proof_code_expires_at", "proof_code_used", "updated_at"])
        return self.proof_code
    def add_punch(self) -> bool:
        """Award one punch. Returns True if this punch completed the card."""
        if self.is_completed:
            return False

        self.current_stamps += 1
        completed = False
        if self.current_stamps >= self.punch_card.stamps_required:
            self.is_completed = True
            from django.utils import timezone
            self.completed_at = timezone.now()
            completed = True

        # Use update_fields to avoid triggering unique constraint issues
        self.save(update_fields=["current_stamps", "is_completed", "completed_at", "updated_at"])
        return completed

    def redeem(self):
        if not self.is_completed:
            raise ValueError("Card is not completed yet.")
        if self.is_redeemed:
            raise ValueError("Card is already redeemed.")
        self.is_redeemed = True
        from django.utils import timezone
        self.redeemed_at = timezone.now()
        self.save(update_fields=["is_redeemed", "redeemed_at", "updated_at"])


class PointTransaction(models.Model):
    TRANSACTION_TYPES = [
        ("EARNED", "Earned"),
        ("REDEEMED", "Redeemed"),
        ("MISSION_BONUS", "Mission Bonus"),
        ("PUNCH_CARD_REWARD", "Punch Card Reward"),
        ("EXPIRED", "Expired"),
        ("MANUAL_ADJUSTMENT", "Manual Adjustment"),
        ("TRANSFER_SENT", "Transfer Sent"),
        ("TRANSFER_RECEIVED", "Transfer Received"),
    ]

    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="point_transactions",
    )
    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="point_transactions",
    )
    membership = models.ForeignKey(
        "CustomerMerchantProfile",
        on_delete=models.CASCADE,
        related_name="point_transactions",
        null=True,
        blank=True,
    )
    wallet = models.ForeignKey(
        CustomerMerchantWallet,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    transfer_group = models.UUIDField(null=True, blank=True, db_index=True)

    order = models.ForeignKey(
        "orders.Order",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="point_transactions",
    )
    reward = models.ForeignKey(
        "Reward",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="point_transactions",
    )
    mission = models.ForeignKey(
        "Mission",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="point_transactions",
    )
    punch_card = models.ForeignKey(
        CustomerPunchCard,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="point_transactions",
    )
    transaction_type = models.CharField(max_length=50, choices=TRANSACTION_TYPES)
    points = models.IntegerField()
    balance_before = models.IntegerField()
    balance_after = models.IntegerField()
    expiry_date = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, default="completed")
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "point_transactions"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["merchant", "customer", "-created_at"], name="pt_merchant_customer_idx"),
        ]

    def __str__(self):
        return f"{self.transaction_type}: {self.points} pts for {self.customer} @ {self.merchant}"


class Mission(models.Model):
    MISSION_TYPES = [
        ("order_count", "Order Count"),
        ("spend_amount", "Spend Amount"),
        ("visit_streak", "Visit Streak"),
        ("purchase", "Purchase"),
        ("visit", "Visit"),
        ("referral", "Referral"),
        ("special", "Special"),
    ]

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, blank=True, default="🎯")
    mission_type = models.CharField(max_length=20, choices=MISSION_TYPES, default="order_count")
    target_count = models.IntegerField(default=1)
    reward_points = models.IntegerField(default=10)
    required_merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="missions",
    )
    RESTART_CHOICES = [
        ("never", "Never"),
        ("daily", "Daily"),
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
    ]

    is_active = models.BooleanField(default=True)
    restart_interval = models.CharField(
        max_length=10, choices=RESTART_CHOICES, default="never", blank=True,
    )
    linked_menu_item = models.ForeignKey(
        "merchants.MenuItem",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="missions",
    )
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "missions"
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class CustomerMission(models.Model):
    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="missions",
    )
    mission = models.ForeignKey(
        Mission,
        on_delete=models.CASCADE,
        related_name="progress_entries",
    )
    current_count = models.IntegerField(default=0)
    is_completed = models.BooleanField(default=False)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "customer_missions"
        unique_together = ["customer", "mission"]

    def __str__(self):
        return f"{self.customer} - {self.mission.title}"


class Reward(models.Model):
    merchant = models.ForeignKey(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="rewards",
    )
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    emoji = models.CharField(max_length=10, default="🎁")
    points_cost = models.IntegerField()
    image_url = models.URLField(blank=True)
    is_active = models.BooleanField(default=True)
    stock = models.IntegerField(default=-1)
    linked_menu_item = models.ForeignKey(
        "merchants.MenuItem",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="rewards",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "rewards"
        ordering = ["points_cost"]

    def __str__(self):
        return f"{self.name} ({self.points_cost} pts)"

    @property
    def is_in_stock(self) -> bool:
        return self.stock == -1 or self.stock > 0


class Redemption(models.Model):
    STATUS_PENDING = "pending"
    STATUS_CONFIRMED = "confirmed"
    STATUS_EXPIRED = "expired"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Pending"),
        (STATUS_CONFIRMED, "Confirmed"),
        (STATUS_EXPIRED, "Expired"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    customer = models.ForeignKey(
        "accounts.CustomerProfile",
        on_delete=models.CASCADE,
        related_name="redemptions",
    )
    reward = models.ForeignKey(
        Reward,
        on_delete=models.CASCADE,
        related_name="redemptions",
    )
    points_spent = models.IntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    code = models.CharField(max_length=50, unique=True, db_index=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "redemptions"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.customer} — {self.reward.name} [{self.code}]"


class MembershipQrToken(models.Model):
    """Unique QR token for one customer membership at one merchant."""

    membership = models.ForeignKey(
        "CustomerMerchantProfile",
        on_delete=models.CASCADE,
        related_name="qr_tokens",
    )
    public_token = models.CharField(
        max_length=64,
        unique=True,
        db_index=True,
        editable=False,
    )
    token_version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    rotated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "membership_qr_tokens"

    def __str__(self):
        return f"QR {self.public_token} → {self.membership}"

    def save(self, *args, **kwargs):
        if not self.public_token:
            self.public_token = f"MQR_{secrets.token_urlsafe(12)}"
        super().save(*args, **kwargs)

    def rotate(self):
        """Invalidate the current token and issue a new one."""
        self.is_active = False
        self.rotated_at = timezone.now()
        self.save(update_fields=["is_active", "rotated_at"])
        new = MembershipQrToken.objects.create(
            membership=self.membership,
            token_version=self.token_version + 1,
        )
        return new


class MerchantMembershipCardDesign(models.Model):
    """One card design per merchant — controls how membership cards look."""

    BACKGROUND_SOLID = "solid"
    BACKGROUND_IMAGE = "image"
    BACKGROUND_PATTERN = "pattern"
    BACKGROUND_CHOICES = [
        (BACKGROUND_SOLID, "Solid Color"),
        (BACKGROUND_IMAGE, "Image"),
        (BACKGROUND_PATTERN, "Pattern"),
    ]

    TEXT_LIGHT = "light"
    TEXT_DARK = "dark"
    TEXT_MODE_CHOICES = [
        (TEXT_LIGHT, "Light Text"),
        (TEXT_DARK, "Dark Text"),
    ]

    PATTERN_NONE = ""
    PATTERN_ZENTRO_DOTS = "zentro_dots"
    PATTERN_GEOMETRIC = "geometric"
    PATTERN_DIAMONDS = "diamonds"
    PATTERN_CHOICES = [
        (PATTERN_NONE, "None"),
        (PATTERN_ZENTRO_DOTS, "Zentro Dots"),
        (PATTERN_GEOMETRIC, "Geometric"),
        (PATTERN_DIAMONDS, "Diamonds"),
    ]

    TIER_STYLE_DEFAULT = "default"
    TIER_STYLE_MINIMAL = "minimal"
    TIER_STYLE_BADGE = "badge"
    TIER_STYLE_CHOICES = [
        (TIER_STYLE_DEFAULT, "Default"),
        (TIER_STYLE_MINIMAL, "Minimal"),
        (TIER_STYLE_BADGE, "Badge"),
    ]

    merchant = models.OneToOneField(
        "merchants.MerchantProfile",
        on_delete=models.CASCADE,
        related_name="card_design",
    )
    card_title = models.CharField(max_length=100, default="Membership")
    card_subtitle = models.CharField(max_length=200, blank=True, default="")
    background_type = models.CharField(
        max_length=20,
        choices=BACKGROUND_CHOICES,
        default=BACKGROUND_SOLID,
    )
    primary_color = models.CharField(max_length=7, default="#171717")
    secondary_color = models.CharField(max_length=7, default="#382418")
    accent_color = models.CharField(max_length=7, default="#D97941")
    text_mode = models.CharField(
        max_length=10,
        choices=TEXT_MODE_CHOICES,
        default=TEXT_LIGHT,
    )
    background_image = models.URLField(blank=True, default="")
    background_pattern = models.CharField(
        max_length=30,
        choices=PATTERN_CHOICES,
        default=PATTERN_ZENTRO_DOTS,
    )
    logo = models.URLField(blank=True, default="")
    tier_style = models.CharField(
        max_length=20,
        choices=TIER_STYLE_CHOICES,
        default=TIER_STYLE_DEFAULT,
    )
    points_label = models.CharField(max_length=50, default="POINTS")
    membership_label = models.CharField(max_length=50, default="MEMBERSHIP")
    show_lifetime_points = models.BooleanField(default=True)
    show_joined_date = models.BooleanField(default=True)
    show_qr_shortcut = models.BooleanField(default=True)
    show_color_overlay = models.BooleanField(default=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "merchant_card_designs"

    def __str__(self):
        return f"Card design for {self.merchant.business_name}"