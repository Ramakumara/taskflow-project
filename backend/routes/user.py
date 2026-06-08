from fastapi import APIRouter, HTTPException, Body, Query, Request
from database import db
from models.users import UserRegister, UserLogin, AdminCreateUser, InvitationAccept, InvitationCreate
from passlib.context import CryptContext
from auth_utils import create_access_token, send_account_creation_email, send_invitation_email
from fastapi import Depends
from auth_utils import get_current_user
from routes.activity import record_activity, record_audit_log
from rbac import Role, require_permission, require_roles, Permission, normalize_role, VALID_ROLES
from jose import JWTError, jwt
import re
import requests
import os
import secrets
import string
from datetime import datetime, timezone
from bson import ObjectId
from taskflow_utils import add_notification, ensure_admin_team, get_user_team_id, normalize_email, scoped_user_query, serialize_team, tenant_notification_recipients, utc_now_iso
from websocket_manager import emit_realtime_event

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

def generate_temporary_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    symbols = "@$!%*#?&"

    while True:
        password = [
            secrets.choice(string.ascii_lowercase),
            secrets.choice(string.ascii_uppercase),
            secrets.choice(string.digits),
            secrets.choice(symbols)
        ]
        password.extend(secrets.choice(alphabet + symbols) for _ in range(max(length - 4, 4)))
        secrets.SystemRandom().shuffle(password)
        candidate = "".join(password[:length])
        try:
            validate_password(candidate)
            return candidate
        except HTTPException:
            continue


def serialize_user(user: dict) -> dict:
    return {
        "id": str(user.get("_id")),
        "username": user.get("username") or user.get("name") or "",
        "name": user.get("username") or user.get("name") or "",
        "email": user.get("email"),
        "role": normalize_role(user.get("role")),
        "team_id": user.get("team_id"),
        "admin_id": user.get("admin_id"),
        "manager_id": user.get("manager_id"),
        "status": user.get("status") or "active",
        "last_login": user.get("last_login"),
        "created_at": user.get("created_at"),
    }


def _current_team_or_403(current_user: dict) -> str:
    if normalize_role(current_user.get("role")) == Role.ADMIN.value:
        ensure_admin_team(current_user)
    team_id = get_user_team_id(current_user)
    if not team_id:
        raise HTTPException(status_code=403, detail="Your account is not attached to a team")
    return team_id


def _team_document(team_id: str | None) -> dict | None:
    if not team_id:
        return None
    try:
        return db.teams.find_one({"_id": ObjectId(team_id)})
    except Exception:
        return None

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
        "role": Role.USER.value,
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login": None
    }

    db.users.insert_one(new_user)
    record_activity(new_user, "User registered", "Account", f"Role: {new_user['role']}")
    for admin_email in tenant_notification_recipients(new_user, include_super_admins=True):
        add_notification(admin_email, f"New user registered: {new_user['email']}.", "New User")
    emit_realtime_event(
        {
            "type": "user.created",
            "message": f"User '{new_user['email']}' registered.",
            "data": {
                "username": new_user["username"],
                "email": new_user["email"],
                "role": new_user["role"],
            },
        },
        recipients=tenant_notification_recipients(new_user, include_super_admins=True),
    )
    return {"message": "User registered"}

