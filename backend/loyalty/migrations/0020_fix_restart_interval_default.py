from django.db import migrations, models


def fix_restart_interval(apps, schema_editor):
    Mission = apps.get_model("loyalty", "Mission")
    Mission.objects.filter(restart_interval__isnull=True).update(restart_interval="never")
    Mission.objects.filter(restart_interval="").update(restart_interval="never")


class Migration(migrations.Migration):

    dependencies = [
        ("loyalty", "0019_add_linked_menu_item"),
    ]

    operations = [
        migrations.RunPython(fix_restart_interval, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="mission",
            name="restart_interval",
            field=models.CharField(
                blank=True,
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
