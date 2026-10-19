import os

os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["JWT_SECRET_KEY"] = "pytest-only-secret-key-long-enough-for-test"
os.environ["APP_ENV"] = "test"

import pytest
from fastapi.testclient import TestClient

from app import models  # noqa: F401
from app.auth import create_access_token, password_hash
from app.database import Base, SessionLocal, engine, get_db
from app.models import Team, TeamMembership, User
import main

_TEST_PASSWORD_HASH = password_hash.hash("correct-test-password")


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client():
    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[get_db] = override_get_db
    with TestClient(main.app) as test_client:
        yield test_client
    main.app.dependency_overrides.clear()


@pytest.fixture
def actors():
    with SessionLocal() as db:
        admin = User(
            name="Global Admin",
            email="admin@example.test",
            password_hash=_TEST_PASSWORD_HASH,
            is_admin=True,
            is_active=True,
        )
        manager = User(
            name="Team Manager",
            email="manager@example.test",
            password_hash=_TEST_PASSWORD_HASH,
            is_active=True,
        )
        member = User(
            name="Team Member",
            email="member@example.test",
            password_hash=_TEST_PASSWORD_HASH,
            is_active=True,
        )
        viewer = User(
            name="Team Viewer",
            email="viewer@example.test",
            password_hash=_TEST_PASSWORD_HASH,
            is_active=True,
        )
        outsider = User(
            name="Outsider",
            email="outsider@example.test",
            password_hash=_TEST_PASSWORD_HASH,
            is_active=True,
        )
        team = Team(name="Operations", description="Test operations")
        db.add_all([admin, manager, member, viewer, outsider, team])
        db.flush()
        db.add_all(
            [
                TeamMembership(
                    user_id=manager.id, team_id=team.id, role="manager"
                ),
                TeamMembership(
                    user_id=member.id, team_id=team.id, role="member"
                ),
                TeamMembership(
                    user_id=viewer.id, team_id=team.id, role="viewer"
                ),
            ]
        )
        db.commit()
        users = {
            "admin": admin,
            "manager": manager,
            "member": member,
            "viewer": viewer,
            "outsider": outsider,
        }
        return {
            "team_id": team.id,
            "users": users,
            "tokens": {
                key: create_access_token(account.id)
                for key, account in users.items()
            },
        }


@pytest.fixture
def auth_headers(actors):
    return {
        key: {"Authorization": f"Bearer {token}"}
        for key, token in actors["tokens"].items()
    }