@router.post("/admin/users")
async def admin_create_user(
    user: AdminCreateUser,
    current_user: dict = Depends(require_roles(Role.ADMIN, Role.SUPER_ADMIN))
):
    username = str(user.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Name is required")

    existing_user = db.users.find_one({"email": user.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")

    normalized_role = normalize_role(user.role)
    if normalized_role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail="Invalid role")
    current_role = normalize_role(current_user.get("role"))
    if normalized_role in {Role.ADMIN.value, Role.SUPER_ADMIN.value} and current_role != Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Only Super Admin can create admin accounts")
    if normalized_role == Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Super Admin accounts must be provisioned directly by the platform owner")
    if current_role == Role.ADMIN.value and normalized_role not in {Role.MANAGER.value, Role.USER.value}:
        raise HTTPException(status_code=403, detail="Admins can create managers and users only")

    temporary_password = (user.password or "").strip() or generate_temporary_password()
    validate_password(temporary_password)
    hashed_password = pwd_context.hash(temporary_password)

    team_id = None
    admin_id = None
    manager_id = None

    if normalized_role == Role.ADMIN.value:
        admin_id = user.email.strip().lower()
    elif current_role == Role.ADMIN.value:
        team_id = _current_team_or_403(current_user)
        admin_id = normalize_email(current_user.get("email"))
        if normalized_role == Role.USER.value and user.manager_id:
            manager = db.users.find_one({"email": normalize_email(user.manager_id), "role": Role.MANAGER.value, "team_id": team_id})
            if not manager:
                raise HTTPException(status_code=400, detail="Manager must belong to your team")
            manager_id = manager["email"]

    new_user = {
        "username": username,
        "email": user.email.strip().lower(),
        "password": hashed_password,
        "role": normalized_role,
        "team_id": team_id,
        "admin_id": admin_id,
        "manager_id": manager_id,
        "status": "active",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login": None
    }

    inserted = db.users.insert_one(new_user)
    new_user["_id"] = inserted.inserted_id
    if normalized_role == Role.ADMIN.value:
        ensure_admin_team(new_user)

    try:
        await send_account_creation_email(
            new_user["email"],
            new_user["username"],
            temporary_password,
            new_user["role"],
        )
    except Exception:
        db.users.delete_one({"_id": inserted.inserted_id})
        raise HTTPException(
            status_code=500,
            detail="User could not be created because the welcome email failed to send"
        )

    record_activity(
        current_user,
        "User created",
        f"User: {new_user['email']}",
        f"Role: {new_user['role']}"
    )
    record_audit_log(
        current_user,
        "User Created",
        f"Created {new_user['email']} with role {new_user['role']}",
    )
    for admin_email in tenant_notification_recipients(current_user, include_super_admins=True):
        add_notification(admin_email, f"User '{new_user['email']}' was created with role {new_user['role']}.", "New User")
    emit_realtime_event(
        {
            "type": "user.created",
            "message": f"User '{new_user['email']}' created.",
            "data": {
                "username": new_user["username"],
                "email": new_user["email"],
                "role": new_user["role"],
            },
        },
        recipients=tenant_notification_recipients(current_user, include_super_admins=True),
    )
    return {
        "message": "User created successfully",
        "temporary_password": temporary_password,
        "user": {
            "username": new_user["username"],
            "email": new_user["email"],
            "role": new_user["role"],
            "team_id": new_user.get("team_id"),
            "admin_id": new_user.get("admin_id"),
            "manager_id": new_user.get("manager_id"),
        }
    }


@router.post("/login")
def login(user: UserLogin):

    if not verify_recaptcha(user.recaptcha_token):
        raise HTTPException(status_code=400, detail="reCAPTCHA verification failed")

    found = db.users.find_one({"email": user.email})
    
    if not found:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if str(found.get("status") or "active").lower() == "suspended":
        raise HTTPException(status_code=403, detail="Account suspended")

    stored_password = found.get("password")

    if not stored_password:
        raise HTTPException(
            status_code=400,
            detail="This account was created with Google login. Set a password first to sign in with email and password."
        )

    if pwd_context.verify(user.password, stored_password):
        login_time = datetime.now(timezone.utc).isoformat()
        db.users.update_one(
            {"_id": found["_id"]},
            {"$set": {"last_login": login_time, "status": found.get("status") or "active"}}
        )
        found["last_login"] = login_time

        if normalize_role(found.get("role")) == Role.ADMIN.value:
            ensure_admin_team(found)

        token = create_access_token({
            "email": found.get("email"),
            "role": found.get("role"),
            "username": found.get("username"),
            "user_id": str(found.get("_id")),
            "team_id": found.get("team_id"),
            "admin_id": found.get("admin_id"),
            "manager_id": found.get("manager_id")
        })

        record_activity(found, "User logged in", "Authentication", "Successful login")
        record_audit_log(found, "Login Events", "Successful login")
        for admin_email in tenant_notification_recipients(found, include_super_admins=True):
            if admin_email != found.get("email"):
                add_notification(admin_email, f"{found.get('email')} logged in.", "Manager Activity" if found.get("role") == "manager" else "User Login")
        emit_realtime_event(
            {
                "type": "user.login",
                "message": f"{found.get('email')} logged in.",
                "data": {
                    "email": found.get("email"),
                    "role": found.get("role"),
                    "username": found.get("username"),
                },
            },
            recipients=tenant_notification_recipients(found, include_super_admins=True),
        )
        return {
            "message": "Login success",
            "access_token": token,
            "token_type": "bearer",
            "username": found.get("username"),
            "email": found.get("email"),
            "role": found.get("role"),
            "team_id": found.get("team_id"),
            "admin_id": found.get("admin_id"),
            "manager_id": found.get("manager_id"),
            "status": found.get("status") or "active"
        }

    raise HTTPException(status_code=401, detail="Invalid email or password")


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    return {
        "email": current_user.get("email"),
        "username": current_user.get("username"),
        "role": normalize_role(current_user.get("role")),
        "status": current_user.get("status") or "active",
        "team_id": current_user.get("team_id"),
        "admin_id": current_user.get("admin_id"),
        "manager_id": current_user.get("manager_id"),
        "user_id": current_user.get("user_id"),
    }


@router.get("/users")
def get_users(current_user: dict = Depends(get_current_user)):

    # Allow all logged-in users
    if not current_user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    
    users = []

    for u in db.users.find(scoped_user_query(current_user)):
        users.append(serialize_user(u))

    return users


@router.post("/logout")
def logout(current_user: dict = Depends(get_current_user)):
    record_activity(current_user, "User logged out", "Authentication", "Successful logout")
    for admin_email in tenant_notification_recipients(current_user, include_super_admins=True):
        if admin_email != current_user.get("email"):
            add_notification(admin_email, f"{current_user.get('email')} logged out.", "Manager Activity" if current_user.get("role") == "manager" else "User Logout")
    emit_realtime_event(
        {
            "type": "user.logout",
            "message": f"{current_user.get('email')} logged out.",
            "data": {
                "email": current_user.get("email"),
                "role": current_user.get("role"),
                "username": current_user.get("username"),
            },
        },
        recipients=tenant_notification_recipients(current_user, include_super_admins=True),
    )
    return {"message": "Logout success"}

@router.get("/admin/stats")
def admin_stats(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN))):
    user_query = scoped_user_query(current_user)
    project_query = {} if normalize_role(current_user.get("role")) == Role.SUPER_ADMIN.value else {"team_id": _current_team_or_403(current_user)}
    task_query = {} if normalize_role(current_user.get("role")) == Role.SUPER_ADMIN.value else {"team_id": _current_team_or_403(current_user)}

    return {
        "total_users": db.users.count_documents(user_query),
        "total_projects": db.projects.count_documents(project_query),
        "total_tasks": db.tasks.count_documents(task_query)
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
    current_role = normalize_role(current_user.get("role"))
    target_role = normalize_role(target_user.get("role"))
    if target_role == Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Admins cannot manage Super Admin accounts")
    if (target_role == Role.ADMIN.value or new_role == Role.ADMIN.value) and current_role != Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Only Super Admin can promote or demote admins")
    if new_role == Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Super Admin role cannot be assigned from this endpoint")

    if target_user.get("email") == current_user.get("email") and new_role != current_role:
        raise HTTPException(status_code=400, detail="You cannot change your own role")
    if current_role != Role.SUPER_ADMIN.value and target_user.get("team_id") != get_user_team_id(current_user):
        raise HTTPException(status_code=403, detail="You cannot manage users outside your team")

    updates = {"role": new_role}
    if new_role == Role.MANAGER.value:
        updates["manager_id"] = None
    if new_role == Role.USER.value and target_role == Role.MANAGER.value:
        updates["manager_id"] = None
    db.users.update_one({"email": email}, {"$set": updates})

    record_activity(
        current_user,
        "User role changed",
        f"User: {email}",
        f"{target_user.get('role', 'user')} -> {new_role}"
    )
    record_audit_log(
        current_user,
        "Role Changed",
        f"{email}: {target_user.get('role', 'user')} -> {new_role}",
    )
    emit_realtime_event(
        {
            "type": "user.updated",
            "message": f"User role for '{email}' updated.",
            "data": {
                "email": email,
                "role": new_role,
            },
        },
        recipients=tenant_notification_recipients(current_user, include_super_admins=True),
    )
    return {"message": "Role updated"}

@router.delete("/users/{email}")
def delete_user(email: str, current_user: dict = Depends(require_permission(Permission.MANAGE_USERS))):
    if email == current_user.get("email"):
        raise HTTPException(status_code=400, detail="Admin cannot delete their own account")

    target_user = db.users.find_one({"email": email})
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    current_role = normalize_role(current_user.get("role"))
    target_role = normalize_role(target_user.get("role"))
    if target_role == Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Admins cannot manage Super Admin accounts")
    if target_role == Role.ADMIN.value and current_role != Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Only Super Admin can delete admin accounts")
    if current_role != Role.SUPER_ADMIN.value and target_user.get("team_id") != get_user_team_id(current_user):
        raise HTTPException(status_code=403, detail="You cannot delete users outside your team")

    db.users.delete_one({"email": email})
    record_activity(current_user, "User deleted", f"User: {email}", f"Role: {target_user.get('role', 'user')}")
    record_audit_log(current_user, "User Deleted", f"Deleted {email} ({target_user.get('role', 'user')})")
    emit_realtime_event(
        {
            "type": "user.deleted",
            "message": f"User '{email}' deleted.",
            "data": {
                "email": email,
                "role": target_user.get("role", "user"),
            },
        },
        recipients=tenant_notification_recipients(current_user, include_super_admins=True),
    )
    return {"message": "User deleted"}

@router.get("/teams")
def get_team(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER))):
    role = normalize_role(current_user.get("role"))
    if role == Role.SUPER_ADMIN.value:
        return {
            "teams": [serialize_team(team) for team in db.teams.find({}).sort("created_at", -1)],
            "members": [serialize_user(user) for user in db.users.find({}).sort("created_at", -1)],
        }

    team_id = _current_team_or_403(current_user)
    team = _team_document(team_id)
    members = [serialize_user(user) for user in db.users.find({"team_id": team_id}).sort("role", 1)]
    return {"team": serialize_team(team), "members": members}


