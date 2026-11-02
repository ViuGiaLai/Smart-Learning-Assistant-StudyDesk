from __future__ import annotations

from fastapi.testclient import TestClient


def test_register_login_refresh_and_me(client: TestClient) -> None:
    register = client.post(
        "/api/auth/register",
        json={"email": "Lan@Example.com", "name": "Lan", "password": "password123"},
    )
    assert register.status_code == 201, register.text
    body = register.json()
    assert body["user"]["email"] == "lan@example.com"
    assert body["tokens"]["access_token"]
    assert body["tokens"]["expires_in"] == 3600

    duplicate = client.post(
        "/api/auth/register",
        json={"email": "lan@example.com", "name": "Lan", "password": "password123"},
    )
    assert duplicate.status_code == 409

    bad_login = client.post(
        "/api/auth/login", json={"email": "lan@example.com", "password": "wrong-password"}
    )
    assert bad_login.status_code == 401

    login = client.post(
        "/api/auth/login", json={"email": "lan@example.com", "password": "password123"}
    )
    assert login.status_code == 200
    refresh_token = login.json()["tokens"]["refresh_token"]

    refreshed = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert refreshed.status_code == 200
    new_access = refreshed.json()["access_token"]

    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_access}"})
    assert me.status_code == 200
    assert me.json()["name"] == "Lan"


def test_access_token_cannot_be_used_as_refresh_token(client: TestClient) -> None:
    register = client.post(
        "/api/auth/register",
        json={"email": "a@example.com", "name": "A", "password": "password123"},
    )
    access = register.json()["tokens"]["access_token"]
    response = client.post("/api/auth/refresh", json={"refresh_token": access})
    assert response.status_code == 401


def test_protected_endpoint_requires_token(client: TestClient) -> None:
    assert client.get("/api/devices").status_code == 401
    assert client.get("/api/devices", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_health(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
