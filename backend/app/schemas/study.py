from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import UTCDateTime

SessionStatus = Literal["running", "paused", "completed", "cancelled"]
PlanStatus = Literal["pending", "in_progress", "completed", "cancelled"]


class StartSessionRequest(BaseModel):
    plan_id: str | None = None
    planned_minutes: int = Field(default=25, ge=1, le=240)


class FinishSessionRequest(BaseModel):
    """The document defines POST /api/study-sessions/finish without an id."""

    session_id: str
    cancelled: bool = False


class StudySessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    plan_id: str | None
    started_at: UTCDateTime
    ended_at: UTCDateTime | None
    planned_minutes: int
    status: SessionStatus
    duration_seconds: int = 0
    created_at: UTCDateTime


class StudyPlanCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    scheduled_start: datetime | None = None
    planned_minutes: int = Field(default=25, ge=1, le=240)


class StudyPlanUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    scheduled_start: datetime | None = None
    planned_minutes: int | None = Field(default=None, ge=1, le=240)
    status: PlanStatus | None = None


class StudyPlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    description: str | None
    scheduled_start: UTCDateTime | None
    planned_minutes: int
    status: PlanStatus
    completed_at: UTCDateTime | None
    created_at: UTCDateTime


class DailyStat(BaseModel):
    date: str
    focused_seconds: int
    sessions: int


class StudyStatsOut(BaseModel):
    today_focused_seconds: int
    today_sessions: int
    week_focused_seconds: int
    week_sessions: int
    total_focused_seconds: int
    completed_sessions: int
    plans_total: int
    plans_completed: int
    goal_completion_rate: float
    daily_goal_minutes: int
    daily: list[DailyStat]
    timezone: str


class StudyGoalIn(BaseModel):
    daily_minutes: int = Field(default=120, ge=5, le=1440)


class StudyGoalOut(BaseModel):
    daily_minutes: int
