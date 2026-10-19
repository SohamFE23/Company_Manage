def test_login_success(client, actors):
    response = client.post(
        "/api/auth/login",
        data={"username": "ADMIN@example.test", "password": "correct-test-password"},
    )

    assert response.status_code == 200
    assert response.json()["token_type"] == "bearer"


def test_login_failure(client):
    response = client.post(
        "/api/auth/login",
        data={"username": "missing@example.test", "password": "wrong-password"},
    )

    assert response.status_code == 401


def test_inactive_user_cannot_login(client, actors):
    from app.database import SessionLocal

    with SessionLocal() as db:
        account = actors["users"]["member"]
        account = db.get(type(account), account.id)
        account.is_active = False
        db.commit()

    response = client.post(
        "/api/auth/login",
        data={"username": "member@example.test", "password": "correct-test-password"},
    )

    assert response.status_code == 401


def test_protected_endpoint_rejects_missing_token(client):
    assert client.get("/api/work-items").status_code == 401


def test_login_rate_limit_after_five_failures(client):
    data = {"username": "limited@example.test", "password": "wrong-password"}
    for _ in range(5):
        assert client.post("/api/auth/login", data=data).status_code == 401

    limited = client.post("/api/auth/login", data=data)
    assert limited.status_code == 429
    assert "Retry-After" in limited.headers


def test_security_headers_are_set(client):
    response = client.get("/api/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
