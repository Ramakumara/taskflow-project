from pydantic import BaseModel, EmailStr
from typing import Optional

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None
