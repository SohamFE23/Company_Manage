
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Team

router = APIRouter(prefix="/api/teams", tags=["Teams"])


class TeamCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None


class TeamResponse(BaseModel):
    id: int
    name: str
    description: str | None

    model_config = {"from_attributes": True}


@router.get("", response_model=list[TeamResponse])
def list_teams(db: Session = Depends(get_db)):
    return db.scalars(select(Team).order_by(Team.name)).all()


@router.post("", response_model=TeamResponse, status_code=201)
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
    existing = db.scalar(
        select(Team).where(Team.name == payload.name.strip())
    )
    if existing:
        raise HTTPException(status_code=409, detail="Team already exists")

    team = Team(
        name=payload.name.strip(),
        description=payload.description,
    )
    db.add(team)

    try:
        db.commit()
        db.refresh(team)
        return team
    except Exception:
        db.rollback()
        raise
