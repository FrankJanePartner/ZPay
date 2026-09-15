"""Import complete SDK snapshots; never accept deposit observations from public callers."""
import json
import re
import uuid
from datetime import datetime, timedelta, timezone as dt_timezone
from urllib.request import Request, urlopen
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import Deposit, PaymentRequest, WalletSync

MAX_ZAT = 2100000000000000

def amount(value):
    if not isinstance(value, str) or not re.fullmatch(r"0|[1-9][0-9]{0,15}", value) or int(value) > MAX_ZAT:
        raise ValueError("Invalid wallet amount")
    return int(value)

def height(value):
    if type(value) is not int or not 0 <= value <= 2**32 - 1:
        raise ValueError("Invalid wallet height")
    return value

def validate_snapshot(owner_id, data):
    if data.get("merchant_id") != str(owner_id) or data.get("network") != "main" or data.get("complete") is not True:
        raise ValueError("Invalid wallet snapshot identity or completeness")
    tip = height(data["chain_height"])
    if height(data["fully_scanned_height"]) != tip:
        raise ValueError("Incomplete wallet scan")
    totals = {key: amount(data[key]) for key in ("total_zatoshis", "spendable_zatoshis", "pending_zatoshis")}
    if totals["spendable_zatoshis"] + totals["pending_zatoshis"] > totals["total_zatoshis"]:
        raise ValueError("Inconsistent wallet totals")
    if not isinstance(data["outputs"], list):
        raise ValueError("Invalid output list")
    seen, outputs = set(), []
    for row in data["outputs"]:
        txid = row["txid"]
        pool, index = row["pool"], height(row["output_index"])
        if not isinstance(txid, str) or not re.fullmatch("[0-9a-f]{64}", txid) or type(pool) is not int or pool not in (0, 2, 3, 4):
            raise ValueError("Invalid output identity")
        identity = (txid, pool, index)
        if identity in seen:
            raise ValueError("Duplicate output in snapshot")
        seen.add(identity)
        mined = height(row["mined_height"])
        if mined > tip:
            raise ValueError("Output above scanned tip")
        address = row["address"]
        if address is not None and (not isinstance(address, str) or not 1 <= len(address) <= 1024):
            raise ValueError("Invalid output address")
        value = amount(row["amount_zatoshis"])
        if not value:
            continue
        block_time = datetime.fromtimestamp(height(row["block_time"]), tz=dt_timezone.utc)
        outputs.append(dict(txid=txid, pool=pool, output_index=index, amount_zatoshis=value,
                            address=address, mined_height=mined, block_time=block_time))
    return tip, totals, outputs

def fetch_snapshot(owner_id):
    if not settings.WALLET_SERVICE_URL or not settings.WALLET_SERVICE_TOKEN:
        raise ValueError("Wallet service not configured")
    request = Request(settings.WALLET_SERVICE_URL.rstrip("/") + "/v1/snapshot",
                      data=json.dumps({"merchant_id": str(owner_id)}).encode(),
                      headers={"Content-Type": "application/json", "Authorization": "Bearer " + settings.WALLET_SERVICE_TOKEN}, method="POST")
    with urlopen(request, timeout=135) as response:
        content = response.read(32 * 1024 * 1024 + 1)
        if len(content) > 32 * 1024 * 1024:
            raise ValueError("Wallet snapshot too large")
        return json.loads(content)

@transaction.atomic
def apply_snapshot(owner_id, data, lease):
    tip, totals, outputs = validate_snapshot(owner_id, data)
    state = WalletSync.objects.select_for_update().get(owner_id=owner_id)
    if state.lease != lease or not state.lease_until or state.lease_until <= timezone.now():
        raise ValueError("Sync lease expired")
    # Claim the lease with an UPDATE too, so SQLite also serializes concurrent writers.
    if not WalletSync.objects.filter(owner_id=owner_id, lease=lease, lease_until__gt=timezone.now()).update(lease_until=timezone.now()+timedelta(seconds=180)):
        raise ValueError("Sync lease lost")
    requests = {p.address: p for p in PaymentRequest.objects.filter(owner_id=owner_id, address__isnull=False)}
    # A complete replacement removes orphaned confirmations without losing audit history.
    Deposit.objects.filter(owner_id=owner_id, active=True).update(active=False)
    for output in outputs:
        identity = {key: output[key] for key in ("txid", "pool", "output_index")}
        previous = Deposit.objects.filter(owner_id=owner_id, **identity).first()
        if previous and (previous.amount_zatoshis != output["amount_zatoshis"] or previous.address != output["address"]):
            raise ValueError("Existing output identity changed")
        Deposit.objects.update_or_create(owner_id=owner_id, **identity,
            defaults={**output, "payment_request": requests.get(output["address"]), "active": True})
    for key, value in totals.items():
        setattr(state, key, value)
    state.chain_height, state.synced_at, state.last_error = tip, timezone.now(), ""
    state.lease, state.lease_until = None, None
    state.save()

def sync_owner(owner_id):
    WalletSync.objects.get_or_create(owner_id=owner_id)
    now, lease = timezone.now(), uuid.uuid4()
    claimed = WalletSync.objects.filter(owner_id=owner_id).filter(Q(lease_until__isnull=True) | Q(lease_until__lte=now)).update(
        lease=lease, lease_until=now+timedelta(seconds=180), last_attempt_at=now)
    if not claimed:
        return False
    try:
        apply_snapshot(owner_id, fetch_snapshot(owner_id), lease)
        return True
    except Exception:
        WalletSync.objects.filter(owner_id=owner_id, lease=lease).update(
            lease=None, lease_until=None, last_error="Wallet synchronization failed; displaying the last successful snapshot.")
        raise
