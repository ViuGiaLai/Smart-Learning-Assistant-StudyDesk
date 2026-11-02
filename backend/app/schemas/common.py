from __future__ import annotations

from datetime import datetime
from typing import Annotated

from pydantic import PlainSerializer

from app.core.time import iso_z

# Serialize all datetimes as ISO-8601 with an explicit UTC "Z" suffix so the
# mobile client never has to guess the timezone.
UTCDateTime = Annotated[
    datetime,
    PlainSerializer(lambda value: iso_z(value), return_type=str, when_used="json"),
]
