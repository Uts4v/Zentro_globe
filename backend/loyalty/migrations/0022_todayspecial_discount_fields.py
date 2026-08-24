from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("loyalty", "0021_pointtransaction_pt_merchant_customer_idx"),
    ]

    operations = [
        migrations.AddField(
            model_name="todayspecial",
            name="discount_type",
            field=models.CharField(
                choices=[
                    ("none", "No discount"),
                    ("percentage", "Percentage"),
                    ("fixed", "Fixed amount"),
                ],
                default="none",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="todayspecial",
            name="discount_value",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Percentage (0-100) or fixed amount depending on discount_type",
                max_digits=10,
                null=True,
            ),
        ),
    ]
