from collections.abc import Callable
from secrets import token_urlsafe

from pwdlib import PasswordHash
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models import (
    Team,
    TeamMembership,
    User,
    WorkItem,
    WorkItemActivity,
)

JUDGE_ACCOUNTS = (
    {
        "key": "admin",
        "name": "Judge Admin",
        "email": "judge.admin@opswork.example",
        "is_admin": True,
        "role": "manager",
    },
    {
        "key": "manager",
        "name": "Judge Manager",
        "email": "judge.manager@opswork.example",
        "is_admin": False,
        "role": "manager",
    },
    {
        "key": "member",
        "name": "Judge Contributor",
        "email": "judge.member@opswork.example",
        "is_admin": False,
        "role": "member",
    },
    {
        "key": "viewer",
        "name": "Judge Viewer",
        "email": "judge.viewer@opswork.example",
        "is_admin": False,
        "role": "viewer",
    },
)

JUDGE_TEAM_NAME = "OpsWork Judge Demo"
JUDGE_TEAM_DESCRIPTION = "Sample workspace for OpsWork product evaluation."

_SAMPLE_ITEMS = (
    {
        "title": "Prepare the quarterly operations review",
        "description": "Gather team metrics and finalize the review presentation.",
        "status": "in_progress",
        "priority": "high",
        "assignee": "manager",
    },
    {
        "title": "Complete the warehouse safety checklist",
        "description": "Review open safety actions and record any follow-up work.",
        "status": "open",
        "priority": "critical",
        "assignee": "member",
    },
    {
        "title": "Resolve the delayed supplier delivery",
        "description": "Coordinate a recovery plan with the supplier and receiving team.",
        "status": "blocked",
        "priority": "high",
        "assignee": "manager",
    },
    {
        "title": "Publish the incident response guide",
        "description": "Share the updated response steps with operations staff.",
        "status": "open",
        "priority": "medium",
        "assignee": "member",
    },
    {
        "title": "Reconcile regional service requests",
        "description": "Confirm the completed requests are reflected in the weekly report.",
        "status": "resolved",
        "priority": "low",
        "assignee": "viewer",
    },
)


def seed_judge_accounts(
    db: Session,
    password_factory: Callable[[], str] = lambda: token_urlsafe(24),
) -> dict[str, str]:
    password_hasher = PasswordHash.recommended()

    try:
        team = db.scalar(select(Team).where(Team.name == JUDGE_TEAM_NAME))
        if team is None:
            team = Team(name=JUDGE_TEAM_NAME, description=JUDGE_TEAM_DESCRIPTION)
            db.add(team)
            db.flush()
        elif team.description != JUDGE_TEAM_DESCRIPTION:
            raise RuntimeError(
                f"Refusing to reuse unexpected team {JUDGE_TEAM_NAME!r}."
            )

        users: dict[str, User] = {}
        passwords: dict[str, str] = {}
        for account in JUDGE_ACCOUNTS:
            user = db.scalar(
                select(User).where(User.email == account["email"])
            )
            if user is not None and (
                user.name != account["name"]
                or user.is_admin != account["is_admin"]
            ):
                raise RuntimeError(
                    f"Refusing to change unexpected account {account['email']}."
                )

            password = password_factory()
            if user is None:
                user = User(
                    name=account["name"],
                    email=account["email"],
                    is_admin=account["is_admin"],
                    is_active=True,
                    password_hash=password_hasher.hash(password),
                )
                db.add(user)
                db.flush()
            else:
                user.is_active = True
                user.password_hash = password_hasher.hash(password)

            users[account["key"]] = user
            passwords[account["email"]] = password

            membership = db.scalar(
                select(TeamMembership).where(
                    TeamMembership.team_id == team.id,
                    TeamMembership.user_id == user.id,
                )
            )
            if membership is None:
                db.add(
                    TeamMembership(
                        team_id=team.id,
                        user_id=user.id,
                        role=account["role"],
                    )
                )
            else:
                membership.role = account["role"]

        db.flush()
        has_sample_items = db.scalar(
            select(WorkItem.id)
            .where(WorkItem.team_id == team.id)
            .limit(1)
        )
        if has_sample_items is None:
            admin = users["admin"]
            for sample in _SAMPLE_ITEMS:
                item = WorkItem(
                    title=sample["title"],
                    description=sample["description"],
                    status=sample["status"],
                    priority=sample["priority"],
                    team_id=team.id,
                    assignee_id=users[sample["assignee"]].id,
                    version=1,
                )
                db.add(item)
                db.flush()
                db.add(
                    WorkItemActivity(
                        work_item_id=item.id,
                        actor_id=admin.id,
                        action="created",
                        description="Created this work item",
                    )
                )

        db.commit()
        return passwords
    except Exception:
        db.rollback()
        raise


def revoke_judge_accounts(db: Session) -> int:
    result = db.execute(
        update(User)
        .where(User.email.in_([account["email"] for account in JUDGE_ACCOUNTS]))
        .values(is_active=False)
    )
    db.commit()
    return result.rowcount or 0
