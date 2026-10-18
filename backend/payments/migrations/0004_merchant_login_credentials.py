from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [("payments", "0005_deposit_memo")]

    operations = [
        migrations.AlterField(
            model_name="credential",
            name="kind",
            field=models.CharField(
                max_length=12,
                choices=[
                    ("session", "Session"),
                    ("api", "API"),
                    ("login", "Login secret"),
                    ("verified", "Verified recovery email"),
                ],
            ),
        ),
    ]
