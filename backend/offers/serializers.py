from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from .codes import QR_PREFIX
from .models import (
    PromotionBenefit,
    PromotionCampaign,
    PromotionCondition,
    PromotionTarget,
    VoucherClaim,
    VoucherRedemption,
)

B = PromotionBenefit

# Rule fields that cannot change once customers hold claims (duplicate instead).
LOCKED_WHEN_CLAIMED = (
    "min_order_amount", "max_discount_amount", "per_customer_limit", "channels", "exclude_discounted_items",
)


# ── Human descriptions (one wording everywhere) ──────────────────────────────

def _money(merchant, amount) -> str:
    amount = Decimal(amount)
    text = f"{amount:,.2f}".rstrip("0").rstrip(".") if amount % 1 else f"{amount:,.0f}"
    return f"{merchant.currency_symbol or merchant.currency_code} {text}"


def _target_names(campaign, role, limit=2) -> str:
    names = []
    for t in campaign.targets.all():
        if t.role != role:
            continue
        if t.menu_item_id:
            names.append(t.menu_item.name)
        elif t.category_id:
            names.append(t.category.name)
        elif t.option_id:
            names.append(f"{t.option.group.menu_item.name} ({t.option.name})")
    if not names:
        return ""
    return ", ".join(names[:limit]) + ("…" if len(names) > limit else "")


def describe_benefit(campaign) -> str:
    benefit = getattr(campaign, "benefit", None)
    if benefit is None:
        return ""
    m = campaign.merchant
    rewards = _target_names(campaign, PromotionTarget.ROLE_BENEFIT)
    where = "your order" if benefit.scope == B.SCOPE_ORDER else (rewards or "selected items")
    if benefit.kind == B.KIND_PERCENT:
        return f"{benefit.value.normalize():f}% off {where}"
    if benefit.kind == B.KIND_AMOUNT:
        return f"{_money(m, benefit.value)} off {where}"
    free = "free" if benefit.reward_discount_percent >= 100 else f"{benefit.reward_discount_percent.normalize():f}% off"
    qty = f"{benefit.reward_quantity} " if benefit.reward_quantity > 1 else ""
    if benefit.kind == B.KIND_FREE_ITEM:
        return f"Get {qty}{rewards or 'an item'} {free}"
    condition = next((c for c in campaign.conditions.all()), None)
    x = condition.quantity if condition else 1
    qual = _target_names(campaign, PromotionTarget.ROLE_QUALIFYING) or "items"
    return f"Buy {x} {qual}, get {qty}{rewards or 'an item'} {free}"


def _pct(value) -> str:
    return f"{Decimal(value).normalize():f}"


def describe_badge(campaign) -> str:
    """Short label for the offer badge ("20% OFF", "BUY 1 GET 1 FREE"). Display only."""
    benefit = getattr(campaign, "benefit", None)
    if benefit is None:
        return ""
    if benefit.kind == B.KIND_PERCENT:
        return f"{_pct(benefit.value)}% OFF"
    if benefit.kind == B.KIND_AMOUNT:
        return f"{_money(campaign.merchant, benefit.value)} OFF"
    free = benefit.reward_discount_percent >= 100
    qty = benefit.reward_quantity
    if benefit.kind == B.KIND_FREE_ITEM:
        if free:
            return "FREE ITEM" if qty == 1 else f"{qty} FREE ITEMS"
        return f"{_pct(benefit.reward_discount_percent)}% OFF ITEM"
    condition = next((c for c in campaign.conditions.all()), None)
    x = condition.quantity if condition else 1
    reward = "FREE" if free else f"{_pct(benefit.reward_discount_percent)}% OFF"
    return f"BUY {x} GET {qty} {reward}"


