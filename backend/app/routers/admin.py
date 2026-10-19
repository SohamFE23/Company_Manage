import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import password_hash, require_admin
from app.database import get_db
from app.models import TeamMembership, User

logger = logging.getLogger("opsflow")
router = APIRouter(prefix="/api/admin/users", tags=["Administration"])


class AdminUserCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=12, max_length=128)
    is_admin: bool = False


class AdminUserUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    is_admin: bool | None = None


class PasswordReset(BaseModel):
    password: str = Field(min_length=12, max_length=128)


class AdminUserResponse(BaseModel):
    id: int
    name: str
    email: str
    is_admin: bool
    is_active: bool
    team_count: int


class AdminUserList(BaseModel):
    items: list[AdminUserResponse]
    total: int


def _to_response(user: User, team_count: int) -> AdminUserResponse:
    return AdminUserResponse(
        id=user.id,
        name=user.name,
        email=user.email,
        is_admin=user.is_admin,
        is_active=user.is_active,
        team_count=team_count,
    )


def _team_count(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.count())
        .select_from(TeamMembership)
        .where(TeamMembership.user_id == user_id)
    ) or 0


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A user with this email address already exists.",
        ) from exc
    except Exception:
        db.rollback()
        logger.exception("Failed to persist an administrator user change")
        raise


def _get_user(db: Session, user_id: int) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return target


@router.get("", response_model=AdminUserList)
def list_users(
    search: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=25, ge=1, le=100),
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserList:
    predicates = []
    if search and search.strip():
        term = (
            search.strip()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = f"%{term}%"
        predicates.append(
            or_(
                User.name.ilike(pattern, escape="\\"),
                User.email.ilike(pattern, escape="\\"),
            )
        )

    total = db.scalar(select(func.count(User.id)).where(*predicates)) or 0
    team_count = (
        select(func.count(TeamMembership.id))
        .where(TeamMembership.user_id == User.id)
        .correlate(User)
        .scalar_subquery()
    )
    rows = db.execute(
        select(User, team_count)
        .where(*predicates)
        .order_by(User.name, User.id)
        .offset(skip)
        .limit(limit)
    ).all()

    return AdminUserList(
        items=[_to_response(target, count) for target, count in rows],
        total=total,
    )


@router.post(
    "",
    response_model=AdminUserResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_user(
    payload: AdminUserCreate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserResponse:
    email = payload.email.strip().lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A user with this email address already exists.",
        )

    target = User(
        name=payload.name,
        email=email,
        password_hash=password_hash.hash(payload.password),
        is_admin=payload.is_admin,
        is_active=True,
    )
    db.add(target)
    _commit(db)
    db.refresh(target)
    return _to_response(target, 0)


@router.patch("/{user_id}", response_model=AdminUserResponse)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AdminUserResponse:
    target = _get_user(db, user_id)
    changes = payload.model_dump(exclude_unset=True)

    for field, value in changes.items():
        if value is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{field.replace('_', ' ').capitalize()} cannot be null.",
            )

    if target.id == admin.id:
        if changes.get("is_active") is False:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "You cannot deactivate your own account.",
            )
        if changes.get("is_admin") is False:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "You cannot remove your own administrator access.",
            )

    removing_active_admin = (
        target.is_admin
        and target.is_active
        and (changes.get("is_admin") is False or changes.get("is_active") is False)
    )
    if removing_active_admin:
        active_admin_count = db.scalar(
            select(func.count(User.id)).where(
                User.is_admin.is_(True),
                User.is_active.is_(True),
            )
        ) or 0
        if active_admin_count <= 1:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "The last active administrator cannot be deactivated or demoted.",
            )

    for field, value in changes.items():
        setattr(target, field, value)
    _commit(db)
    db.refresh(target)
    return _to_response(target, _team_count(db, target.id))


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(
    user_id: int,
    payload: PasswordReset,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> None:
    target = _get_user(db, user_id)
    target.password_hash = password_hash.hash(payload.password)
    _commit(db)
