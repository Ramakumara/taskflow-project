from pydantic import BaseModel, EmailStr
from typing import Optional

class UserRegister(BaseModel):
    username: str
    email: EmailStr
    password: str

class AdminCreateUser(BaseModel):
    username: str
    email: EmailStr
    role: str = "user"
    password: Optional[str] = None
    manager_id: Optional[str] = None

class SuperAdminUserUpdate(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None
    status: Optional[str] = None

class SuperAdminPasswordReset(BaseModel):
    password: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    recaptcha_token: Optional[str] = None
    

class InvitationCreate(BaseModel):
    email: EmailStr
    role: str = "user"
    manager_id: Optional[str] = None


class InvitationAccept(BaseModel):
    token: str
    username: str
    password: str