def describe_reward_lines(campaign) -> list[str]:
    """The "What you get" list: the benefit split into short lines. Display only."""
    benefit = getattr(campaign, "benefit", None)
    if benefit is None:
        return []
    if benefit.kind != B.KIND_BXGY:
        return [describe_benefit(campaign)]
    condition = next((c for c in campaign.conditions.all()), None)
    x = condition.quantity if condition else 1
    qual = _target_names(campaign, PromotionTarget.ROLE_QUALIFYING, limit=3) or "qualifying items"
    rewards = _target_names(campaign, PromotionTarget.ROLE_BENEFIT, limit=3) or "an item"
    free = "free" if benefit.reward_discount_percent >= 100 else f"at {_pct(benefit.reward_discount_percent)}% off"
    return [f"Buy {x} × {qual}", f"Get {benefit.reward_quantity} × {rewards} {free}"]


def describe_conditions(campaign) -> list[str]:
    m = campaign.merchant
    out = []
    if campaign.min_order_amount:
        out.append(f"Min. spend {_money(m, campaign.min_order_amount)}")
    if campaign.max_discount_amount:
        out.append(f"Max. discount {_money(m, campaign.max_discount_amount)}")
    if campaign.per_customer_limit > 1:
        out.append(f"Use up to {campaign.per_customer_limit} times")
    if campaign.channels == PromotionCampaign.CHANNEL_ONLINE:
        out.append("Online orders only")
    elif campaign.channels == PromotionCampaign.CHANNEL_IN_STORE:
        out.append("In store only")
    if campaign.exclude_discounted_items:
        out.append("Not valid on items already on special")
    if campaign.claim_valid_days:
        out.append(f"Use within {campaign.claim_valid_days} days of claiming")
    return out


def merchant_card(merchant) -> dict:
    category = merchant.primary_category
    return {
        "id": merchant.id,
        "name": merchant.business_name,
        "slug": merchant.slug,
        "logo_url": merchant.logo_url,
        "category": {"slug": category.slug, "name": category.name, "icon": category.icon} if category else None,
        "city": merchant.city,
        "area": merchant.area,
        "address": merchant.address,
        "currency_symbol": merchant.currency_symbol,
    }


# ── Public offer card ────────────────────────────────────────────────────────

class PublicOfferSerializer(serializers.ModelSerializer):
    summary = serializers.SerializerMethodField()
    conditions = serializers.SerializerMethodField()
    merchant = serializers.SerializerMethodField()
    distance_km = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()
    my_claim_id = serializers.SerializerMethodField()
    benefit_kind = serializers.CharField(source="benefit.kind", read_only=True)
    badge = serializers.SerializerMethodField()
    what_you_get = serializers.SerializerMethodField()

    class Meta:
        model = PromotionCampaign
        fields = [
            "id", "title", "description", "terms", "image_url", "summary", "badge", "what_you_get", "conditions",
            "benefit_kind", "merchant", "distance_km", "starts_at", "ends_at", "remaining", "my_claim_id",
        ]

    def get_summary(self, obj):
        return describe_benefit(obj)

    def get_badge(self, obj):
        return describe_badge(obj)

    def get_what_you_get(self, obj):
        return describe_reward_lines(obj)

    def get_conditions(self, obj):
        return describe_conditions(obj)

    def get_merchant(self, obj):
        return merchant_card(obj.merchant)

    def get_distance_km(self, obj):
        d = (self.context.get("distances") or {}).get(obj.id)
        return round(d, 2) if d is not None else None

    def get_remaining(self, obj):
        return None if obj.max_claims is None else max(obj.max_claims - obj.claims_count, 0)

    def get_my_claim_id(self, obj):
        return (self.context.get("claimed") or {}).get(obj.id)


# ── Customer claim (My Offers) ───────────────────────────────────────────────

