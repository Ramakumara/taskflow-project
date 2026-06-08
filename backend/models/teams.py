from pydantic import BaseModel
from typing import Optional


class TeamCreate(BaseModel):
    team_name: str
    status: str = "active"


class TeamUpdate(BaseModel):
    team_name: Optional[str] = None
    status: Optional[str] = None
