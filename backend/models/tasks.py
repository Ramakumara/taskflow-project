from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime

class TaskCreate(BaseModel):
    title: str
    project_id: str
    assigned_to: List[EmailStr]
    status: Optional[str] = "Pending"
    deadline: Optional[str] = None

class TaskUpdate(BaseModel):
    status: str