class ClaimSerializer(serializers.ModelSerializer):
    code = serializers.CharField(source="display_code", read_only=True)
    qr_payload = serializers.SerializerMethodField()
    tab = serializers.SerializerMethodField()
    offer = serializers.SerializerMethodField()
    uses_remaining = serializers.IntegerField(read_only=True)
    needs_bill_amount = serializers.SerializerMethodField()
    bill_label = serializers.SerializerMethodField()
    store_pin_enabled = serializers.SerializerMethodField()
    last_use = serializers.SerializerMethodField()

    class Meta:
        model = VoucherClaim
        fields = [
            "id", "code", "qr_payload", "status", "tab", "uses_allowed", "uses_count", "uses_remaining",
            "claimed_at", "expires_at", "offer", "needs_bill_amount", "bill_label", "store_pin_enabled",
            "last_use",
        ]

    def get_last_use(self, obj):
        """The latest applied redemption, for the used-voucher receipt (read only)."""
        applied = [r for r in obj.redemptions.all() if r.status == VoucherRedemption.STATUS_APPLIED]
        if not applied:
            return None
        red = max(applied, key=lambda r: r.created_at)
        order = red.order
        # Link the order only when it is the customer's own (a POS sale may belong to no one).
        own_order = order is not None and order.customer_id is not None and order.customer_id == obj.customer_id
        return {
            "used_at": red.created_at,
            "discount_amount": str(red.discount_amount) if red.discount_amount is not None else None,
            "order_id": order.pk if own_order else None,
        }

    def get_needs_bill_amount(self, obj):
        from .engine import needs_bill_amount
        return needs_bill_amount(obj.campaign)

    def get_bill_label(self, obj):
        from .engine import bill_label
        return bill_label(obj.campaign)

    def get_store_pin_enabled(self, obj):
        return hasattr(obj.campaign.merchant, "offer_redemption_pin")

    def get_qr_payload(self, obj):
        return f"{QR_PREFIX}{obj.qr_token}"

    def get_tab(self, obj):
        return obj.customer_status()

    def get_offer(self, obj):
        campaign = obj.campaign
        return {
            "id": campaign.id,
            "title": campaign.title,
            "description": campaign.description,
            "summary": describe_benefit(campaign),
            "badge": describe_badge(campaign),
            "what_you_get": describe_reward_lines(campaign),
            "conditions": describe_conditions(campaign),
            "terms": campaign.terms,
            "image_url": campaign.image_url,
            "benefit_kind": campaign.benefit.kind,
            "channels": campaign.channels,
            "merchant": merchant_card(campaign.merchant),
        }


# ── Merchant campaign editor ─────────────────────────────────────────────────

class TargetSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=PromotionTarget.ROLE_CHOICES)
    menu_item = serializers.IntegerField(required=False, allow_null=True)
    category = serializers.IntegerField(required=False, allow_null=True)
    option = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        set_fields = [k for k in ("menu_item", "category", "option") if attrs.get(k)]
        if len(set_fields) != 1:
            raise serializers.ValidationError("Each target must be exactly one product, category or variant.")
        return attrs


class BenefitSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=B.KIND_CHOICES)
    scope = serializers.ChoiceField(choices=B.SCOPE_CHOICES, default=B.SCOPE_ORDER)
    value = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True)
    reward_quantity = serializers.IntegerField(min_value=1, max_value=20, default=1)
    reward_discount_percent = serializers.DecimalField(max_digits=5, decimal_places=2, default=Decimal("100"))
    reward_selection = serializers.ChoiceField(choices=B.SELECT_CHOICES, default=B.SELECT_CUSTOMER)
    max_applications = serializers.IntegerField(min_value=1, max_value=20, default=1)
    include_modifiers = serializers.BooleanField(default=False)


class CampaignWriteSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=120, min_length=3)
    description = serializers.CharField(required=False, allow_blank=True, max_length=2000, default="")
    terms = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    image_url = serializers.URLField(required=False, allow_blank=True, default="")
    visibility = serializers.ChoiceField(choices=PromotionCampaign.VISIBILITY_CHOICES, default=PromotionCampaign.VISIBILITY_PUBLIC)
    channels = serializers.ChoiceField(choices=PromotionCampaign.CHANNEL_CHOICES, default=PromotionCampaign.CHANNEL_ALL)
    starts_at = serializers.DateTimeField(required=False, allow_null=True)
    ends_at = serializers.DateTimeField(required=False, allow_null=True)
    claim_valid_days = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=365)
    max_claims = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    max_redemptions = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    per_customer_limit = serializers.IntegerField(default=1, min_value=1, max_value=100)
    min_order_amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0"))
    max_discount_amount = serializers.DecimalField(max_digits=10, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0.01"))
    exclude_discounted_items = serializers.BooleanField(default=True)
    restore_on_cancel = serializers.BooleanField(default=True)
    benefit = BenefitSerializer()
    qualifying_quantity = serializers.IntegerField(required=False, min_value=1, max_value=50)
    targets = TargetSerializer(many=True, required=False)

    @staticmethod
    def _current_rules(instance) -> tuple[dict | None, list[dict], int | None]:
        b = getattr(instance, "benefit", None)
        benefit = None if b is None else {
            "kind": b.kind, "scope": b.scope, "value": b.value, "reward_quantity": b.reward_quantity,
            "reward_discount_percent": b.reward_discount_percent, "reward_selection": b.reward_selection,
            "max_applications": b.max_applications, "include_modifiers": b.include_modifiers,
        }
        targets = [
            {"role": t.role, "menu_item": t.menu_item_id, "category": t.category_id, "option": t.option_id}
            for t in instance.targets.all()
        ]
        cond = next((c for c in instance.conditions.all()), None)
        return benefit, targets, (cond.quantity if cond else None)

    @staticmethod
    def _target_key(t) -> tuple:
        return (t["role"], t.get("menu_item") or None, t.get("category") or None, t.get("option") or None)

    def validate(self, attrs):
        merchant = self.context["merchant"]
        instance = self.context.get("instance")

        cur_benefit, cur_targets, cur_qty = self._current_rules(instance) if instance else (None, [], None)
        new_benefit = attrs.get("benefit")
        new_targets = attrs.get("targets") if "targets" in self.initial_data else None
        new_qty = attrs.get("qualifying_quantity") if "qualifying_quantity" in self.initial_data else None

        if instance is not None and instance.has_claims:
            changed = [f for f in LOCKED_WHEN_CLAIMED if f in attrs and attrs[f] != getattr(instance, f)]
            # Only fields actually sent count (a partial update omits the rest).
            if new_benefit is not None and any(v != (cur_benefit or {}).get(k) for k, v in new_benefit.items()):
                changed.append("benefit")
            if new_targets is not None and sorted(map(self._target_key, new_targets)) != sorted(map(self._target_key, cur_targets)):
                changed.append("products")
            if new_qty is not None and cur_qty is not None and new_qty != cur_qty:
                changed.append("qualifying quantity")
            if changed:
                raise serializers.ValidationError(
                    "Customers already hold this offer, so its rules can't change "
                    f"({', '.join(changed)}). Duplicate it to make a new version."
                )
            if "ends_at" in attrs and instance.ends_at and (attrs["ends_at"] is None or attrs["ends_at"] < instance.ends_at):
                raise serializers.ValidationError({"ends_at": "You can only extend the end date. Use End offer to stop it."})
            for field in ("max_claims", "max_redemptions"):
                if field in attrs and attrs[field] is not None:
                    floor = instance.claims_count if field == "max_claims" else instance.redemptions_count + instance.reserved_count
                    if attrs[field] < floor:
                        raise serializers.ValidationError({field: f"Can't go below {floor} already used."})

        starts = attrs.get("starts_at", getattr(instance, "starts_at", None))
        ends = attrs.get("ends_at", getattr(instance, "ends_at", None))
        if starts and ends and ends <= starts:
            raise serializers.ValidationError({"ends_at": "End must be after the start."})

        # Validate the rules as they will be after this save.
        if instance is None or new_benefit is not None or new_targets is not None:
            b = {**(cur_benefit or {}), **(new_benefit or {})}
            tlist = new_targets if new_targets is not None else cur_targets
            kind = b.get("kind")
            value = b.get("value")
            benefit_targets = [t for t in tlist if t["role"] == PromotionTarget.ROLE_BENEFIT]
            qual_targets = [t for t in tlist if t["role"] == PromotionTarget.ROLE_QUALIFYING]
            if not kind:
                raise serializers.ValidationError({"benefit": "Choose what the offer gives."})
            if kind == B.KIND_PERCENT and (value is None or not (Decimal("0") < value <= Decimal("100"))):
                raise serializers.ValidationError({"benefit": "Percentage must be between 0 and 100."})
            if kind == B.KIND_AMOUNT and (value is None or value <= 0):
                raise serializers.ValidationError({"benefit": "Enter the amount off."})
            if kind in (B.KIND_PERCENT, B.KIND_AMOUNT) and b.get("scope") == B.SCOPE_TARGETS and not benefit_targets:
                raise serializers.ValidationError({"targets": "Choose the products this discount applies to."})
            if kind in (B.KIND_FREE_ITEM, B.KIND_BXGY) and not benefit_targets:
                raise serializers.ValidationError({"targets": "Choose the free / reward item(s)."})
            if kind == B.KIND_BXGY and not qual_targets:
                raise serializers.ValidationError({"targets": "Choose what the customer must buy."})
            if kind != B.KIND_BXGY and qual_targets:
                raise serializers.ValidationError({"targets": "Qualifying products only apply to Buy X Get Y."})
            pct = b.get("reward_discount_percent", Decimal("100"))
            if not (Decimal("0") < pct <= Decimal("100")):
                raise serializers.ValidationError({"benefit": "Reward discount must be between 0 and 100%."})

        if new_targets is not None:
            self._validate_target_ownership(merchant, new_targets)
        attrs["_keep_qualifying_quantity"] = cur_qty
        return attrs

    def _validate_target_ownership(self, merchant, targets):
        from merchants.models import MenuCategory, MenuItem, MenuOption

        ids = {"menu_item": set(), "category": set(), "option": set()}
        for t in targets:
            for key in ids:
                if t.get(key):
                    ids[key].add(t[key])
        found = {
            "menu_item": set(MenuItem.objects.filter(merchant=merchant, id__in=ids["menu_item"]).values_list("id", flat=True)),
            "category": set(MenuCategory.objects.filter(merchant=merchant, id__in=ids["category"]).values_list("id", flat=True)),
            "option": set(MenuOption.objects.filter(merchant=merchant, id__in=ids["option"]).values_list("id", flat=True)),
        }
        for key in ids:
            if ids[key] - found[key]:
                raise serializers.ValidationError({"targets": "One of the selected products isn't on your menu."})

    # ── persistence ──────────────────────────────────────────────────────────

    SIMPLE_FIELDS = (
        "title", "description", "terms", "image_url", "visibility", "channels", "starts_at", "ends_at",
        "claim_valid_days", "max_claims", "max_redemptions", "per_customer_limit", "min_order_amount",
        "max_discount_amount", "exclude_discounted_items", "restore_on_cancel",
    )

    @transaction.atomic
    def create(self, validated_data):
        merchant = self.context["merchant"]
        campaign = PromotionCampaign.objects.create(
            merchant=merchant,
            currency_code=merchant.currency_code or "NPR",
            **{f: validated_data[f] for f in self.SIMPLE_FIELDS if f in validated_data},
        )
        self._write_rules(campaign, validated_data, creating=True)
        return campaign

    @transaction.atomic
    def update(self, instance, validated_data):
        for f in self.SIMPLE_FIELDS:
            if f in validated_data:
                setattr(instance, f, validated_data[f])
        instance.save()
        if "benefit" in self.initial_data or "targets" in self.initial_data or "qualifying_quantity" in self.initial_data:
            self._write_rules(instance, validated_data)
            PromotionCampaign.objects.filter(pk=instance.pk).update(version=instance.version + 1)
            instance.refresh_from_db()
        return instance

    def _write_rules(self, campaign, data, creating=False):
        if "benefit" in data:
            PromotionBenefit.objects.update_or_create(campaign=campaign, defaults=dict(data["benefit"]))
        if creating or "targets" in self.initial_data:
            campaign.targets.all().delete()
            PromotionTarget.objects.bulk_create([
                PromotionTarget(
                    campaign=campaign, role=t["role"],
                    menu_item_id=t.get("menu_item"), category_id=t.get("category"), option_id=t.get("option"),
                )
                for t in data.get("targets") or []
            ])
        kind = PromotionBenefit.objects.values_list("kind", flat=True).get(campaign=campaign)
        if "qualifying_quantity" in self.initial_data:
            quantity = data.get("qualifying_quantity") or 1
        else:
            quantity = data.get("_keep_qualifying_quantity") or 1
        campaign.conditions.all().delete()
        if kind == B.KIND_BXGY:
            PromotionCondition.objects.create(
                campaign=campaign, kind=PromotionCondition.KIND_QUALIFYING_ITEMS, quantity=quantity,
            )


class CampaignReadSerializer(serializers.ModelSerializer):
    effective_status = serializers.SerializerMethodField()
    summary = serializers.SerializerMethodField()
    conditions_text = serializers.SerializerMethodField()
    benefit = serializers.SerializerMethodField()
    targets = serializers.SerializerMethodField()
    qualifying_quantity = serializers.SerializerMethodField()
    share_path = serializers.SerializerMethodField()

    class Meta:
        model = PromotionCampaign
        fields = [
            "id", "title", "description", "terms", "image_url", "status", "effective_status",
            "visibility", "channels", "starts_at", "ends_at", "claim_valid_days",
            "max_claims", "max_redemptions", "per_customer_limit", "min_order_amount", "max_discount_amount",
            "exclude_discounted_items", "restore_on_cancel", "version", "currency_code",
            "claims_count", "reserved_count", "redemptions_count",
            "summary", "conditions_text", "benefit", "targets", "qualifying_quantity", "share_path",
            "published_at", "created_at", "updated_at",
        ]

    def get_effective_status(self, obj):
        return obj.effective_status(timezone.now())

    def get_summary(self, obj):
        return describe_benefit(obj)

    def get_conditions_text(self, obj):
        return describe_conditions(obj)

    def get_benefit(self, obj):
        b = getattr(obj, "benefit", None)
        if b is None:
            return None
        return {
            "kind": b.kind, "scope": b.scope, "value": str(b.value) if b.value is not None else None,
            "reward_quantity": b.reward_quantity, "reward_discount_percent": str(b.reward_discount_percent),
            "reward_selection": b.reward_selection, "max_applications": b.max_applications,
            "include_modifiers": b.include_modifiers,
        }

    def get_targets(self, obj):
        out = []
        for t in obj.targets.all():
            if t.menu_item_id:
                label = t.menu_item.name
            elif t.category_id:
                label = t.category.name
            else:
                label = f"{t.option.group.menu_item.name} ({t.option.name})"
            out.append({"role": t.role, "menu_item": t.menu_item_id, "category": t.category_id,
                        "option": t.option_id, "label": label})
        return out

    def get_qualifying_quantity(self, obj):
        c = next((c for c in obj.conditions.all()), None)
        return c.quantity if c else None

    def get_share_path(self, obj):
        if obj.visibility == PromotionCampaign.VISIBILITY_LINK:
            return f"/offers/{obj.id}?t={obj.link_token}"
        return f"/offers/{obj.id}"
