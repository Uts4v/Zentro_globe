from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("loyalty", "0018_mission_restart_interval"),
        ("merchants", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="mission",
            name="linked_menu_item",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="missions",
                to="merchants.menuitem",
            ),
        ),
        migrations.AddField(
            model_name="reward",
            name="linked_menu_item",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="rewards",
                to="merchants.menuitem",
            ),
        ),
    ]
