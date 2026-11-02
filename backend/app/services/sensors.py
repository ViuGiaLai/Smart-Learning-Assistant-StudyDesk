from __future__ import annotations

import math


def estimate_lux(raw: int | None, max_lux: float = 1000.0, gamma: float = 2.2) -> float | None:
    """Approximate lux from a raw ESP32 ADC reading.

    An LDR + fixed resistor is *not* a calibrated lux meter. This is a
    monotonic approximation (darker -> lower value) that is good enough for
    threshold alerts. For real measurements, replace ``max_lux``/``gamma``
    with values from a phone light-meter calibration.

    The ESP32 ADC is 12-bit (0-4095) and noticeably non-linear near the rails.
    """
    if raw is None:
        return None
    clamped = max(0, min(4095, int(raw)))
    if clamped == 0:
        return 0.0
    ratio = clamped / 4095.0
    return round(max_lux * math.pow(ratio, gamma), 1)


def presence_heuristic(readings: list[bool], window: int = 3) -> bool:
    """PIR reports *motion*, not presence. Require motion in the recent window."""
    if not readings:
        return False
    recent = readings[-window:]
    return any(recent)
