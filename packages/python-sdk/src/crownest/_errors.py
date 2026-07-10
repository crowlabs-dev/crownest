from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from crownest._types import ErrorCode

_RETRYABLE_CODES = {
    "rate_limited",
    "slow_down",
    "idempotency_request_in_progress",
}


class CrowNestApiError(Exception):
    """Structured API error raised for non-2xx CrowNest responses."""

    def __init__(
        self,
        status: int,
        error: Mapping[str, Any],
        *,
        request_id: str | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        self.status = status
        self.code: ErrorCode = str(error.get("code", "unknown_error"))
        self.details = error.get("details")
        self.request_id = request_id
        self.retry_after_seconds = retry_after_seconds
        self.retryable = _retryable_status(status) or self.code in _RETRYABLE_CODES
        message = str(error.get("message", f"Request failed with status {status}."))
        super().__init__(message)


def _retryable_status(status: int) -> bool:
    return status == 429 or 500 <= status <= 599
