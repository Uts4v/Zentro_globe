"""
Offers API — customer marketplace + My Offers, and the merchant campaign editor.

Mounted at /api/offers/. POS endpoints live in pos_views.py.
"""

from __future__ import annotations

import hashlib
import math
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.db.models import Exists, F, OuterRef, Prefetch, Q, Sum
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle

from merchants.models import MerchantCategory

from .engine import (
    CHANNEL_ONLINE,
    OfferError,
    claim_offer,
    evaluate_lines,
    record_view,
    release_claim,
    validate_reward_choice,
)
from .models import (
    PromotionBenefit,
    PromotionCampaign,
    PromotionCondition,
    PromotionDailyStats,
    PromotionTarget,
    VoucherClaim,
    VoucherRedemption,
)
from .serializers import (
    CampaignReadSerializer,
    CampaignWriteSerializer,
    ClaimSerializer,
    PublicOfferSerializer,
)

DEFAULT_RADIUS_KM = 25.0
MAX_RADIUS_KM = 100.0
KM_PER_DEGREE_LAT = 111.32
PAGE_MAX = 60

CAMPAIGN_PREFETCH = (
    "targets__menu_item", "targets__category", "targets__option__group__menu_item", "conditions",
)


def _scoped_throttle(scope_name):
    class _Throttle(ScopedRateThrottle):
        def allow_request(self, request, view):
            self.scope = scope_name
            self.rate = self.get_rate()
            self.num_requests, self.duration = self.parse_rate(self.rate)
            return SimpleRateThrottle.allow_request(self, request, view)

    _Throttle.__name__ = f"{scope_name.title().replace('_', '')}Throttle"
    return _Throttle


OfferClaimThrottle = _scoped_throttle("offer_claim")
OfferPreviewThrottle = _scoped_throttle("offer_preview")


def _error(exc: OfferError) -> Response:
    return Response(exc.as_response_data(), status=exc.status)


def _customer(request):
    try:
        return request.user.customer_profile
    except Exception:
        return None


def _merchant(request):
    try:
        return request.user.merchant_profile
    except Exception:
        return None


def _float(value):
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def live_public_offers(now=None):
    now = now or timezone.now()
    return (
        PromotionCampaign.objects.filter(
            status=PromotionCampaign.STATUS_PUBLISHED,
            visibility=PromotionCampaign.VISIBILITY_PUBLIC,
            is_hidden_by_admin=False,
            merchant__is_approved=True,
            benefit__isnull=False,
        )
        .filter(Q(starts_at__isnull=True) | Q(starts_at__lte=now))
        .filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))
        .filter(Q(max_claims__isnull=True) | Q(claims_count__lt=F("max_claims")))
        .select_related("merchant", "merchant__primary_category", "benefit")
        .prefetch_related(*CAMPAIGN_PREFETCH)
    )


# ── Customer: discovery ───────────────────────────────────────────────────────

