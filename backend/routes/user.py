from fastapi import APIRouter, HTTPException, Body, Query
from database import db
from models.users import UserRegister, UserLogin
from passlib.context import CryptContext
from auth_utils import create_access_token
from fastapi import Depends
from auth_utils import get_current_user
from routes.activity import record_activity
from rbac import Role, require_permission, require_roles, Permission, normalize_role, VALID_ROLES
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
        "role": Role.USER.value
    }

    db.users.insert_one(new_user)
    record_activity(new_user, "User registered", "Account", f"Role: {new_user['role']}")

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

        record_activity(found, "User logged in", "Authentication", "Successful login")

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
def admin_stats(current_user: dict = Depends(require_roles(Role.ADMIN))):

    return {
        "total_users": db.users.count_documents({}),
        "total_projects": db.projects.count_documents({}),
        "total_tasks": db.tasks.count_documents({})
    }

@router.put("/users/role")
def update_role(
    email: str,
    new_role: str = Query(None),
    payload: dict = Body(None),
    current_user: dict = Depends(require_permission(Permission.CHANGE_ROLES))
):
    requested_role = new_role or (payload or {}).get("new_role") or (payload or {}).get("role")
    if str(requested_role or "").strip().lower() not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    new_role = normalize_role(requested_role)

    target_user = db.users.find_one({"email": email})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    if target_user.get("email") == current_user.get("email") and new_role != Role.ADMIN.value:
        raise HTTPException(status_code=400, detail="Admin cannot remove their own admin role")

    db.users.update_one(
        {"email": email},
        {"$set": {"role": new_role}}
    )

    record_activity(
        current_user,
        "User role changed",
        f"User: {email}",
        f"{target_user.get('role', 'user')} -> {new_role}"
    )

    return {"message": "Role updated"}

@router.delete("/users/{email}")
def delete_user(email: str, current_user: dict = Depends(require_permission(Permission.MANAGE_USERS))):
    if email == current_user.get("email"):
        raise HTTPException(status_code=400, detail="Admin cannot delete their own account")

    target_user = db.users.find_one({"email": email})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    db.users.delete_one({"email": email})
    record_activity(current_user, "User deleted", f"User: {email}", f"Role: {target_user.get('role', 'user')}")

    return {"message": "User deleted"}

@router.get("/teams")
def get_team(current_user: dict = Depends(require_roles(Role.ADMIN, Role.MANAGER))):

    users = []

    for u in db.users.find():
        users.append({
            "email": u.get("email"),
            "username": u.get("username"),
            "role": u.get("role")
        })

    return users
