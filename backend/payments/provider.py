import json
from urllib.request import Request, urlopen
from urllib.error import URLError
from django.conf import settings
from rest_framework.exceptions import APIException

class WalletUnavailable(APIException):
    status_code = 503
    default_detail = "Wallet service unavailable. Retry with the same Idempotency-Key."
    default_code = "wallet_unavailable"

def allocate_address(payment):
    if not settings.WALLET_SERVICE_URL or not settings.WALLET_SERVICE_TOKEN:
        raise WalletUnavailable()
    payload = json.dumps({
        "merchant_id": str(payment.owner_id),
        "request_id": str(payment.id),
    }).encode()
    request = Request(
        settings.WALLET_SERVICE_URL.rstrip("/") + "/v1/addresses",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": "Bearer " + settings.WALLET_SERVICE_TOKEN},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:
            result = json.loads(response.read(8193))
        address = result["address"]
        # Rust must validate network/receivers with zcash_address, not this structural check.
        if (not isinstance(address, str) or not 10 <= len(address) <= 1024
                or result.get("request_id") != str(payment.id)
                or result.get("merchant_id") != str(payment.owner_id)):
            raise ValueError("Invalid wallet response")
        return address
    except (URLError, TimeoutError, ValueError, KeyError, TypeError, OSError):
        raise WalletUnavailable() from None

def send_zec(send_request):
    if not settings.WALLET_SERVICE_URL or not settings.WALLET_SERVICE_TOKEN:
        raise WalletUnavailable()

    payload = json.dumps({
        "merchant_id": str(send_request.owner_id),
        "request_id": str(send_request.id),
        "recipient_address": send_request.recipient_address,
        "amount_zatoshis": send_request.amount_zatoshis,
    }).encode()

    request = Request(
        settings.WALLET_SERVICE_URL.rstrip("/") + "/v1/send",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + settings.WALLET_SERVICE_TOKEN,
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=120) as response:
            result = json.loads(response.read(8193))

        if (
            result.get("request_id") != str(send_request.id)
            or result.get("merchant_id") != str(send_request.owner_id)
            or not isinstance(result.get("txids"), list)
            or not result["txids"]
            or not all(isinstance(txid, str) and txid for txid in result["txids"])
        ):
            raise ValueError("Invalid wallet send response")

        return result["txids"]

    except (URLError, TimeoutError, ValueError, KeyError, TypeError, OSError):
        raise WalletUnavailable() from None
