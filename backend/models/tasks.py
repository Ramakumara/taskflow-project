from pydantic import BaseModel, EmailStr
from typing import List, Optional


class TaskCreate(BaseModel):
    title: Optional[str] = None
    task_title: Optional[str] = None
    project_id: str
    description: Optional[str] = None
    due_date: Optional[str] = None
    deadline: Optional[str] = None
    priority: Optional[str] = "Medium"
    assigned_to: List[EmailStr] = []
    assigned_users: Optional[List[EmailStr]] = None
    status: Optional[str] = "Pending"
    attachments: Optional[List[str]] = None


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    title: Optional[str] = None
    task_title: Optional[str] = None
    description: Optional[str] = None
    due_date: Optional[str] = None
    deadline: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[List[EmailStr]] = None
    assigned_users: Optional[List[EmailStr]] = None


class TaskCommentCreate(BaseModel):
    content: str