@router.post("/invitations")
async def create_invitation(
    payload: InvitationCreate,
    request: Request,
    current_user: dict = Depends(require_roles(Role.ADMIN)),
):
    role = normalize_role(payload.role)
    if role not in {Role.MANAGER.value, Role.USER.value}:
        raise HTTPException(status_code=400, detail="Admins can invite managers and users only")
    email = normalize_email(payload.email)
    if db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")

    team_id = _current_team_or_403(current_user)
    manager_id = None
    if role == Role.USER.value and payload.manager_id:
        manager = db.users.find_one({"email": normalize_email(payload.manager_id), "role": Role.MANAGER.value, "team_id": team_id})
        if not manager:
            raise HTTPException(status_code=400, detail="Manager must belong to your team")
        manager_id = manager["email"]

    token = secrets.token_urlsafe(32)
    document = {
        "email": email,
        "role": role,
        "team_id": team_id,
        "admin_id": normalize_email(current_user.get("email")),
        "manager_id": manager_id,
        "token": token,
        "status": "pending",
        "created_at": utc_now_iso(),
    }
    db.invitations.insert_one(document)
    team = _team_document(team_id) or {}
    base_url = str(request.base_url).rstrip("/")
    invite_link = f"{base_url}/?invite_token={token}"
    try:
        await send_invitation_email(email, role, invite_link, team.get("team_name") or "TaskFlow")
    except Exception:
        pass
    record_audit_log(current_user, "Invitation Created", f"Invited {email} as {role}", request)
    return {"message": "Invitation created", "invitation": {k: v for k, v in document.items() if k != "token"}, "token": token, "invite_link": invite_link}


@router.post("/invitations/accept")
def accept_invitation(payload: InvitationAccept, request: Request):
    invitation = db.invitations.find_one({"token": payload.token, "status": "pending"})
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found or already used")
    if db.users.find_one({"email": invitation["email"]}):
        raise HTTPException(status_code=400, detail="Email already registered")

    username = str(payload.username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Name is required")
    validate_password(payload.password)

    document = {
        "username": username,
        "email": invitation["email"],
        "password": pwd_context.hash(payload.password),
        "role": normalize_role(invitation.get("role")),
        "team_id": invitation.get("team_id"),
        "admin_id": invitation.get("admin_id"),
        "manager_id": invitation.get("manager_id"),
        "status": "active",
        "created_at": utc_now_iso(),
        "last_login": None,
    }
    db.users.insert_one(document)
    db.invitations.update_one({"_id": invitation["_id"]}, {"$set": {"status": "accepted", "accepted_at": utc_now_iso()}})
    record_audit_log(document, "Invitation Accepted", f"{document['email']} joined team {document.get('team_id')}", request)
    return {"message": "Invitation accepted"}
