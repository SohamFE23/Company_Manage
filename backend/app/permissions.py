from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import TeamMembership, User

TeamRole = Literal["manager", "member", "viewer"]

# "admin" is a legacy membership role from the seed script; treat it as manager.
ROLE_RANK = {"viewer": 0, "member": 1, "manager": 2, "admin": 2}
MANAGER_ROLES = ("manager", "admin")


def role_rank(role: str | None) -> int:
    return ROLE_RANK.get((role or "").lower(), -1)


def get_membership(
    db: Session, user_id: int, team_id: int
) -> TeamMembership | None:
    return db.scalar(
        select(TeamMembership).where(
            TeamMembership.user_id == user_id,
            TeamMembership.team_id == team_id,
        )
    )


def visible_team_ids(db: Session, user: User) -> list[int] | None:
    """None means 'all teams' (global administrator)."""
    if user.is_admin:
        return None
    return list(
        db.scalars(
            select(TeamMembership.team_id).where(
                TeamMembership.user_id == user.id
            )
        )
    )


def require_team_role(
    db: Session,
    user: User,
    team_id: int,
    minimum: TeamRole = "viewer",
) -> TeamMembership | None:
    """Global admins pass. Non-members get 404 so team existence is not leaked."""
    if user.is_admin:
        return None

    membership = get_membership(db, user.id, team_id)
    if membership is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")

    if role_rank(membership.role) < ROLE_RANK[minimum]:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"{minimum.capitalize()} access required for this team.",
        )
    return membership
