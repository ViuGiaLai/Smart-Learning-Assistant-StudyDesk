from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_device_by_credentials
from app.db.base import get_db
from app.db.models import Device
from app.schemas.device import SensorReadingOut, TelemetryAccepted, TelemetryIn
from app.services import iot

router = APIRouter(prefix="/iot", tags=["IoT ingestion"])


@router.post(
    "/telemetry",
    response_model=TelemetryAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="HTTP fallback for devices that cannot use MQTT",
    description=(
        "Requires headers `X-Device-Code` and `X-Device-Key`. "
        "MQTT is the primary transport; this endpoint is useful on restricted Wi-Fi "
        "and for integration tests."
    ),
)
async def ingest_telemetry(
    payload: TelemetryIn,
    device: Device = Depends(get_device_by_credentials),
    db: AsyncSession = Depends(get_db),
) -> TelemetryAccepted:
    result = await iot.ingest_telemetry(db, device, payload, source="http")
    return TelemetryAccepted(
        stored=result.stored,
        duplicate=result.duplicate,
        collection_enabled=result.collection_enabled,
        reading=SensorReadingOut.model_validate(result.reading) if result.reading else None,
        alerts=result.alerts,
    )
