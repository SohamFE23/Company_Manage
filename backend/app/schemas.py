
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WorkItemCreate(BaseModel):
    title: str = Field(min_length=3, max_length=200)
    description: str | None = None
    team_id: int
    assignee_id: int | None = None
    priority: Literal["low", "medium", "high", "critical"] = "medium"


class WorkItemUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = None
    assignee_id: int | None = None
    priority: Literal["low", "medium", "high", "critical"] | None = None
    status: Literal["open", "in_progress", "blocked", "resolved"] | None = None
    expected_version: int = Field(ge=1)


class WorkItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str | None
    status: str
    priority: str
    team_id: int
    assignee_id: int | None
    version: int
    created_at: datetime
    updated_at: datetime

class ActivityEventResponse(BaseModel):
    id: int
    action: str
    description: str
    actor_name: str | None = None
    created_at: datetime
    old_value: str | None = None
    new_value: str | None = None

    model_config = ConfigDict(from_attributes=True)