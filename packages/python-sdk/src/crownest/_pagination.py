from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator, Mapping
from typing import Generic, TypeVar, overload

from crownest._types import Json, JsonObject

T = TypeVar("T")


class Page(Generic[T]):
    """A fetched list page that can also iterate through all following pages."""

    def __init__(
        self,
        response: Mapping[str, Json],
        fetch_page: Callable[[str], "Page[T]"],
        *,
        transform: Callable[[Json], T] | None = None,
    ) -> None:
        self._response = dict(response)
        self._fetch_page = fetch_page
        convert = transform or (lambda item: item)  # type: ignore[assignment]
        raw_data = response.get("data", [])
        self.data = (
            [convert(item) for item in raw_data] if isinstance(raw_data, list) else []
        )
        self.has_more = bool(response.get("hasMore", False))
        cursor = response.get("nextCursor")
        self.next_cursor = str(cursor) if cursor is not None else None

    def next_page(self) -> "Page[T] | None":
        """Fetch the next page, or return ``None`` when this is the last page."""
        if not self.has_more:
            return None
        if self.next_cursor is None:
            raise RuntimeError("CrowNest returned hasMore=true without nextCursor.")
        return self._fetch_page(self.next_cursor)

    def __iter__(self) -> Iterator[T]:
        page: Page[T] | None = self
        seen_cursors: set[str] = set()
        while page is not None:
            yield from page.data
            if page.has_more and page.next_cursor is not None:
                if page.next_cursor in seen_cursors:
                    raise RuntimeError(
                        "CrowNest returned a repeated pagination cursor."
                    )
                seen_cursors.add(page.next_cursor)
            page = page.next_page()

    @overload
    def __getitem__(self, key: str) -> Json: ...

    @overload
    def __getitem__(self, key: int) -> T: ...

    def __getitem__(self, key: str | int) -> Json | T:
        if isinstance(key, int):
            return self.data[key]
        if key == "data":
            return self.data  # type: ignore[return-value]
        return self._response[key]

    def to_dict(self) -> JsonObject:
        """Return the first page as a response-shaped dictionary."""
        return {**self._response, "data": self.data}  # type: ignore[dict-item]

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Page):
            return self.to_dict() == other.to_dict()
        return self.to_dict() == other


class AsyncPage(Generic[T]):
    """An asynchronously fetched list page with automatic page iteration."""

    def __init__(
        self,
        response: Mapping[str, Json],
        fetch_page: Callable[[str], Awaitable["AsyncPage[T]"]],
        *,
        transform: Callable[[Json], T] | None = None,
    ) -> None:
        self._response = dict(response)
        self._fetch_page = fetch_page
        convert = transform or (lambda item: item)  # type: ignore[assignment]
        raw_data = response.get("data", [])
        self.data = (
            [convert(item) for item in raw_data] if isinstance(raw_data, list) else []
        )
        self.has_more = bool(response.get("hasMore", False))
        cursor = response.get("nextCursor")
        self.next_cursor = str(cursor) if cursor is not None else None

    async def next_page(self) -> "AsyncPage[T] | None":
        """Fetch the next page, or return ``None`` when this is the last page."""
        if not self.has_more:
            return None
        if self.next_cursor is None:
            raise RuntimeError("CrowNest returned hasMore=true without nextCursor.")
        return await self._fetch_page(self.next_cursor)

    async def __aiter__(self) -> AsyncIterator[T]:
        page: AsyncPage[T] | None = self
        seen_cursors: set[str] = set()
        while page is not None:
            for item in page.data:
                yield item
            if page.has_more and page.next_cursor is not None:
                if page.next_cursor in seen_cursors:
                    raise RuntimeError(
                        "CrowNest returned a repeated pagination cursor."
                    )
                seen_cursors.add(page.next_cursor)
            page = await page.next_page()

    @overload
    def __getitem__(self, key: str) -> Json: ...

    @overload
    def __getitem__(self, key: int) -> T: ...

    def __getitem__(self, key: str | int) -> Json | T:
        if isinstance(key, int):
            return self.data[key]
        if key == "data":
            return self.data  # type: ignore[return-value]
        return self._response[key]

    def to_dict(self) -> JsonObject:
        """Return the first page as a response-shaped dictionary."""
        return {**self._response, "data": self.data}  # type: ignore[dict-item]

    def __eq__(self, other: object) -> bool:
        if isinstance(other, AsyncPage):
            return self.to_dict() == other.to_dict()
        return self.to_dict() == other
