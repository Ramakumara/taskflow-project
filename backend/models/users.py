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

class UserLogin(BaseModel):
    email: EmailStr
    password: str
    recaptcha_token: Optional[str] = None
    


