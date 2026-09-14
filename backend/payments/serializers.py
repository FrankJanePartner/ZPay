from rest_framework import serializers
from .models import Credential, PaymentRequest

class CredentialsInput(serializers.Serializer):
    email = serializers.EmailField(max_length=150)
    password = serializers.CharField(write_only=True, trim_whitespace=False, max_length=1024)

class KeyInput(serializers.Serializer):
    name = serializers.CharField(max_length=80)

class KeyOutput(serializers.ModelSerializer):
    class Meta:
        model = Credential
        fields = ["id", "name", "prefix", "created_at", "revoked_at"]

class PaymentInput(serializers.Serializer):
    reference = serializers.CharField(max_length=128)
    # Accept integer strings only. Never accept floats for monetary values.
    amount_zatoshis = serializers.RegexField(r"^[1-9][0-9]{0,15}$")
    ttl_seconds = serializers.IntegerField(min_value=60, max_value=1800, default=1800)

    def validate_amount_zatoshis(self, value):
        amount = int(value)
        if amount > 2100000000000000:
            raise serializers.ValidationError("Amount exceeds the Zcash monetary range.")
        return amount

class PaymentOutput(serializers.ModelSerializer):
    amount_zatoshis = serializers.SerializerMethodField()
    status = serializers.ReadOnlyField()
    class Meta:
        model = PaymentRequest
        fields = ["id", "reference", "amount_zatoshis", "address", "status", "created_at", "expires_at"]
    def get_amount_zatoshis(self, obj):
        return str(obj.amount_zatoshis)
