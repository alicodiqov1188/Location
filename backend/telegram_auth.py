"""
Telegram Mini App initData validation.

Telegram signs the WebApp launch payload (window.Telegram.WebApp.initData)
with an HMAC-SHA256 hash derived from your bot token. Validating it
server-side is the only way to be sure a request really came from Telegram
and wasn't spoofed by someone calling your API directly.

Reference: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
"""

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


class InitDataValidationError(Exception):
    """Raised when Telegram initData is missing, malformed, or fails the hash check."""


def validate_init_data(init_data: str, bot_token: str, max_age_seconds: int = 86400) -> dict:
    """
    Validate raw `initData` string from window.Telegram.WebApp.initData.

    Returns the parsed data (including the decoded `user` dict) on success.
    Raises InitDataValidationError on any failure.
    """
    if not init_data:
        raise InitDataValidationError("initData is empty")

    try:
        parsed = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError as exc:
        raise InitDataValidationError(f"could not parse initData: {exc}") from exc

    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise InitDataValidationError("initData missing hash")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))

    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        raise InitDataValidationError("hash mismatch — data may have been tampered with")

    auth_date = parsed.get("auth_date")
    if auth_date is not None:
        age = time.time() - int(auth_date)
        if age > max_age_seconds:
            raise InitDataValidationError("initData is too old")

    if "user" in parsed:
        try:
            parsed["user"] = json.loads(parsed["user"])
        except json.JSONDecodeError as exc:
            raise InitDataValidationError(f"could not decode user field: {exc}") from exc

    return parsed
