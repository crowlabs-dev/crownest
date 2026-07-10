from __future__ import annotations

import asyncio
import json
import os
import random
import time
import uuid
from collections.abc import AsyncIterator, Iterable, Iterator, Mapping
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Awaitable, Callable
from urllib.parse import ParseResult, urlparse

import httpx

from crownest._errors import CrowNestApiError
from crownest._types import Json

DEFAULT_BASE_URL = "https://api.crownest.dev"
MAX_BLOCKING_COMMAND_TIMEOUT_SECONDS = 10 * 60
DEFAULT_TIMEOUT_SECONDS = MAX_BLOCKING_COMMAND_TIMEOUT_SECONDS + 60
TimeoutConfig = float | httpx.Timeout | None

try:
    _SDK_VERSION = version("crownest")
except PackageNotFoundError:
    _SDK_VERSION = "0.1.2"
_SDK_IDENTIFIER = f"crownest-python/{_SDK_VERSION}"


class SyncTransport:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        http_client: httpx.Client | None = None,
        max_retries: int = 2,
        timeout: TimeoutConfig = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._api_key = _resolve_api_key(api_key)
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries
        if max_retries < 0:
            raise ValueError("max_retries must be non-negative.")
        self._owns_client = http_client is None
        self._client = http_client or httpx.Client(timeout=timeout)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def request(
        self,
        path: str,
        *,
        method: str,
        body: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> Json:
        headers = self._headers(
            accept="application/json",
            has_json_body=body is not None,
            idempotency_key=idempotency_key,
            idempotent=idempotent,
        )
        response = _request_with_retries(
            lambda: self._client.request(
                method,
                self._url(path),
                headers=headers,
                json=body,
            ),
            can_retry=method == "GET" or "idempotency-key" in headers,
            max_retries=self._max_retries,
        )
        _raise_for_error(response)
        return response.json()

    def download(self, url: str) -> bytes:
        response = _request_with_retries(
            lambda: self._client.get(
                self._url(url),
                headers=self._headers(accept="application/octet-stream"),
            ),
            can_retry=True,
            max_retries=self._max_retries,
        )
        _raise_for_error(response)
        return response.content

    def raw(
        self,
        path: str,
        *,
        method: str,
        content: bytes,
        headers: Mapping[str, str] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
        auth: str = "api",
    ) -> httpx.Response:
        url = self._url(path)
        request_headers = self._raw_headers(
            url,
            accept="application/json",
            auth=auth,
            headers=headers,
            idempotency_key=idempotency_key,
            idempotent=idempotent,
        )
        response = _request_with_retries(
            lambda: self._client.request(
                method,
                url,
                content=content,
                headers=request_headers,
            ),
            can_retry=method == "GET" or "idempotency-key" in request_headers,
            max_retries=self._max_retries,
        )
        _raise_for_error(response)
        return response

    def stream_sse(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> Iterator[Json]:
        with self._client.stream(
            method,
            self._url(path),
            headers=self._headers(
                accept="text/event-stream",
                has_json_body=body is not None,
                idempotency_key=idempotency_key,
                idempotent=idempotent,
            ),
            json=body,
        ) as response:
            if not response.is_success:
                response.read()
            _raise_for_error(response)
            yield from parse_sse_events(response.iter_text())

    def _headers(
        self,
        *,
        accept: str,
        has_json_body: bool = False,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> dict[str, str]:
        headers = {
            "accept": accept,
            "authorization": f"Bearer {self._api_key}",
            "user-agent": _SDK_IDENTIFIER,
            "x-crownest-sdk": _SDK_IDENTIFIER,
        }
        if has_json_body:
            headers["content-type"] = "application/json"
        if idempotency_key is not None:
            headers["idempotency-key"] = idempotency_key
        elif idempotent:
            headers["idempotency-key"] = _create_idempotency_key()
        return headers

    def _raw_headers(
        self,
        url: str,
        *,
        accept: str,
        auth: str,
        headers: Mapping[str, str] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> dict[str, str]:
        request_headers = {
            "accept": accept,
            "user-agent": _SDK_IDENTIFIER,
            "x-crownest-sdk": _SDK_IDENTIFIER,
        }
        if _should_send_auth(auth, self._base_url, url):
            request_headers["authorization"] = f"Bearer {self._api_key}"
        if idempotency_key is not None:
            request_headers["idempotency-key"] = idempotency_key
        elif idempotent:
            request_headers["idempotency-key"] = _create_idempotency_key()
        request_headers.update(headers or {})
        return request_headers

    def _url(self, value: str) -> str:
        return _resolve_url(self._base_url, value)


class AsyncTransport:
    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str = DEFAULT_BASE_URL,
        http_client: httpx.AsyncClient | None = None,
        max_retries: int = 2,
        timeout: TimeoutConfig = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._api_key = _resolve_api_key(api_key)
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries
        if max_retries < 0:
            raise ValueError("max_retries must be non-negative.")
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def request(
        self,
        path: str,
        *,
        method: str,
        body: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> Json:
        headers = self._headers(
            accept="application/json",
            has_json_body=body is not None,
            idempotency_key=idempotency_key,
            idempotent=idempotent,
        )
        response = await _async_request_with_retries(
            lambda: self._client.request(
                method,
                self._url(path),
                headers=headers,
                json=body,
            ),
            can_retry=method == "GET" or "idempotency-key" in headers,
            max_retries=self._max_retries,
        )
        _raise_for_error(response)
        return response.json()

    async def download(self, url: str) -> bytes:
        response = await _async_request_with_retries(
            lambda: self._client.get(
                self._url(url),
                headers=self._headers(accept="application/octet-stream"),
            ),
            can_retry=True,
            max_retries=self._max_retries,
        )
        _raise_for_error(response)
        return response.content

    async def raw(
        self,
        path: str,
        *,
        method: str,
        content: bytes,
        headers: Mapping[str, str] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
        auth: str = "api",
    ) -> httpx.Response:
        url = self._url(path)
        request_headers = self._raw_headers(
            url,
            accept="application/json",
            auth=auth,
            headers=headers,
            idempotency_key=idempotency_key,
            idempotent=idempotent,
        )
        response = await _async_request_with_retries(
            lambda: self._client.request(
                method,
                url,
                content=content,
                headers=request_headers,
            ),
            can_retry=method == "GET" or "idempotency-key" in request_headers,
            max_retries=self._max_retries,
        )
        _raise_for_error(response)
        return response

    async def stream_sse(
        self,
        path: str,
        *,
        method: str = "GET",
        body: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> AsyncIterator[Json]:
        async with self._client.stream(
            method,
            self._url(path),
            headers=self._headers(
                accept="text/event-stream",
                has_json_body=body is not None,
                idempotency_key=idempotency_key,
                idempotent=idempotent,
            ),
            json=body,
        ) as response:
            if not response.is_success:
                await response.aread()
            _raise_for_error(response)
            async for event in parse_async_sse_events(response.aiter_text()):
                yield event

    def _headers(
        self,
        *,
        accept: str,
        has_json_body: bool = False,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> dict[str, str]:
        headers = {
            "accept": accept,
            "authorization": f"Bearer {self._api_key}",
            "user-agent": _SDK_IDENTIFIER,
            "x-crownest-sdk": _SDK_IDENTIFIER,
        }
        if has_json_body:
            headers["content-type"] = "application/json"
        if idempotency_key is not None:
            headers["idempotency-key"] = idempotency_key
        elif idempotent:
            headers["idempotency-key"] = _create_idempotency_key()
        return headers

    def _raw_headers(
        self,
        url: str,
        *,
        accept: str,
        auth: str,
        headers: Mapping[str, str] | None = None,
        idempotency_key: str | None = None,
        idempotent: bool = False,
    ) -> dict[str, str]:
        request_headers = {
            "accept": accept,
            "user-agent": _SDK_IDENTIFIER,
            "x-crownest-sdk": _SDK_IDENTIFIER,
        }
        if _should_send_auth(auth, self._base_url, url):
            request_headers["authorization"] = f"Bearer {self._api_key}"
        if idempotency_key is not None:
            request_headers["idempotency-key"] = idempotency_key
        elif idempotent:
            request_headers["idempotency-key"] = _create_idempotency_key()
        request_headers.update(headers or {})
        return request_headers

    def _url(self, value: str) -> str:
        return _resolve_url(self._base_url, value)


def parse_sse_events(chunks: Iterable[str]) -> Iterator[Json]:
    buffer = ""
    for chunk in chunks:
        buffer += chunk
        parts = buffer.split("\n\n")
        buffer = parts.pop() or ""
        for part in parts:
            payload = _parse_sse_payload(part)
            if payload is not None:
                yield payload

    payload = _parse_sse_payload(buffer)
    if payload is not None:
        yield payload


async def parse_async_sse_events(chunks: AsyncIterator[str]) -> AsyncIterator[Json]:
    buffer = ""
    async for chunk in chunks:
        buffer += chunk
        parts = buffer.split("\n\n")
        buffer = parts.pop() or ""
        for part in parts:
            payload = _parse_sse_payload(part)
            if payload is not None:
                yield payload

    payload = _parse_sse_payload(buffer)
    if payload is not None:
        yield payload


def _parse_sse_payload(event: str) -> Json | None:
    data = "\n".join(
        line.removeprefix("data:").lstrip()
        for line in event.splitlines()
        if line.startswith("data:")
    )
    if not data:
        return None
    return json.loads(data)


def _resolve_api_key(api_key: str | None) -> str:
    resolved = api_key
    if resolved is None:
        resolved = os.environ.get("CROWNEST_BEARER_TOKEN") or os.environ.get(
            "CROWNEST_API_KEY"
        )
    if not resolved:
        raise ValueError(
            "CrowNest bearer credential missing. Pass credential to CrowNest or set "
            "CROWNEST_BEARER_TOKEN. CROWNEST_API_KEY remains supported for "
            "developer API keys."
        )
    return resolved


def _raise_for_error(response: httpx.Response) -> None:
    if response.is_success:
        return

    try:
        payload = response.json()
    except Exception:
        error = {
            "code": "invalid_error_response",
            "message": (
                f"Request failed with status {response.status_code} "
                "and a non-JSON response body."
            ),
        }
    else:
        if isinstance(payload, Mapping) and isinstance(payload.get("error"), Mapping):
            error = payload["error"]
        else:
            error = {
                "code": "invalid_error_response",
                "details": {"body": payload},
                "message": (
                    f"Request failed with status {response.status_code} "
                    "and an unexpected JSON error response."
                ),
            }

    raise CrowNestApiError(
        response.status_code,
        error,
        request_id=response.headers.get("x-request-id"),
        retry_after_seconds=_retry_after_seconds(response),
    )


def _request_with_retries(
    send: Callable[[], httpx.Response],
    *,
    can_retry: bool,
    max_retries: int,
) -> httpx.Response:
    attempt = 0
    while True:
        try:
            response = send()
        except httpx.HTTPError:
            if not can_retry or attempt >= max_retries:
                raise
            time.sleep(_retry_delay_seconds(attempt))
        else:
            if (
                response.is_success
                or not can_retry
                or attempt >= max_retries
                or not _retryable_status(response.status_code)
            ):
                return response
            retry_after = _retry_after_seconds(response)
            time.sleep(
                retry_after
                if retry_after is not None
                else _retry_delay_seconds(attempt)
            )
        attempt += 1


async def _async_request_with_retries(
    send: Callable[[], Awaitable[httpx.Response]],
    *,
    can_retry: bool,
    max_retries: int,
) -> httpx.Response:
    attempt = 0
    while True:
        try:
            response = await send()
        except httpx.HTTPError:
            if not can_retry or attempt >= max_retries:
                raise
            await asyncio.sleep(_retry_delay_seconds(attempt))
        else:
            if (
                response.is_success
                or not can_retry
                or attempt >= max_retries
                or not _retryable_status(response.status_code)
            ):
                return response
            retry_after = _retry_after_seconds(response)
            await asyncio.sleep(
                retry_after
                if retry_after is not None
                else _retry_delay_seconds(attempt)
            )
        attempt += 1


def _retryable_status(status: int) -> bool:
    return status in {429, 500, 502, 503, 504}


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=timezone.utc)
        return max(0.0, (retry_at - datetime.now(timezone.utc)).total_seconds())


def _retry_delay_seconds(attempt: int) -> float:
    maximum = min(4.0, 0.25 * 2**attempt)
    return random.uniform(maximum / 2, maximum)


def _resolve_url(base_url: str, value: str) -> str:
    if value.startswith(("http://", "https://")):
        return value
    if value.startswith("/"):
        return f"{base_url}{value}"
    return f"{base_url}/{value}"


def _should_send_auth(auth: str, base_url: str, url: str) -> bool:
    if auth == "api":
        return True
    if auth == "same-origin":
        return _same_origin(base_url, url)
    if auth == "none":
        return False
    raise ValueError(f"Unsupported auth mode: {auth}")


def _same_origin(left: str, right: str) -> bool:
    left_url = urlparse(left)
    right_url = urlparse(right)
    return (
        left_url.scheme,
        left_url.hostname,
        _origin_port(left_url),
    ) == (
        right_url.scheme,
        right_url.hostname,
        _origin_port(right_url),
    )


def _origin_port(url: ParseResult) -> int | None:
    port = url.port
    if port is not None:
        return port
    return {"http": 80, "https": 443}.get(url.scheme)


def _create_idempotency_key() -> str:
    return str(uuid.uuid4())
