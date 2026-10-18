
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import WorkItem, Team, User
from app.schemas import WorkItemCreate, WorkItemUpdate, WorkItemResponse

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
