import re

from django.db import migrations

# (slug, name, icon, children[(slug, name, icon)])
TAXONOMY = [
    ("food-drink", "Food & Drink", "🍽️", [
        ("cafe", "Café", "☕"),
        ("restaurant", "Restaurant", "🍛"),
        ("bakery", "Bakery", "🥐"),
        ("bar-lounge", "Bar & Lounge", "🍸"),
        ("fast-food", "Fast Food", "🍔"),
        ("dessert", "Desserts & Ice Cream", "🍨"),
        ("juice-tea", "Juice & Tea", "🧋"),
    ]),
    ("beauty-wellness", "Beauty & Wellness", "💆", [
        ("salon", "Salon", "💇"),
        ("barber", "Barber", "💈"),
        ("spa", "Spa", "🧖"),
        ("fitness", "Gym & Fitness", "🏋️"),
    ]),
    ("retail", "Retail", "🛍️", [
        ("grocery", "Grocery & Mart", "🛒"),
        ("fashion", "Fashion", "👗"),
        ("electronics", "Electronics", "📱"),
        ("pharmacy", "Pharmacy", "💊"),
    ]),
    ("stay", "Hotels & Stays", "🏨", [
        ("hotel", "Hotel", "🏨"),
    ]),
    ("services", "Services", "🧰", [
        ("other-services", "Other services", "🧰"),
    ]),
]

# Free-text business_type keywords → category slug (first match wins).
KEYWORDS = [
    (("barber",), "barber"),
    (("salon", "beauty", "parlour", "parlor", "nail"), "salon"),
    (("spa", "massage"), "spa"),
    (("gym", "fitness", "yoga"), "fitness"),
    (("bakery", "cake", "patisserie"), "bakery"),
    (("cafe", "café", "coffee"), "cafe"),
    (("bar", "pub", "lounge", "brewery"), "bar-lounge"),
    (("ice cream", "dessert", "sweet"), "dessert"),
    (("juice", "tea", "boba"), "juice-tea"),
    (("burger", "fast food", "pizza", "fried chicken"), "fast-food"),
    (("restaurant", "dining", "momo", "kitchen", "food", "eatery", "diner"), "restaurant"),
    (("hotel", "resort", "lodge", "hostel", "homestay"), "hotel"),
    (("grocery", "mart", "supermarket", "store", "shop"), "grocery"),
    (("fashion", "clothing", "boutique", "apparel"), "fashion"),
    (("electronic", "mobile", "gadget"), "electronics"),
    (("pharmacy", "medical", "chemist"), "pharmacy"),
]


def seed(apps, schema_editor):
    Category = apps.get_model("merchants", "MerchantCategory")
    Merchant = apps.get_model("merchants", "MerchantProfile")

    by_slug = {}
    for p_order, (slug, name, icon, children) in enumerate(TAXONOMY):
        parent, _ = Category.objects.get_or_create(
            slug=slug, defaults={"name": name, "icon": icon, "display_order": p_order * 10},
        )
        by_slug[slug] = parent
        for c_order, (c_slug, c_name, c_icon) in enumerate(children):
            child, _ = Category.objects.get_or_create(
                slug=c_slug,
                defaults={"name": c_name, "icon": c_icon, "parent": parent,
                          "display_order": p_order * 10 + c_order + 1},
            )
            by_slug[c_slug] = child

    for merchant in Merchant.objects.filter(primary_category__isnull=True).exclude(business_type=""):
        text = merchant.business_type.lower()
        for words, slug in KEYWORDS:
            # Whole words only: "steakhouse" must not match "tea", "barbecue" not "bar".
            if any(re.search(rf"\b{re.escape(w)}s?\b", text) for w in words):
                merchant.primary_category = by_slug[slug]
                merchant.save(update_fields=["primary_category"])
                break


def unseed(apps, schema_editor):
    Merchant = apps.get_model("merchants", "MerchantProfile")
    Merchant.objects.update(primary_category=None)
    Category = apps.get_model("merchants", "MerchantCategory")
    Category.objects.filter(parent__isnull=False).delete()
    Category.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ("merchants", "0025_merchant_taxonomy"),
    ]

    operations = [
        migrations.RunPython(seed, unseed),
    ]
