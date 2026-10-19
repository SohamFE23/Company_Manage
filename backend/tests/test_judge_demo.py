from sqlalchemy import func, select

from app.auth import password_hash
from app.database import SessionLocal
from app.judge_demo import (
    JUDGE_ACCOUNTS,
    revoke_judge_accounts,
    seed_judge_accounts,
)
from app.models import Team, TeamMembership, User, WorkItem


def test_judge_demo_accounts_work_with_all_sample_roles(client):
    next_password = iter(
        f"Judge-Demo-Password-{index:02d}-Secure"
        for index in range(1, len(JUDGE_ACCOUNTS) + 1)
    )
    with SessionLocal() as db:
        passwords = seed_judge_accounts(db, lambda: next(next_password))
        team = db.scalar(select(Team).where(Team.name == "OpsWork Judge Demo"))
        team_id = team.id
        item_count = db.scalar(
            select(func.count()).select_from(WorkItem).where(
                WorkItem.team_id == team_id
            )
        )

    assert item_count == 5
    tokens = {}
    for account in JUDGE_ACCOUNTS:
        response = client.post(
            "/api/auth/login",
            data={
                "username": account["email"],
                "password": passwords[account["email"]],
            },
        )
        assert response.status_code == 200
        tokens[account["key"]] = response.json()["access_token"]

    admin_headers = {"Authorization": f"Bearer {tokens['admin']}"}
    manager_headers = {"Authorization": f"Bearer {tokens['manager']}"}
    member_headers = {"Authorization": f"Bearer {tokens['member']}"}
    viewer_headers = {"Authorization": f"Bearer {tokens['viewer']}"}

    assert client.get("/api/admin/users", headers=admin_headers).status_code == 200
    assert client.get("/api/admin/users", headers=manager_headers).status_code == 403
    assert (
        client.get(
            f"/api/work-items?team_id={team_id}", headers=viewer_headers
        ).json()["total"]
        == 5
    )
    assert (
        client.post(
            "/api/work-items",
            headers=viewer_headers,
            json={
                "title": "Viewer cannot create this",
                "team_id": team_id,
            },
        ).status_code
        == 403
    )
    assert (
        client.get(
            "/api/teams",
            headers=member_headers,
        ).status_code
        == 200
    )


def test_reseeding_rotates_passwords_without_duplicate_demo_data():
    generated = iter(
        f"Rotated-Judge-Password-{index:02d}-Secure"
        for index in range(1, len(JUDGE_ACCOUNTS) + 1)
    )
    with SessionLocal() as db:
        initial_passwords = seed_judge_accounts(db, lambda: next(generated))
        team_id = db.scalar(
            select(Team.id).where(Team.name == "OpsWork Judge Demo")
        )

    generated_again = iter(
        f"Second-Rotation-Password-{index:02d}-Secure"
        for index in range(1, len(JUDGE_ACCOUNTS) + 1)
    )
    with SessionLocal() as db:
        seed_judge_accounts(db, lambda: next(generated_again))
        for account in JUDGE_ACCOUNTS:
            user = db.scalar(
                select(User).where(User.email == account["email"])
            )
            assert not password_hash.verify(
                initial_passwords[account["email"]], user.password_hash
            )
        membership_count = db.scalar(
            select(func.count())
            .select_from(TeamMembership)
            .where(TeamMembership.team_id == team_id)
        )
        item_count = db.scalar(select(func.count()).select_from(WorkItem))
        team_count = db.scalar(
            select(func.count())
            .select_from(Team)
            .where(Team.name == "OpsWork Judge Demo")
        )

    assert membership_count == len(JUDGE_ACCOUNTS)
    assert item_count == 5
    assert team_count == 1

    with SessionLocal() as db:
        assert revoke_judge_accounts(db) == len(JUDGE_ACCOUNTS)
        assert all(
            not db.scalar(
                select(User.is_active).where(User.email == account["email"])
            )
            for account in JUDGE_ACCOUNTS
        )
