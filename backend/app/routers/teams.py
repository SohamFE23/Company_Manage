from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import Team, TeamMembership, User, WorkItem
from app.permissions import (
    MANAGER_ROLES,
    TeamRole,
    require_team_role,
    role_rank,
    visible_team_ids,
)

router = APIRouter(prefix="/api/teams", tags=["Teams"])


class TeamCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class TeamUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class TeamResponse(BaseModel):
    id: int
    name: str
    description: str | None
    member_count: int
    my_role: str | None


class MemberResponse(BaseModel):
    user_id: int
    name: str
    email: str
    role: str
    is_active: bool


class MemberAdd(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    email: str = Field(min_length=3, max_length=255)
    role: TeamRole = "member"


class MemberRoleUpdate(BaseModel):
    role: TeamRole


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Conflicting change.")
    except Exception:
        db.rollback()
        raise


def _get_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")
    return team


def _name_taken(db: Session, name: str, exclude_id: int | None = None) -> bool:
    query = select(Team.id).where(func.lower(Team.name) == name.lower())
    if exclude_id is not None:
        query = query.where(Team.id != exclude_id)
    return db.scalar(query) is not None


def _team_response(db: Session, team: Team, user: User) -> TeamResponse:
    count = db.scalar(
        select(func.count())
        .select_from(TeamMembership)
        .where(TeamMembership.team_id == team.id)
    )
    role = db.scalar(
        select(TeamMembership.role).where(
            TeamMembership.team_id == team.id,
            TeamMembership.user_id == user.id,
        )
    )
    return TeamResponse(
        id=team.id,
        name=team.name,
        description=team.description,
        member_count=count or 0,
        my_role=role,
    )


def _guard_last_manager(db: Session, membership: TeamMembership) -> None:
    """A team must always keep at least one manager."""
    if role_rank(membership.role) < role_rank("manager"):
        return

    managers = db.scalar(
        select(func.count())
        .select_from(TeamMembership)
        .where(
            TeamMembership.team_id == membership.team_id,
            TeamMembership.role.in_(MANAGER_ROLES),
        )
    )
    if (managers or 0) <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A team must keep at least one manager. Promote someone else first.",
        )


@router.get("", response_model=list[TeamResponse])
def list_teams(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = select(Team).order_by(Team.name)
    ids = visible_team_ids(db, user)
    if ids is not None:
        query = query.where(Team.id.in_(ids))

    teams = db.scalars(query).all()
    counts = dict(
        db.execute(
            select(TeamMembership.team_id, func.count())
            .group_by(TeamMembership.team_id)
        ).all()
    )
    roles = dict(
        db.execute(
            select(TeamMembership.team_id, TeamMembership.role).where(
                TeamMembership.user_id == user.id
            )
        ).all()
    )

    return [
        TeamResponse(
            id=t.id,
            name=t.name,
            description=t.description,
            member_count=counts.get(t.id, 0),
            my_role=roles.get(t.id),
        )
        for t in teams
    ]


@router.post("", response_model=TeamResponse, status_code=201)
def create_team(
    payload: TeamCreate,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if _name_taken(db, payload.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "Team already exists")

    team = Team(name=payload.name, description=payload.description)
    db.add(team)
    _commit(db)
    db.refresh(team)
    return _team_response(db, team, user)


@router.get("/{team_id}", response_model=TeamResponse)
def get_team(
    team_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    require_team_role(db, user, team_id, "viewer")
    return _team_response(db, team, user)


@router.patch("/{team_id}", response_model=TeamResponse)
def update_team(
    team_id: int,
    payload: TeamUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)
    require_team_role(db, user, team_id, "manager")

    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        if changes["name"] is None:
            raise HTTPException(422, "Team name cannot be empty")
        if _name_taken(db, changes["name"], exclude_id=team.id):
            raise HTTPException(status.HTTP_409_CONFLICT, "Team already exists")

    for field, value in changes.items():
        setattr(team, field, value)

    _commit(db)
    db.refresh(team)
    return _team_response(db, team, user)


@router.delete("/{team_id}", status_code=204)
def delete_team(
    team_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    team = _get_team(db, team_id)

    has_items = db.scalar(
        select(func.count()).select_from(WorkItem).where(WorkItem.team_id == team_id)
    )
    if has_items:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This team still has work items. Move or resolve them first.",
        )

    db.query(TeamMembership).filter(TeamMembership.team_id == team_id).delete()
    db.delete(team)
    _commit(db)


# ---------------------------------------------------------------- members


@router.get("/{team_id}/members", response_model=list[MemberResponse])
def list_members(
    team_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_team(db, team_id)
    require_team_role(db, user, team_id, "viewer")

    rows = db.execute(
        select(User, TeamMembership.role)
        .join(TeamMembership, TeamMembership.user_id == User.id)
        .where(TeamMembership.team_id == team_id)
        .order_by(User.name)
    ).all()

    return [
        MemberResponse(
            user_id=u.id,
            name=u.name,
            email=u.email,
            role=role,
            is_active=u.is_active,
        )
        for u, role in rows
    ]


@router.post(
    "/{team_id}/members", response_model=MemberResponse, status_code=201
)
def add_member(
    team_id: int,
    payload: MemberAdd,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_team(db, team_id)
    require_team_role(db, user, team_id, "manager")

    target = db.scalar(
        select(User).where(User.email == payload.email.lower())
    )
    if target is None:
        raise HTTPException(404, "No user found with that email address")
    if not target.is_active:
        raise HTTPException(422, "That account is deactivated")

    exists = db.scalar(
        select(TeamMembership.id).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == target.id,
        )
    )
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already a member")

    db.add(
        TeamMembership(user_id=target.id, team_id=team_id, role=payload.role)
    )
    _commit(db)

    return MemberResponse(
        user_id=target.id,
        name=target.name,
        email=target.email,
        role=payload.role,
        is_active=target.is_active,
    )


@router.patch("/{team_id}/members/{user_id}", response_model=MemberResponse)
def change_member_role(
    team_id: int,
    user_id: int,
    payload: MemberRoleUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_team(db, team_id)
    require_team_role(db, user, team_id, "manager")

    membership = db.scalar(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
        )
    )
    if membership is None:
        raise HTTPException(404, "Member not found")

    if role_rank(payload.role) < role_rank("manager"):
        _guard_last_manager(db, membership)

    membership.role = payload.role
    _commit(db)

    target = db.get(User, user_id)
    return MemberResponse(
        user_id=target.id,
        name=target.name,
        email=target.email,
        role=membership.role,
        is_active=target.is_active,
    )


@router.delete("/{team_id}/members/{user_id}", status_code=204)
def remove_member(
    team_id: int,
    user_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _get_team(db, team_id)

    # Anyone may leave a team; removing others needs manager access.
    require_team_role(
        db, user, team_id, "viewer" if user_id == user.id else "manager"
    )

    membership = db.scalar(
        select(TeamMembership).where(
            TeamMembership.team_id == team_id,
            TeamMembership.user_id == user_id,
        )
    )
    if membership is None:
        raise HTTPException(404, "Member not found")

    _guard_last_manager(db, membership)

    # Unassign their open work in this team and bump versions so open
    # edit forms see the change as stale.
    db.execute(
        update(WorkItem)
        .where(WorkItem.team_id == team_id, WorkItem.assignee_id == user_id)
        .values(assignee_id=None, version=WorkItem.version + 1)
    )
    db.delete(membership)
    _commit(db)