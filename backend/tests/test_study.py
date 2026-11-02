from __future__ import annotations

from fastapi.testclient import TestClient


def test_full_study_session_flow(client: TestClient, auth: dict) -> None:
    started = client.post(
        "/api/study-sessions/start", json={"planned_minutes": 25}, headers=auth
    )
    assert started.status_code == 201, started.text
    session = started.json()
    assert session["status"] == "running"
    assert session["duration_seconds"] >= 0

    # Only one active session at a time.
    assert (
        client.post(
            "/api/study-sessions/start", json={"planned_minutes": 25}, headers=auth
        ).status_code
        == 409
    )

    paused = client.post(f"/api/study-sessions/{session['id']}/pause", headers=auth)
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    resumed = client.post(f"/api/study-sessions/{session['id']}/resume", headers=auth)
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "running"

    finished = client.post(f"/api/study-sessions/{session['id']}/finish", headers=auth)
    assert finished.status_code == 200
    assert finished.json()["status"] == "completed"
    assert finished.json()["ended_at"] is not None

    stats = client.get("/api/study/stats", headers=auth)
    assert stats.status_code == 200
    body = stats.json()
    assert body["today_sessions"] == 1
    assert len(body["daily"]) == 7
    assert body["daily"][-1]["sessions"] == 1
    assert body["completed_sessions"] == 1

    history = client.get("/api/study-sessions", headers=auth)
    assert history.status_code == 200
    assert len(history.json()) == 1


def test_finish_alias_accepts_session_id_in_body(client: TestClient, auth: dict) -> None:
    session = client.post(
        "/api/study-sessions/start", json={"planned_minutes": 50}, headers=auth
    ).json()
    response = client.post(
        "/api/study-sessions/finish",
        json={"session_id": session["id"]},
        headers=auth,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "completed"


def test_finishing_linked_plan_marks_it_completed(
    client: TestClient, auth: dict
) -> None:
    plan = client.post(
        "/api/study-plans", json={"title": "Linked plan"}, headers=auth
    ).json()
    session = client.post(
        "/api/study-sessions/start",
        json={"plan_id": plan["id"], "planned_minutes": 25},
        headers=auth,
    ).json()
    assert client.get("/api/study-plans", headers=auth).json()[0]["status"] == "in_progress"

    finished = client.post(f"/api/study-sessions/{session['id']}/finish", headers=auth)
    assert finished.status_code == 200

    updated = client.get("/api/study-plans", headers=auth).json()[0]
    assert updated["status"] == "completed"
    assert updated["completed_at"] is not None


def test_session_can_be_cancelled(client: TestClient, auth: dict) -> None:
    session = client.post(
        "/api/study-sessions/start", json={"planned_minutes": 25}, headers=auth
    ).json()
    response = client.post(
        "/api/study-sessions/finish",
        json={"session_id": session["id"], "cancelled": True},
        headers=auth,
    )
    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


def test_active_session_endpoint(client: TestClient, auth: dict) -> None:
    assert client.get("/api/study-sessions/active", headers=auth).json() is None
    session = client.post(
        "/api/study-sessions/start", json={"planned_minutes": 25}, headers=auth
    ).json()
    active = client.get("/api/study-sessions/active", headers=auth)
    assert active.json()["id"] == session["id"]


def test_plans_crud_and_goal(client: TestClient, auth: dict) -> None:
    created = client.post(
        "/api/study-plans",
        json={"title": "Ôn tập React Native", "planned_minutes": 60},
        headers=auth,
    )
    assert created.status_code == 201
    plan = created.json()
    assert plan["status"] == "pending"

    listed = client.get("/api/study-plans", headers=auth)
    assert len(listed.json()) == 1

    updated = client.patch(
        f"/api/study-plans/{plan['id']}",
        json={"status": "completed"},
        headers=auth,
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "completed"
    assert updated.json()["completed_at"] is not None

    stats = client.get("/api/study/stats", headers=auth)
    assert stats.json()["plans_completed"] == 1

    goal = client.put("/api/study/goal", json={"daily_minutes": 90}, headers=auth)
    assert goal.status_code == 200
    assert client.get("/api/study/goal", headers=auth).json()["daily_minutes"] == 90

    deleted = client.delete(f"/api/study-plans/{plan['id']}", headers=auth)
    assert deleted.status_code == 204


def test_plan_is_owned_by_user(client: TestClient, auth: dict) -> None:
    plan = client.post(
        "/api/study-plans", json={"title": "Private"}, headers=auth
    ).json()
    other = client.post(
        "/api/auth/register",
        json={"email": "p2@example.com", "name": "P2", "password": "password123"},
    ).json()
    headers = {"Authorization": f"Bearer {other['tokens']['access_token']}"}
    response = client.patch(
        f"/api/study-plans/{plan['id']}", json={"title": "x"}, headers=headers
    )
    assert response.status_code == 404
