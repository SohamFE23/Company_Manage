import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    Team,
    TeamMembership,
    User,
    WorkItem,
    WorkItemActivity,
)
from app.permissions import require_team_role, visible_team_ids
from app.schemas import (
    ActivityResponse,
    WorkItemCreate,
    WorkItemList,
    WorkItemResponse,
    WorkItemUpdate,
)

logger = logging.getLogger("opsflow")
router = APIRouter(prefix="/api/work-items", tags=["Work Items"])

WorkStatus = Literal["open", "in_progress", "blocked", "resolved"]
Priority = Literal["low", "medium", "high", "critical"]

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "open": {"in_progress", "blocked"},
    "in_progress": {"open", "blocked", "resolved"},
    "blocked": {"open", "in_progress"},
    "resolved": {"open"},
}


def _label(value: str) -> str:
    return value.replace("_", " ").title()


def _active_team_member(db: Session, team_id: int, user_id: int) -> bool:
    return (
        db.scalar(
            select(TeamMembership.id)
            .join(User, User.id == TeamMembership.user_id)
            .where(
                TeamMembership.team_id == team_id,
                TeamMembership.user_id == user_id,
                User.is_active.is_(True),
            )
        )
        is not None
    )


def _get_item_response(db: Session, item_id: int) -> WorkItemResponse | None:
    row = db.execute(
        select(WorkItem, Team.name, User.name)
        .join(Team, Team.id == WorkItem.team_id)
        .outerjoin(User, User.id == WorkItem.assignee_id)
        .where(WorkItem.id == item_id)
        .execution_options(populate_existing=True)
    ).first()
    if row is None:
        return None
    item, team_name, assignee_name = row
    return WorkItemResponse(
        id=item.id,
        title=item.title,
        description=item.description,
        status=item.status,
        priority=item.priority,
        team_id=item.team_id,
        assignee_id=item.assignee_id,
        version=item.version,
        created_at=item.created_at,
        updated_at=item.updated_at,
        team_name=team_name,
        assignee_name=assignee_name,
    )


def _raise_conflict(item: WorkItem) -> None:
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "message": "This item was changed by someone else. Reload it and retry.",
            "current_version": item.version,
        },
    )


def _activity(
    item: WorkItem,
    actor: User,
    action: str,
    description: str,
    old_value: str | None = None,
    new_value: str | None = None,
) -> WorkItemActivity:
    return WorkItemActivity(
        work_item_id=item.id,
        actor_id=actor.id,
        action=action,
        description=description,
        old_value=old_value[:255] if old_value is not None else None,
        new_value=new_value[:255] if new_value is not None else None,
    )


