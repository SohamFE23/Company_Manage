
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_
from sqlalchemy.orm import Session
from app.auth import get_current_user
from app.database import get_db
from app.models import WorkItem, Team, User, ActivityEvent, ActivityEvent, TeamMembership, User
from app.schemas import WorkItemCreate, WorkItemUpdate, WorkItemResponse,ActivityEventResponse

router = APIRouter(prefix="/api/work-items", tags=["Work Items"])


@router.get("", response_model=list[WorkItemResponse])
def list_work_items(
    search: str | None = None,
    status: Literal["open", "in_progress", "blocked", "resolved"] | None = None,
    priority: Literal["low", "medium", "high", "critical"] | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = select(WorkItem)

    if search:
        term = f"%{search.strip()}%"
        query = query.where(
            or_(
                WorkItem.title.ilike(term),
                WorkItem.description.ilike(term),
            )
        )

    if status:
        query = query.where(WorkItem.status == status)

    if priority:
        query = query.where(WorkItem.priority == priority)

    query = (
        query.order_by(WorkItem.updated_at.desc(), WorkItem.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    return db.scalars(query).all()


@router.post("", response_model=WorkItemResponse, status_code=201)
def create_work_item(
    payload: WorkItemCreate,
    db: Session = Depends(get_db),
):
    if not db.get(Team, payload.team_id):
        raise HTTPException(status_code=404, detail="Team not found")

    if payload.assignee_id is not None:
        if not db.get(User, payload.assignee_id):
            raise HTTPException(status_code=404, detail="Assignee not found")

    item = WorkItem(**payload.model_dump())
    db.add(item)

    try:
        db.commit()
        db.refresh(item)
        return item
    except Exception:
        db.rollback()
        raise


@router.get("/{item_id}", response_model=WorkItemResponse)
def get_work_item(item_id: int, db: Session = Depends(get_db)):
    item = db.get(WorkItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Work item not found")
    return item


@router.patch("/{item_id}", response_model=WorkItemResponse)
def update_work_item(
    item_id: int,
    payload: WorkItemUpdate,
    db: Session = Depends(get_db),
):
    item = db.get(WorkItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Work item not found")

    changes = payload.model_dump(exclude_unset=True)
    expected_version = changes.pop("expected_version")

    if item.version != expected_version:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "This item was changed by someone else. Reload it and retry.",
                "current_version": item.version,
            },
        )

    if "assignee_id" in changes and changes["assignee_id"] is not None:
        if not db.get(User, changes["assignee_id"]):
            raise HTTPException(status_code=404, detail="Assignee not found")

    # Prevent invalid or accidental workflow transitions.
    allowed_transitions = {
        "open": {"in_progress", "blocked"},
        "in_progress": {"open", "blocked", "resolved"},
        "blocked": {"open", "in_progress"},
        "resolved": {"open"},
    }

    new_status = changes.get("status")
    if new_status and new_status != item.status:
        if new_status not in allowed_transitions.get(item.status, set()):
            raise HTTPException(
                status_code=422,
                detail=f"Cannot change status from {item.status} to {new_status}",
            )

    for field, value in changes.items():
        setattr(item, field, value)

    item.version += 1

    try:
        db.commit()
        db.refresh(item)
        return item
    except Exception:
        db.rollback()
        raise

@router.get(
    "/{item_id}/activity",
    response_model=list[ActivityEventResponse],
)
def get_work_item_activity(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1. Find the work item.
    item = db.query(WorkItem).filter(
        WorkItem.id == item_id
    ).first()

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="Work item not found",
        )

    # 2. Check whether the user can access this team's item.
    if not current_user.is_admin:
        membership = db.query(TeamMembership).filter(
            TeamMembership.user_id == current_user.id,
            TeamMembership.team_id == item.team_id,
        ).first()

        if membership is None:
            raise HTTPException(
                status_code=403,
                detail="You do not have access to this work item",
            )

    # 3. Fetch activity records and the actor's name.
    rows = (
        db.query(ActivityEvent, User.name)
        .outerjoin(User, ActivityEvent.actor_id == User.id)
        .filter(ActivityEvent.work_item_id == item_id)
        .order_by(
            ActivityEvent.created_at.asc(),
            ActivityEvent.id.asc(),
        )
        .all()
    )

    # 4. Return the fields expected by the frontend.
    return [
        {
            "id": event.id,
            "action": event.action,
            "description": event.description,
            "actor_name": actor_name,
            "created_at": event.created_at,
            "old_value": event.old_value,
            "new_value": event.new_value,
        }
        for event, actor_name in rows
    ]
