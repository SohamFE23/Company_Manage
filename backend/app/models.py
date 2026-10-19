
from datetime import datetime,timezone

from sqlalchemy import (
    String, Text, DateTime, ForeignKey,
    Integer, Boolean,Column, 
)
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

class ActivityEvent(Base):
    __tablename__ = "activity_events"

    id = Column(Integer, primary_key=True, index=True)

    work_item_id = Column(
        Integer,
        ForeignKey("work_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    actor_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    action = Column(String(50), nullable=False)
    description = Column(Text, nullable=False)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False,nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.now(timezone.utc)
    )



class Team(Base):
    __tablename__ = "teams"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(
        String(120), unique=True, index=True
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )


class TeamMembership(Base):
    __tablename__ = "team_memberships"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), index=True
    )
    team_id: Mapped[int] = mapped_column(
        ForeignKey("teams.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(30), default="member")


class WorkItem(Base):
    __tablename__ = "work_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="open")
    priority: Mapped[str] = mapped_column(String(30), default="medium")
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.id"), index=True)
    assignee_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