@router.get("", response_model=WorkItemList)
def list_work_items(
    search: str | None = None,
    status_filter: WorkStatus | None = Query(default=None, alias="status"),
    priority: Priority | None = None,
    team_id: int | None = None,
    assignee_id: int | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkItemList:
    team_ids = visible_team_ids(db, user)
    if (
        team_id is not None
        and team_ids is not None
        and team_id not in team_ids
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")

    predicates = []
    if team_ids is not None:
        predicates.append(WorkItem.team_id.in_(team_ids))
    if team_id is not None:
        predicates.append(WorkItem.team_id == team_id)
    if status_filter is not None:
        predicates.append(WorkItem.status == status_filter)
    if priority is not None:
        predicates.append(WorkItem.priority == priority)
    if assignee_id is not None:
        predicates.append(WorkItem.assignee_id == assignee_id)
    if search:
        term = (
            search.strip()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        )
        pattern = f"%{term}%"
        predicates.append(
            or_(
                WorkItem.title.ilike(pattern, escape="\\"),
                WorkItem.description.ilike(pattern, escape="\\"),
            )
        )

    total = db.scalar(
        select(func.count(WorkItem.id)).where(*predicates)
    ) or 0
    rows = db.execute(
        select(WorkItem, Team.name, User.name)
        .join(Team, Team.id == WorkItem.team_id)
        .outerjoin(User, User.id == WorkItem.assignee_id)
        .where(*predicates)
        .order_by(WorkItem.updated_at.desc(), WorkItem.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()

    return WorkItemList(
        items=[
            WorkItemResponse(
                id=item.id,
                title=item.title,
                description=item.description,
                status=item.status,
                priority=item.priority,
                team_id=item.team_id,
                assignee_id=item.assignee_id,
                version=item.version,
                created_at=item.created_at,
                updated_at=item.updated_at,
                team_name=team_name,
                assignee_name=assignee_name,
            )
            for item, team_name, assignee_name in rows
        ],
        total=total,
    )


@router.post(
    "",
    response_model=WorkItemResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_work_item(
    payload: WorkItemCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkItemResponse:
    require_team_role(db, user, payload.team_id, "member")
    if db.get(Team, payload.team_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")

    if payload.assignee_id is not None and not _active_team_member(
        db, payload.team_id, payload.assignee_id
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Assignee must be an active member of the team.",
        )

    item = WorkItem(**payload.model_dump())
    db.add(item)
    try:
        db.flush()
        db.add(
            WorkItemActivity(
                work_item_id=item.id,
                actor_id=user.id,
                action="created",
                description="Created this work item",
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to create work item")
        raise

    response = _get_item_response(db, item.id)
    if response is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    return response


@router.get("/{item_id}", response_model=WorkItemResponse)
def get_work_item(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkItemResponse:
    item = db.get(WorkItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    require_team_role(db, user, item.team_id, "viewer")

    response = _get_item_response(db, item_id)
    if response is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    return response


@router.patch("/{item_id}", response_model=WorkItemResponse)
def update_work_item(
    item_id: int,
    payload: WorkItemUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> WorkItemResponse:
    item = db.get(WorkItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    require_team_role(db, user, item.team_id, "member")

    if item.version != payload.expected_version:
        _raise_conflict(item)

    supplied = payload.model_dump(
        exclude_unset=True, exclude={"expected_version"}
    )
    for field in ("title", "status", "priority"):
        if field in supplied and supplied[field] is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"{field.capitalize()} cannot be null.",
            )

    if (
        "status" in supplied
        and supplied["status"] != item.status
        and supplied["status"] not in ALLOWED_TRANSITIONS[item.status]
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Cannot change status from {item.status} to {supplied['status']}",
        )

    changes = {
        field: value
        for field, value in supplied.items()
        if value != getattr(item, field)
    }

    if (
        "assignee_id" in changes
        and changes["assignee_id"] is not None
        and not _active_team_member(db, item.team_id, changes["assignee_id"])
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Assignee must be an active member of the team.",
        )

    if not changes:
        response = _get_item_response(db, item_id)
        if response is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
        return response

    activity_rows = []
    for field, new_value in changes.items():
        old_value = getattr(item, field)
        if field == "status":
            old_label = _label(old_value)
            new_label = _label(new_value)
            activity_rows.append(
                _activity(
                    item,
                    user,
                    "status_changed",
                    f"Changed status from {old_label} to {new_label}",
                    old_label,
                    new_label,
                )
            )
        elif field == "priority":
            old_label = _label(old_value)
            new_label = _label(new_value)
            activity_rows.append(
                _activity(
                    item,
                    user,
                    "priority_changed",
                    f"Changed priority from {old_label} to {new_label}",
                    old_label,
                    new_label,
                )
            )
        elif field == "assignee_id":
            old_name = (
                db.scalar(select(User.name).where(User.id == old_value))
                if old_value is not None
                else None
            ) or "Unassigned"
            new_name = (
                db.scalar(select(User.name).where(User.id == new_value))
                if new_value is not None
                else None
            ) or "Unassigned"
            activity_rows.append(
                _activity(
                    item,
                    user,
                    "assignee_changed",
                    f"Changed assignee from {old_name} to {new_name}",
                    old_name,
                    new_name,
                )
            )
        elif field == "title":
            activity_rows.append(
                _activity(
                    item,
                    user,
                    "title_changed",
                    f"Changed title from {old_value} to {new_value}",
                    old_value,
                    new_value,
                )
            )
        elif field == "description":
            activity_rows.append(
                _activity(
                    item,
                    user,
                    "description_changed",
                    "Updated the description",
                )
            )

    try:
        result = db.execute(
            update(WorkItem)
            .where(
                WorkItem.id == item_id,
                WorkItem.version == payload.expected_version,
            )
            .values(
                **changes,
                version=WorkItem.version + 1,
                updated_at=func.now(),
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount == 0:
            db.rollback()
            latest = db.get(WorkItem, item_id)
            if latest is None:
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND, "Work item not found"
                )
            _raise_conflict(latest)

        db.add_all(activity_rows)
        db.commit()
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        logger.exception("Failed to update work item %s", item_id)
        raise

    response = _get_item_response(db, item_id)
    if response is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    return response


@router.get("/{item_id}/activity", response_model=list[ActivityResponse])
def get_work_item_activity(
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ActivityResponse]:
    item = db.get(WorkItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Work item not found")
    require_team_role(db, user, item.team_id, "viewer")

    rows = db.execute(
        select(WorkItemActivity, User.name)
        .outerjoin(User, User.id == WorkItemActivity.actor_id)
        .where(WorkItemActivity.work_item_id == item_id)
        .order_by(
            WorkItemActivity.created_at.desc(),
            WorkItemActivity.id.desc(),
        )
        .limit(100)
    ).all()
    return [
        ActivityResponse(
            id=event.id,
            action=event.action,
            description=event.description,
            actor_name=actor_name,
            old_value=event.old_value,
            new_value=event.new_value,
            created_at=event.created_at,
        )
        for event, actor_name in rows
    ]
