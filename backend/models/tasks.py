from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class TaskCreate(BaseModel):
    title: str
    project_id: str
    assigned_to: EmailStr
    status: Optional[str] = "todo"
    deadline: Optional[str] = None

class TaskUpdate(BaseModel):
    status: str
