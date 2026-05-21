from pydantic import BaseModel, EmailStr, Field
from typing import Optional


class ProjectCreate(BaseModel):
    name: Optional[str] = None
    project_name: Optional[str] = None
    description: Optional[str] = None
    assigned_manager: Optional[EmailStr] = None
    owner_email: Optional[EmailStr] = None
    manager_email: Optional[EmailStr] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: str = "Planning"


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    project_name: Optional[str] = None
    description: Optional[str] = None
    assigned_manager: Optional[EmailStr] = None
    owner_email: Optional[EmailStr] = None
    manager_email: Optional[EmailStr] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None


class AssignManagerPayload(BaseModel):
    assigned_manager: EmailStr = Field(..., description="Manager email to assign")
    owner_email: Optional[EmailStr] = None
    manager_email: Optional[EmailStr] = None