@api_view(["GET"])
@permission_classes([AllowAny])
def offer_list(request):
    """
    GET /api/offers/?q=&category=&city=&area=&merchant=&lat=&lng=&radius_km=&limit=&offset=
    Public offers from approved merchants. With lat/lng: within radius, nearest first.
    """
    params = request.query_params
    qs = live_public_offers()

    q = (params.get("q") or "").strip()[:80]
    if q:
        qs = qs.filter(
            Q(title__icontains=q)
            | Q(description__icontains=q)
            | Q(merchant__business_name__icontains=q)
            | Q(merchant__primary_category__name__icontains=q)
            | Exists(PromotionTarget.objects.filter(campaign=OuterRef("pk"), menu_item__name__icontains=q))
        )
    category = (params.get("category") or "").strip()
    if category:
        qs = qs.filter(Q(merchant__primary_category__slug=category) | Q(merchant__primary_category__parent__slug=category))
    if params.get("city"):
        qs = qs.filter(merchant__city__iexact=params["city"].strip())
    if params.get("area"):
        qs = qs.filter(merchant__area__iexact=params["area"].strip())
    if params.get("merchant"):
        try:
            qs = qs.filter(merchant_id=int(params["merchant"]))
        except ValueError:
            return Response({"error": "merchant must be an id."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        limit = min(max(int(params.get("limit", 30)), 1), PAGE_MAX)
        offset = max(int(params.get("offset", 0)), 0)
    except ValueError:
        return Response({"error": "limit/offset must be numbers."}, status=status.HTTP_400_BAD_REQUEST)

    lat, lng = _float(params.get("lat")), _float(params.get("lng"))
    distances = {}
    if lat is not None and lng is not None:
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            return Response({"error": "lat/lng out of range."}, status=status.HTTP_400_BAD_REQUEST)
        radius = _float(params.get("radius_km")) or DEFAULT_RADIUS_KM
        radius = min(max(radius, 0.5), MAX_RADIUS_KM)
        lat_delta = radius / KM_PER_DEGREE_LAT
        qs = qs.filter(
            merchant__latitude__isnull=False, merchant__longitude__isnull=False,
            merchant__latitude__gte=lat - lat_delta, merchant__latitude__lte=lat + lat_delta,
        )
        cos_lat = math.cos(math.radians(lat))
        if cos_lat > 0.01:
            lng_delta = radius / (KM_PER_DEGREE_LAT * cos_lat)
            if -180 <= lng - lng_delta and lng + lng_delta <= 180:
                qs = qs.filter(merchant__longitude__gte=lng - lng_delta, merchant__longitude__lte=lng + lng_delta)
        ranked = []
        for campaign in qs[:2000]:
            d = _haversine_km(lat, lng, float(campaign.merchant.latitude), float(campaign.merchant.longitude))
            if d <= radius:
                distances[campaign.id] = d
                ranked.append(campaign)
        ranked.sort(key=lambda c: (distances[c.id], c.id))
        count = len(ranked)
        page = ranked[offset: offset + limit]
    else:
        qs = qs.order_by("-published_at", "-id")
        count = qs.count()
        page = list(qs[offset: offset + limit])

    claimed = {}
    customer = _customer(request) if request.user.is_authenticated else None
    if customer and page:
        claimed = dict(
            VoucherClaim.objects.filter(customer=customer, campaign__in=page).values_list("campaign_id", "id")
        )
    data = PublicOfferSerializer(page, many=True, context={"distances": distances, "claimed": claimed}).data
    return Response({"count": count, "results": data})


@api_view(["GET"])
@permission_classes([AllowAny])
def category_list(request):
    """GET /api/offers/categories/ — the controlled merchant taxonomy as a tree."""
    cats = list(MerchantCategory.objects.filter(is_active=True).order_by("display_order", "name"))
    children = {}
    for c in cats:
        if c.parent_id:
            children.setdefault(c.parent_id, []).append({"id": c.id, "slug": c.slug, "name": c.name, "icon": c.icon})
    return Response([
        {"id": c.id, "slug": c.slug, "name": c.name, "icon": c.icon, "children": children.get(c.id, [])}
        for c in cats if c.parent_id is None
    ])


@api_view(["GET"])
@permission_classes([AllowAny])
def area_list(request):
    """GET /api/offers/areas/ — cities/areas that currently have public offers."""
    rows = (
        live_public_offers().exclude(merchant__city="")
        .values_list("merchant__city", "merchant__area").distinct()
    )
    by_city = {}
    for city, area in rows:
        by_city.setdefault(city.strip().title(), set())
        if area:
            by_city[city.strip().title()].add(area.strip().title())
    return Response([{"city": c, "areas": sorted(a)} for c, a in sorted(by_city.items())])


def _visible_campaign(pk, request):
    try:
        campaign = (
            PromotionCampaign.objects.select_related("merchant", "merchant__primary_category", "benefit")
            .prefetch_related(*CAMPAIGN_PREFETCH).get(pk=pk)
        )
    except PromotionCampaign.DoesNotExist:
        return None
    if (
        campaign.status in (PromotionCampaign.STATUS_DRAFT, PromotionCampaign.STATUS_ARCHIVED)
        or campaign.is_hidden_by_admin
        or not campaign.merchant.is_approved
        or not hasattr(campaign, "benefit")
    ):
        return None
    if campaign.visibility == PromotionCampaign.VISIBILITY_LINK and request.query_params.get("t") != campaign.link_token:
        return None
    return campaign


@api_view(["GET"])
@permission_classes([AllowAny])
def offer_detail(request, pk):
    """GET /api/offers/<id>/[?t=<link token>] — offer detail; records a view."""
    campaign = _visible_campaign(pk, request)
    if campaign is None:
        return Response({"error": "Offer not found."}, status=status.HTTP_404_NOT_FOUND)
    customer = _customer(request) if request.user.is_authenticated else None
    claimed = {}
    if customer:
        claimed = dict(VoucherClaim.objects.filter(customer=customer, campaign=campaign).values_list("campaign_id", "id"))
    effective = campaign.effective_status()
    if effective == "active":
        viewer = (
            f"u{request.user.pk}" if request.user.is_authenticated
            else "a" + hashlib.sha256((request.META.get("REMOTE_ADDR") or "").encode()).hexdigest()[:16]
        )
        record_view(campaign, viewer)
    data = PublicOfferSerializer(campaign, context={"claimed": claimed}).data
    data["effective_status"] = effective
    data["claimable"] = campaign.is_claimable()
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([OfferClaimThrottle])
def offer_claim(request, pk):
    """POST /api/offers/<id>/claim/ {t?} — save the offer; returns the customer's code + QR."""
    customer = _customer(request)
    if customer is None:
        return Response({"error": "Only customer accounts can claim offers."}, status=status.HTTP_403_FORBIDDEN)
    if settings.OFFERS_REQUIRE_VERIFIED_PHONE and not getattr(request.user, "phone_verified", False):
        return Response(
            {"error": "Verify your phone number to claim offers.", "code": "PHONE_NOT_VERIFIED"},
            status=status.HTTP_403_FORBIDDEN,
        )
    try:
        claim, created = claim_offer(pk, customer, link_token=str(request.data.get("t") or ""))
    except OfferError as exc:
        return _error(exc)
    claim = _claims_qs().get(pk=claim.pk)
    return Response(ClaimSerializer(claim).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


# ── Customer: My Offers ───────────────────────────────────────────────────────

def _claims_qs():
    return VoucherClaim.objects.select_related(
        "campaign", "campaign__benefit", "campaign__merchant", "campaign__merchant__primary_category",
        "campaign__merchant__offer_redemption_pin",
    ).prefetch_related(
        *(f"campaign__{p}" for p in CAMPAIGN_PREFETCH),
        Prefetch("redemptions", queryset=VoucherRedemption.objects.select_related("order")),
    )


def parse_bill_amount(raw):
    """``(Decimal|None, error_response|None)`` for an optional bill amount."""
    if raw in (None, ""):
        return None, None
    try:
        amount = Decimal(str(raw))
    except (ArithmeticError, ValueError):
        amount = None
    if amount is None or not amount.is_finite() or amount <= 0 or amount > Decimal("99999999"):
        return None, Response({"error": "Enter a valid bill amount.", "code": "INVALID_BILL_AMOUNT"},
                              status=status.HTTP_400_BAD_REQUEST)
    return amount, None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([OfferClaimThrottle])
def my_offer_redeem_with_pin(request, claim_id):
    """
    POST /api/offers/mine/<id>/redeem-with-pin/ {pin, idempotency_key, bill_amount?}
    Staff type the store PIN on the customer's phone to confirm the offer.
    """
    from .pin import redeem_with_pin

    customer = _customer(request)
    amount, error = parse_bill_amount(request.data.get("bill_amount"))
    if error:
        return error
    try:
        redemption, created = redeem_with_pin(
            claim_id, customer, str(request.data.get("pin") or ""),
            idempotency_key=str(request.data.get("idempotency_key") or ""), bill_amount=amount,
        )
    except OfferError as exc:
        return _error(exc)
    claim = _claims_qs().get(pk=redemption.claim_id)
    return Response(
        {
            "redemption_id": redemption.id,
            "confirmed_at": redemption.created_at,
            "discount_amount": str(redemption.discount_amount) if redemption.discount_amount is not None else None,
            "claim": ClaimSerializer(claim).data,
        },
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_offers(request):
    """GET /api/offers/mine/?tab=available|used|expired&merchant_id="""
    customer = _customer(request)
    if customer is None:
        return Response([], status=status.HTTP_200_OK)
    now = timezone.now()
    qs = _claims_qs().filter(customer=customer)
    tab = request.query_params.get("tab", "available")
    live = Q(expires_at__isnull=True) | Q(expires_at__gt=now)
    if tab == "used":
        qs = qs.filter(status=VoucherClaim.STATUS_REDEEMED)
    elif tab == "expired":
        qs = qs.filter(
            Q(status__in=[VoucherClaim.STATUS_EXPIRED, VoucherClaim.STATUS_REVOKED])
            | (Q(status=VoucherClaim.STATUS_AVAILABLE) & ~live)
        )
    else:
        qs = qs.filter(
            Q(status=VoucherClaim.STATUS_RESERVED) | (Q(status=VoucherClaim.STATUS_AVAILABLE) & live)
        )
    if request.query_params.get("merchant_id"):
        try:
            qs = qs.filter(merchant_id=int(request.query_params["merchant_id"]))
        except ValueError:
            return Response({"error": "merchant_id must be an id."}, status=status.HTTP_400_BAD_REQUEST)
    return Response(ClaimSerializer(qs[:200], many=True).data)


def _own_claim(request, claim_id):
    customer = _customer(request)
    if customer is None:
        return None
    return _claims_qs().filter(pk=claim_id, customer=customer).first()


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_offer_detail(request, claim_id):
    claim = _own_claim(request, claim_id)
    if claim is None:
        return Response({"error": "Offer not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(ClaimSerializer(claim).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([OfferPreviewThrottle])
def my_offer_preview(request, claim_id):
    """
    POST /api/offers/mine/<id>/preview/ {items, fulfillment_type?, reward_choice?}
    What this offer gives on a basket (priced by the server; checkout re-prices).
    """
    from orders.pricing import PricingError, default_charges, mark_reward, price_request_lines

    claim = _own_claim(request, claim_id)
    if claim is None:
        return Response({"error": "Offer not found."}, status=status.HTTP_404_NOT_FOUND)
    items = request.data.get("items") or []
    if not isinstance(items, list) or not items:
        return Response({"error": "items are required."}, status=status.HTTP_400_BAD_REQUEST)
    merchant = claim.merchant
    try:
        priced = price_request_lines(merchant, items)
        if request.data.get("reward_choice"):
            row = validate_reward_choice(claim, request.data["reward_choice"])
            priced += [mark_reward(p) for p in price_request_lines(merchant, [row], key_prefix="reward")]
    except PricingError as exc:
        return Response({"error": str(exc), "code": exc.code}, status=status.HTTP_400_BAD_REQUEST)
    except OfferError as exc:
        return _error(exc)
    charges = default_charges(merchant, fulfillment_type=request.data.get("fulfillment_type"), order_type="regular")
    evaluation = evaluate_lines(claim, merchant, [p.line for p in priced], channel=CHANNEL_ONLINE, charges=charges)
    return Response(evaluation.as_dict())


# ── Merchant: campaigns ───────────────────────────────────────────────────────

def _merchant_campaigns(merchant):
    return (
        PromotionCampaign.objects.filter(merchant=merchant)
        .select_related("merchant", "benefit")
        .prefetch_related(*CAMPAIGN_PREFETCH)
    )


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def merchant_campaigns(request):
    merchant = _merchant(request)
    if merchant is None:
        return Response({"error": "Merchant account required."}, status=status.HTTP_403_FORBIDDEN)
    if request.method == "GET":
        qs = _merchant_campaigns(merchant)
        if request.query_params.get("include_archived") != "1":
            qs = qs.exclude(status=PromotionCampaign.STATUS_ARCHIVED)
        return Response(CampaignReadSerializer(qs.order_by("-created_at")[:200], many=True).data)

    ser = CampaignWriteSerializer(data=request.data, context={"merchant": merchant})
    if not ser.is_valid():
        return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
    campaign = ser.save()
    return Response(CampaignReadSerializer(_merchant_campaigns(merchant).get(pk=campaign.pk)).data,
                    status=status.HTTP_201_CREATED)


def _own_campaign(merchant, pk, *, lock=False):
    qs = _merchant_campaigns(merchant)
    if lock:
        qs = PromotionCampaign.objects.select_for_update().filter(merchant=merchant)
    return qs.filter(pk=pk).first()


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def merchant_campaign_detail(request, pk):
    merchant = _merchant(request)
    if merchant is None:
        return Response({"error": "Merchant account required."}, status=status.HTTP_403_FORBIDDEN)
    campaign = _own_campaign(merchant, pk)
    if campaign is None:
        return Response({"error": "Offer not found."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        return Response(CampaignReadSerializer(campaign).data)

    if request.method == "DELETE":
        if campaign.status != PromotionCampaign.STATUS_DRAFT or campaign.claims_count:
            return Response({"error": "Only unused drafts can be deleted. End or archive this offer instead."},
                            status=status.HTTP_400_BAD_REQUEST)
        campaign.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    with transaction.atomic():
        locked = _own_campaign(merchant, pk, lock=True)
        campaign = _merchant_campaigns(merchant).get(pk=locked.pk)
        ser = CampaignWriteSerializer(campaign, data=request.data, partial=True,
                                      context={"merchant": merchant, "instance": campaign})
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        ser.save()
    return Response(CampaignReadSerializer(_merchant_campaigns(merchant).get(pk=pk)).data)


def _duplicate(campaign) -> PromotionCampaign:
    fields = CampaignWriteSerializer.SIMPLE_FIELDS
    copy = PromotionCampaign.objects.create(
        merchant=campaign.merchant,
        currency_code=campaign.currency_code,
        **{f: getattr(campaign, f) for f in fields if f != "title"},
        title=f"{campaign.title[:113]} (copy)",
    )
    b = campaign.benefit
    PromotionBenefit.objects.create(
        campaign=copy, kind=b.kind, scope=b.scope, value=b.value, reward_quantity=b.reward_quantity,
        reward_discount_percent=b.reward_discount_percent, reward_selection=b.reward_selection,
        max_applications=b.max_applications, include_modifiers=b.include_modifiers,
    )
    PromotionCondition.objects.bulk_create([
        PromotionCondition(campaign=copy, kind=c.kind, quantity=c.quantity) for c in campaign.conditions.all()
    ])
    PromotionTarget.objects.bulk_create([
        PromotionTarget(campaign=copy, role=t.role, menu_item_id=t.menu_item_id,
                        category_id=t.category_id, option_id=t.option_id)
        for t in campaign.targets.all()
    ])
    return copy


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def merchant_campaign_action(request, pk, action):
    """POST /api/offers/merchant/campaigns/<id>/<publish|pause|resume|end|archive|duplicate>/"""
    merchant = _merchant(request)
    if merchant is None:
        return Response({"error": "Merchant account required."}, status=status.HTTP_403_FORBIDDEN)
    now = timezone.now()
    S = PromotionCampaign

    with transaction.atomic():
        campaign = _own_campaign(merchant, pk, lock=True)
        if campaign is None:
            return Response({"error": "Offer not found."}, status=status.HTTP_404_NOT_FOUND)
        campaign = _merchant_campaigns(merchant).get(pk=campaign.pk)

        if action == "duplicate":
            copy = _duplicate(campaign)
            return Response(CampaignReadSerializer(_merchant_campaigns(merchant).get(pk=copy.pk)).data,
                            status=status.HTTP_201_CREATED)

        if action in ("publish", "resume"):
            if campaign.status not in (S.STATUS_DRAFT, S.STATUS_PAUSED):
                return Response({"error": f"A {campaign.status} offer can't be published."}, status=status.HTTP_400_BAD_REQUEST)
            if not hasattr(campaign, "benefit"):
                return Response({"error": "Set what the offer gives before publishing."}, status=status.HTTP_400_BAD_REQUEST)
            if campaign.ends_at and campaign.ends_at <= now:
                return Response({"error": "The end date has passed. Extend it first."}, status=status.HTTP_400_BAD_REQUEST)
            if not merchant.is_approved:
                return Response({"error": "Your store must be approved before offers go live."},
                                status=status.HTTP_400_BAD_REQUEST)
            campaign.status = S.STATUS_PUBLISHED
            campaign.published_at = campaign.published_at or now
        elif action == "pause":
            if campaign.status != S.STATUS_PUBLISHED:
                return Response({"error": "Only live offers can be paused."}, status=status.HTTP_400_BAD_REQUEST)
            campaign.status = S.STATUS_PAUSED
        elif action == "end":
            if campaign.status not in (S.STATUS_PUBLISHED, S.STATUS_PAUSED):
                return Response({"error": "This offer isn't running."}, status=status.HTTP_400_BAD_REQUEST)
            campaign.status = S.STATUS_ENDED
        elif action == "archive":
            if campaign.status not in (S.STATUS_ENDED, S.STATUS_DRAFT):
                return Response({"error": "End the offer before archiving it."}, status=status.HTTP_400_BAD_REQUEST)
            campaign.status = S.STATUS_ARCHIVED
        else:
            return Response({"error": "Unknown action."}, status=status.HTTP_404_NOT_FOUND)
        campaign.save(update_fields=["status", "published_at", "updated_at"])

    # "Stop immediately": existing claims stop working too (the default is to
    # honour them until they expire). Reserved ones are detached from their
    # open orders first so those bills are re-priced.
    if action == "end" and str(request.data.get("revoke_claims", "")).lower() in ("1", "true", "yes"):
        for claim_id in VoucherClaim.objects.filter(
            campaign=campaign, status=VoucherClaim.STATUS_RESERVED,
        ).values_list("pk", flat=True):
            release_claim(claim_id)
        VoucherClaim.objects.filter(campaign=campaign, status=VoucherClaim.STATUS_AVAILABLE).update(
            status=VoucherClaim.STATUS_REVOKED, updated_at=timezone.now(),
        )
    return Response(CampaignReadSerializer(_merchant_campaigns(merchant).get(pk=campaign.pk)).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def merchant_campaign_stats(request, pk):
    """GET /api/offers/merchant/campaigns/<id>/stats/?days=30"""
    merchant = _merchant(request)
    if merchant is None:
        return Response({"error": "Merchant account required."}, status=status.HTTP_403_FORBIDDEN)
    campaign = PromotionCampaign.objects.filter(merchant=merchant, pk=pk).first()
    if campaign is None:
        return Response({"error": "Offer not found."}, status=status.HTTP_404_NOT_FOUND)
    try:
        days = min(max(int(request.query_params.get("days", 30)), 1), 365)
    except ValueError:
        days = 30

    stats = PromotionDailyStats.objects.filter(campaign=campaign)
    totals = stats.aggregate(
        views=Sum("views"), unique_viewers=Sum("unique_viewers"), claims=Sum("claims"),
        redemptions=Sum("redemptions"), voids=Sum("voids"), discount_total=Sum("discount_total"),
        sales_total=Sum("sales_total"), new_customers=Sum("new_customers"),
        returning_customers=Sum("returning_customers"),
    )
    totals = {k: (v or 0) for k, v in totals.items()}
    net_redemptions = max(totals["redemptions"] - totals["voids"], 0)
    applied = VoucherRedemption.objects.filter(campaign=campaign, status=VoucherRedemption.STATUS_APPLIED)

    def rate(num, den):
        return round(num / den, 4) if den else None

    measured_7 = applied.filter(returned_within_7d__isnull=False)
    measured_30 = applied.filter(returned_within_30d__isnull=False)
    since = timezone.localdate() - timedelta(days=days - 1)
    series = list(
        stats.filter(date__gte=since).order_by("date").values(
            "date", "views", "claims", "redemptions", "voids", "discount_total", "sales_total",
        )
    )
    for row in series:
        row["date"] = row["date"].isoformat()
        row["discount_total"] = str(row["discount_total"])
        row["sales_total"] = str(row["sales_total"])

    return Response({
        "campaign_id": campaign.id,
        "currency_code": campaign.currency_code,
        "views": totals["views"],
        "unique_viewers": totals["unique_viewers"],
        "claims": totals["claims"],
        "redemptions": net_redemptions,
        "voided": totals["voids"],
        "reserved_now": campaign.reserved_count,
        "claim_rate": rate(totals["claims"], totals["unique_viewers"]),
        "redemption_rate": rate(net_redemptions, totals["claims"]),
        "discount_total": str(Decimal(totals["discount_total"])),
        "sales_total": str(Decimal(totals["sales_total"])),
        "new_customers": totals["new_customers"],
        "returning_customers": totals["returning_customers"],
        "returned_within_7d_rate": rate(measured_7.filter(returned_within_7d=True).count(), measured_7.count()),
        "returned_within_30d_rate": rate(measured_30.filter(returned_within_30d=True).count(), measured_30.count()),
        "series": series,
    })


# ── Merchant: confirm offers at the counter (no POS needed) ──────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([_scoped_throttle("offer_lookup")])
def merchant_redeem_lookup(request):
    """POST /api/offers/merchant/redeem/lookup/ {code} — is this customer's code valid here?"""
    from .engine import CHANNEL_IN_STORE, check_usable
    from .pos_views import claim_card, resolve_or_error

    merchant = _merchant(request)
    if merchant is None:
        return Response({"error": "Merchant account required."}, status=status.HTTP_403_FORBIDDEN)
    claim, error = resolve_or_error(request, merchant, request.data.get("code"))
    if error:
        return error
    data = claim_card(claim)
    try:
        check_usable(claim, merchant=merchant, channel=CHANNEL_IN_STORE)
        data["evaluation"] = {"eligible": True, "reason": None}
    except OfferError as exc:
        data["evaluation"] = {"eligible": False, "reason": {"code": exc.code, "message": str(exc)}}
    return Response(data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@throttle_classes([_scoped_throttle("offer_lookup")])
def merchant_redeem_confirm(request):
    """POST /api/offers/merchant/redeem/confirm/ {code, idempotency_key, bill_amount?}"""
    from .engine import redeem_in_store
    from .pos_views import claim_card, resolve_or_error

    merchant = _merchant(request)
    if merchant is None:
        return Response({"error": "Merchant account required."}, status=status.HTTP_403_FORBIDDEN)
    amount, error = parse_bill_amount(request.data.get("bill_amount"))
    if error:
        return error
    claim, error = resolve_or_error(request, merchant, request.data.get("code"))
    if error:
        return error
    try:
        redemption, created = redeem_in_store(
            claim.pk, merchant, user=request.user,
            idempotency_key=str(request.data.get("idempotency_key") or ""),
            bill_amount=amount, confirmed_via=VoucherRedemption.CONFIRMED_DASHBOARD,
        )
    except OfferError as exc:
        return _error(exc)
    claim.refresh_from_db()
    return Response(
        {
            "redemption_id": redemption.id,
            "discount_amount": str(redemption.discount_amount) if redemption.discount_amount is not None else None,
            "bill_amount": str(redemption.order_subtotal) if redemption.order_subtotal is not None else None,
            "claim": claim_card(claim),
        },
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def merchant_redemption_pin(request):
    """
    GET    /api/offers/merchant/redemption-pin/  → {enabled, updated_at}
    PUT    {pin}                                 → set / change the store PIN
    DELETE                                       → turn PIN confirmation off
    """
    from .models import MerchantRedemptionPin
    from .pin import clear_pin, set_pin

    merchant = _merchant(request)
    if merchant is None:
        return Response({"error": "Merchant account required."}, status=status.HTTP_403_FORBIDDEN)
    if request.method == "PUT":
        try:
            set_pin(merchant, request.data.get("pin"))
        except OfferError as exc:
            return _error(exc)
    elif request.method == "DELETE":
        clear_pin(merchant)
    row = MerchantRedemptionPin.objects.filter(merchant=merchant).first()
    return Response({"enabled": row is not None, "updated_at": row.updated_at if row else None})
