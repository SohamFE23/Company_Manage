from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WorkItemCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    title: str = Field(min_length=3, max_length=200)
    description: str | None = None
    team_id: int
    assignee_id: int | None = None
    priority: Literal["low", "medium", "high", "critical"] = "medium"


class WorkItemUpdate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

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
    team_name: str | None = None
    assignee_name: str | None = None


class WorkItemList(BaseModel):
    items: list[WorkItemResponse]
    total: int


class ActivityResponse(BaseModel):
    id: int
    action: str
    description: str
    actor_name: str | None
    old_value: str | None
    new_value: str | None
    created_at: datetime
