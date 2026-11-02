from __future__ import annotations

from datetime import UTC, datetime

UTC = UTC


def utcnow() -> datetime:
    """Naive UTC timestamp.

    Stored as naive UTC so SQLite and PostgreSQL behave identically and
    comparisons never mix aware/naive values. Serialization adds the `Z`.
    """
    return datetime.now(UTC).replace(tzinfo=None)


def to_naive_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def iso_z(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z")
