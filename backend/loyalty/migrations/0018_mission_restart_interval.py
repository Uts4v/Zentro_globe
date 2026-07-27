from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("loyalty", "0017_card_design_show_color_overlay"),
    ]

    operations = [
        migrations.AddField(
            model_name="mission",
            name="restart_interval",
            field=models.CharField(
                choices=[
                    ("never", "Never"),
                    ("daily", "Daily"),
                    ("weekly", "Weekly"),
                    ("monthly", "Monthly"),
                ],
                default="never",
                max_length=10,
            ),
        ),
    ]
