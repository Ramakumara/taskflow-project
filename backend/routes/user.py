from fastapi import APIRouter, HTTPException
from database import db
from models.users import UserRegister, UserLogin
from passlib.context import CryptContext
from auth_utils import create_access_token
from fastapi import Depends
from auth_utils import get_current_user
from jose import JWTError, jwt
import re
import requests
import os

router = APIRouter()

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

RECAPTCHA_SECRET = os.getenv("RECAPTCHA_SECRET")

def verify_recaptcha(token):
    url = "https://www.google.com/recaptcha/api/siteverify"
    data = {
        "secret": RECAPTCHA_SECRET,
        "response": token
    }
    response = requests.post(url, data=data)
    result = response.json()
    return result.get("success", False)

def validate_password(password:str):
    pattern = r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&]).{8,}$"

    if not re.match(pattern, password):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 character,\ninclude at least 1 number,\ninclude at least1 letter, \ninclude at least 1 symbol"
        )

@router.post("/register")
def register(user: UserRegister):
    existing_user = db.users.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    validate_password(user.password)
    hashed_password = pwd_context.hash(user.password)

    new_user = {
        "username": user.username,
        "email": user.email,
        "password": hashed_password,
        "role": user.role or "user"
    }

    db.users.insert_one(new_user)

    return {"message": "User registered"}


@router.post("/login")
def login(user: UserLogin):

    if not verify_recaptcha(user.recaptcha_token):
        raise HTTPException(status_code=400, detail="reCAPTCHA verification failed")

    found = db.users.find_one({"email": user.email})
    
    if not found:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    stored_password = found.get("password")

    if not stored_password:
        raise HTTPException(
            status_code=400,
            detail="This account was created with Google login. Set a password first to sign in with email and password."
        )

    if pwd_context.verify(user.password, stored_password):

        token = create_access_token({
            "email": found.get("email"),
            "role": found.get("role"),
            "username": found.get("username")
        })

        return {
            "message": "Login success",
            "access_token": token,
            "token_type": "bearer",
            "username": found.get("username"),
            "email": found.get("email"),
            "role": found.get("role")
        }

    raise HTTPException(status_code=401, detail="Invalid email or password")


@router.get("/users")
def get_users(current_user: dict = Depends(get_current_user)):

    # Allow all logged-in users
    if not current_user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    users = []

    for u in db.users.find():
        users.append({
            "email": u.get("email"),
            "username": u.get("username"),
            "role": u.get("role")
        })

    return users

@router.get("/admin/stats")
def admin_stats(current_user: dict = Depends(get_current_user)):

    if current_user["role"] != "admin":
        return {"message": "Access denied"}

    return {
        "total_users": db.users.count_documents({}),
        "total_projects": db.projects.count_documents({}),
        "total_tasks": db.tasks.count_documents({})
    }

@router.put("/users/role")
def update_role(email: str, new_role: str, current_user: dict = Depends(get_current_user)):

    if current_user["role"] != "admin":
        return {"message": "Access denied"}

    db.users.update_one(
        {"email": email},
        {"$set": {"role": new_role}}
    )

    return {"message": "Role updated"}

@router.delete("/users/{email}")
def delete_user(email: str, current_user: dict = Depends(get_current_user)):
    user = db.users.find_one({"email": current_user["email"]})
    if current_user["role"] != "admin":
        return {"message": "Access denied"}

    db.users.delete_one({"email": email})

    return {"message": "User deleted"}

@router.get("/teams")
def get_team(current_user: dict = Depends(get_current_user)):

    if current_user["role"] not in ("admin", "manager"):
        return {"message": "Access denied"}

    users = []

    for u in db.users.find():
        users.append({
            "email": u.get("email"),
            "username": u.get("username"),
            "role": u.get("role")
        })

    return users
