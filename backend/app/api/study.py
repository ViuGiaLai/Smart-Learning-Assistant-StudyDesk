from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.time import utcnow
from app.db.models import Notification, StudyPlan, StudySession
from app.schemas.study import (
    FinishSessionRequest,
    StartSessionRequest,
    StudyGoalIn,
    StudyGoalOut,
    StudyPlanCreate,
    StudyPlanOut,
    StudyPlanUpdate,
    StudySessionOut,
    StudyStatsOut,
)
from app.services.stats import get_study_stats, session_duration_seconds

router = APIRouter(tags=["Study"])


def _session_out(session: StudySession, now=None) -> StudySessionOut:
    data = StudySessionOut.model_validate(session)
    return data.model_copy(
        update={"duration_seconds": session_duration_seconds(session, now)}
    )


@router.post("/study-sessions/start", response_model=StudySessionOut, status_code=201)
async def start_session(
    payload: StartSessionRequest, user: CurrentUser, db: DbSession
) -> StudySessionOut:
    active = await db.scalar(
        select(StudySession).where(
            StudySession.user_id == user.id,
            StudySession.status.in_(["running", "paused"]),
        )
    )
    if active is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Đang có phiên học chưa kết thúc ({active.id}). Hãy kết thúc trước.",
        )

    if payload.plan_id is not None:
        plan = await db.get(StudyPlan, payload.plan_id)
        if plan is None or plan.user_id != user.id:
            raise HTTPException(status_code=404, detail="Không tìm thấy kế hoạch học")
        plan.status = "in_progress"

    now = utcnow()
    session = StudySession(
        user_id=user.id,
        plan_id=payload.plan_id,
        planned_minutes=payload.planned_minutes,
        status="running",
        started_at=now,
        last_resumed_at=now,
        accumulated_seconds=0,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _session_out(session)


@router.get("/study-sessions/active", response_model=StudySessionOut | None)
async def active_session(user: CurrentUser, db: DbSession) -> StudySessionOut | None:
    session = await db.scalar(
        select(StudySession)
        .where(
            StudySession.user_id == user.id,
            StudySession.status.in_(["running", "paused"]),
        )
        .order_by(StudySession.started_at.desc())
    )
    return _session_out(session) if session else None


@router.get("/study-sessions", response_model=list[StudySessionOut])
async def list_sessions(
    user: CurrentUser,
    db: DbSession,
    limit: int = Query(default=20, ge=1, le=100),
) -> list[StudySessionOut]:
    result = await db.execute(
        select(StudySession)
        .where(StudySession.user_id == user.id)
        .order_by(StudySession.started_at.desc())
        .limit(limit)
    )
    return [_session_out(session) for session in result.scalars().all()]


async def _get_owned_session(session_id: str, user_id: str, db) -> StudySession:
    session = await db.get(StudySession, session_id)
    if session is None or session.user_id != user_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy phiên học")
    return session


@router.post("/study-sessions/{session_id}/pause", response_model=StudySessionOut)
async def pause_session(session_id: str, user: CurrentUser, db: DbSession) -> StudySessionOut:
    session = await _get_owned_session(session_id, user.id, db)
    if session.status != "running":
        raise HTTPException(status_code=409, detail="Phiên học không ở trạng thái đang chạy")
    now = utcnow()
    session.accumulated_seconds = session_duration_seconds(session, now)
    session.last_resumed_at = None
    session.status = "paused"
    await db.commit()
    await db.refresh(session)
    return _session_out(session)


@router.post("/study-sessions/{session_id}/resume", response_model=StudySessionOut)
async def resume_session(session_id: str, user: CurrentUser, db: DbSession) -> StudySessionOut:
    session = await _get_owned_session(session_id, user.id, db)
    if session.status != "paused":
        raise HTTPException(status_code=409, detail="Phiên học không ở trạng thái tạm dừng")
    session.status = "running"
    session.last_resumed_at = utcnow()
    await db.commit()
    await db.refresh(session)
    return _session_out(session)


async def _finish(session: StudySession, cancelled: bool, db) -> StudySessionOut:
    if session.status not in {"running", "paused"}:
        raise HTTPException(status_code=409, detail="Phiên học đã kết thúc")
    now = utcnow()
    session.accumulated_seconds = session_duration_seconds(session, now)
    session.last_resumed_at = None
    session.ended_at = now
    session.status = "cancelled" if cancelled else "completed"
    if not cancelled and session.plan_id is not None:
        plan = await db.get(StudyPlan, session.plan_id)
        if plan is not None and plan.user_id == session.user_id:
            plan.status = "completed"
            plan.completed_at = now
    if not cancelled and session.accumulated_seconds >= 60:
        db.add(
            Notification(
                user_id=session.user_id,
                type="study_completed",
                title="Hoàn thành phiên học",
                content=f"Bạn đã tập trung {session.accumulated_seconds // 60} phút. "
                "Hãy nghỉ ngơi và ghi lại điều đã học được.",
            )
        )
    await db.commit()
    await db.refresh(session)
    return _session_out(session)


@router.post("/study-sessions/{session_id}/finish", response_model=StudySessionOut)
async def finish_session(
    session_id: str,
    user: CurrentUser,
    db: DbSession,
    cancelled: bool = False,
) -> StudySessionOut:
    session = await _get_owned_session(session_id, user.id, db)
    return await _finish(session, cancelled, db)


@router.post("/study-sessions/finish", response_model=StudySessionOut)
async def finish_session_by_body(
    payload: FinishSessionRequest, user: CurrentUser, db: DbSession
) -> StudySessionOut:
    """Document-compatible alias: POST /api/study-sessions/finish."""
    session = await _get_owned_session(payload.session_id, user.id, db)
    return await _finish(session, payload.cancelled, db)


@router.get("/study/stats", response_model=StudyStatsOut)
async def study_stats(user: CurrentUser, db: DbSession) -> StudyStatsOut:
    return await get_study_stats(db, user)


@router.get("/study/goal", response_model=StudyGoalOut)
async def get_goal(user: CurrentUser) -> StudyGoalOut:
    return StudyGoalOut(daily_minutes=user.daily_goal_minutes)


@router.put("/study/goal", response_model=StudyGoalOut)
async def set_goal(payload: StudyGoalIn, user: CurrentUser, db: DbSession) -> StudyGoalOut:
    user.daily_goal_minutes = payload.daily_minutes
    await db.commit()
    return StudyGoalOut(daily_minutes=user.daily_goal_minutes)


# ---------------------------------------------------------------------------
# Study plans
# ---------------------------------------------------------------------------
plans_router = APIRouter(prefix="/study-plans", tags=["Study plans"])


@plans_router.get("", response_model=list[StudyPlanOut])
async def list_plans(
    user: CurrentUser,
    db: DbSession,
    status: str | None = Query(default=None),
) -> list[StudyPlanOut]:
    query = select(StudyPlan).where(StudyPlan.user_id == user.id)
    if status:
        query = query.where(StudyPlan.status == status)
    result = await db.execute(query.order_by(StudyPlan.created_at.desc()))
    return [StudyPlanOut.model_validate(plan) for plan in result.scalars().all()]


@plans_router.post("", response_model=StudyPlanOut, status_code=201)
async def create_plan(
    payload: StudyPlanCreate, user: CurrentUser, db: DbSession
) -> StudyPlanOut:
    plan = StudyPlan(user_id=user.id, **payload.model_dump())
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return StudyPlanOut.model_validate(plan)


@plans_router.patch("/{plan_id}", response_model=StudyPlanOut)
async def update_plan(
    plan_id: str, payload: StudyPlanUpdate, user: CurrentUser, db: DbSession
) -> StudyPlanOut:
    plan = await db.get(StudyPlan, plan_id)
    if plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy kế hoạch học")
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(plan, key, value)
    if data.get("status") == "completed":
        plan.completed_at = utcnow()
    await db.commit()
    await db.refresh(plan)
    return StudyPlanOut.model_validate(plan)


@plans_router.delete("/{plan_id}", status_code=204, response_class=Response)
async def delete_plan(plan_id: str, user: CurrentUser, db: DbSession) -> Response:
    plan = await db.get(StudyPlan, plan_id)
    if plan is None or plan.user_id != user.id:
        raise HTTPException(status_code=404, detail="Không tìm thấy kế hoạch học")
    await db.delete(plan)
    await db.commit()
    return Response(status_code=204)
