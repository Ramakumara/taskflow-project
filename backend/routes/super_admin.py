from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import os
import secrets
import string

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, EmailStr

from auth_utils import send_account_creation_email, validate_password
from database import db
from models.users import AdminCreateUser, SuperAdminPasswordReset, SuperAdminUserUpdate
from passlib.context import CryptContext
from rbac import Role, normalize_role, require_roles
from routes.activity import format_audit_log, record_activity, record_audit_log
from taskflow_utils import (
    ensure_admin_team,
    normalize_project_status,
    normalize_task_status,
    safe_object_id,
    serialize_project,
    serialize_task,
    utc_now_iso,
)
from websocket_manager import emit_realtime_event


router = APIRouter(tags=["Super Admin"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class ProjectTransferPayload(BaseModel):
    manager_email: EmailStr


class SystemSettingsPayload(BaseModel):
    general: dict = {}
    email: dict = {}
    gemini_ai: dict = {}
    notifications: dict = {}
    security: dict = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _serialize_datetime(value):
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _generate_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    symbols = "@$!%*#?&"
    while True:
        password = [
            secrets.choice(string.ascii_lowercase),
            secrets.choice(string.ascii_uppercase),
            secrets.choice(string.digits),
            secrets.choice(symbols),
        ]
        password.extend(secrets.choice(alphabet + symbols) for _ in range(length - 4))
        secrets.SystemRandom().shuffle(password)
        candidate = "".join(password)
        validate_password(candidate)
        return candidate


def _serialize_user(user: dict) -> dict:
    return {
        "id": str(user.get("_id")),
        "username": user.get("username") or "",
        "name": user.get("username") or "",
        "email": user.get("email"),
        "role": normalize_role(user.get("role")),
        "status": user.get("status") or "active",
        "team_id": user.get("team_id"),
        "admin_id": user.get("admin_id"),
        "manager_id": user.get("manager_id"),
        "last_login": _serialize_datetime(user.get("last_login")),
        "created_at": _serialize_datetime(user.get("created_at")),
    }


def _role_counts() -> dict:
    roles = Counter(normalize_role(user.get("role")) for user in db.users.find({}, {"role": 1}))
    return {
        "total_users": db.users.count_documents({}),
        "total_admins": roles.get(Role.ADMIN.value, 0),
        "total_super_admins": roles.get(Role.SUPER_ADMIN.value, 0),
        "total_managers": roles.get(Role.MANAGER.value, 0),
        "total_regular_users": roles.get(Role.USER.value, 0),
    }


def _storage_used() -> int:
    total = 0
    upload_dir = os.path.join(os.path.dirname(__file__), "..", "uploads")
    for root, _, files in os.walk(upload_dir):
        for filename in files:
            path = os.path.join(root, filename)
            try:
                total += os.path.getsize(path)
            except OSError:
                pass
    return total


def _task_counts(tasks: list[dict]) -> dict:
    today = datetime.utcnow().date()
    completed = 0
    pending = 0
    overdue = 0
    for task in tasks:
        status = normalize_task_status(task.get("overall_status") or task.get("status"))
        if status == "Completed":
            completed += 1
        else:
            pending += 1
        due = task.get("due_date") or task.get("deadline")
        try:
            if due and datetime.fromisoformat(str(due)[:10]).date() < today and status != "Completed":
                overdue += 1
        except Exception:
            pass
    return {
        "total_tasks": len(tasks),
        "completed_tasks": completed,
        "pending_tasks": pending,
        "overdue_tasks": overdue,
    }


def _bucket_by_month(items: list[dict], date_field: str) -> list[dict]:
    buckets = defaultdict(int)
    for item in items:
        value = item.get(date_field)
        if not value:
            continue
        try:
            date = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except Exception:
            continue
        buckets[date.strftime("%Y-%m")] += 1
    return [{"label": label, "value": buckets[label]} for label in sorted(buckets)]


def _project_progress(project: dict, tasks: list[dict]) -> dict:
    project_tasks = [task for task in tasks if str(task.get("project_id")) == str(project.get("id"))]
    total = len(project_tasks)
    complete = len([task for task in project_tasks if normalize_task_status(task.get("status")) == "Completed"])
    return {
        "project_id": project.get("id"),
        "project_name": project.get("name"),
        "manager": project.get("assigned_manager"),
        "team_size": project.get("team_size") or 0,
        "progress": round((complete / total) * 100) if total else 0,
        "status": project.get("status"),
        "created_at": project.get("created_at"),
        "total_tasks": total,
    }


def _dashboard_payload() -> dict:
    raw_tasks = list(db.tasks.find({}))
    raw_projects = list(db.projects.find({}))
    tasks = [serialize_task(item) for item in raw_tasks]
    projects = [serialize_project(item) for item in raw_projects]
    roles = _role_counts()
    task_totals = _task_counts(tasks)
    top_projects = sorted(
        [_project_progress(project, tasks) for project in projects],
        key=lambda item: (item["total_tasks"], item["progress"]),
        reverse=True,
    )[:5]
    recent = list(db.activity_log.find({}).sort("timestamp", -1).limit(8))

    payload = {
        **roles,
        "total_active_projects": len([p for p in projects if normalize_project_status(p.get("status")) != "Completed"]),
        **task_totals,
        "total_notifications_sent": db.notifications.count_documents({}),
        "total_ai_queries": db.audit_logs.count_documents({"action": "AI Usage"}),
        "total_storage_used": _storage_used(),
        "user_growth": _bucket_by_month(list(db.users.find({})), "created_at"),
        "project_growth": _bucket_by_month(projects, "created_at"),
        "task_status_distribution": Counter(normalize_task_status(task.get("status")) for task in tasks),
        "recent_activities": [
            {
                "id": str(item.get("_id")),
                "user_email": item.get("user_email"),
                "username": item.get("username"),
                "role": item.get("role"),
                "action": item.get("action"),
                "target": item.get("target"),
                "details": item.get("details"),
                "timestamp": _serialize_datetime(item.get("timestamp")),
            }
            for item in recent
        ],
        "top_active_projects": top_projects,
        "system_health": _system_health(),
        "generated_at": utc_now_iso(),
    }
    db.platform_stats.insert_one(payload.copy())
    return payload


def _system_health() -> dict:
    health = {
        "api": "operational",
        "database": "unknown",
        "notifications": "operational",
        "ai": "configured" if os.getenv("GEMINI_API_KEY") else "not_configured",
        "storage_used": _storage_used(),
        "checked_at": utc_now_iso(),
    }
    try:
        db.command("ping")
        health["database"] = "operational"
    except Exception:
        health["database"] = "degraded"
    return health


@router.get("/super-admin/dashboard")
def super_admin_dashboard(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    return _dashboard_payload()


@router.get("/super-admin/analytics")
def platform_analytics(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    users = list(db.users.find({}))
    projects = [serialize_project(item) for item in db.projects.find({})]
    tasks = [serialize_task(item) for item in db.tasks.find({})]
    completed = len([task for task in tasks if normalize_task_status(task.get("status")) == "Completed"])
    logins = list(db.audit_logs.find({"action": "Login Events"}))
    ai_usage = list(db.audit_logs.find({"action": "AI Usage"}))
    active_cutoff = _now() - timedelta(days=30)
    active_users = [
        user for user in users
        if user.get("last_login") and datetime.fromisoformat(str(user["last_login"]).replace("Z", "+00:00")) >= active_cutoff
    ]
    return {
        "user_growth": _bucket_by_month(users, "created_at"),
        "project_growth": _bucket_by_month(projects, "created_at"),
        "task_growth": _bucket_by_month(tasks, "created_at"),
        "completion_rate": round((completed / len(tasks)) * 100, 1) if tasks else 0,
        "active_users": len(active_users),
        "daily_logins": _bucket_by_month(logins, "timestamp"),
        "monthly_activity": _bucket_by_month(list(db.activity_log.find({})), "timestamp"),
        "ai_usage_statistics": {
            "total": len(ai_usage),
            "monthly": _bucket_by_month(ai_usage, "timestamp"),
        },
        "task_status_distribution": Counter(normalize_task_status(task.get("status")) for task in tasks),
    }


@router.get("/super-admin/users")
def super_admin_users(
    search: str = "",
    role: str = "all",
    status: str = "all",
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    query = {}
    if role and role != "all":
        query["role"] = normalize_role(role)
    if status and status != "all":
        query["status"] = status
    users = [_serialize_user(item) for item in db.users.find(query).sort("created_at", -1)]
    if search:
        needle = search.strip().lower()
        users = [
            user for user in users
            if needle in " ".join([user.get("username") or "", user.get("email") or "", user.get("role") or ""]).lower()
        ]
    return users


@router.patch("/super-admin/users/{email}")
def super_admin_update_user(
    email: str,
    payload: SuperAdminUserUpdate,
    request: Request,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    target = db.users.find_one({"email": email})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if normalize_role(target.get("role")) == Role.SUPER_ADMIN.value and target.get("email") != current_user.get("email"):
        raise HTTPException(status_code=403, detail="Super Admin accounts cannot be managed from user management")

    updates = {}
    if payload.username is not None:
        updates["username"] = payload.username.strip()
    if payload.status is not None:
        if payload.status not in {"active", "suspended"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        updates["status"] = payload.status
    if payload.role is not None:
        new_role = normalize_role(payload.role)
        if new_role == Role.SUPER_ADMIN.value:
            raise HTTPException(status_code=403, detail="Super Admin role cannot be assigned from this page")
        updates["role"] = new_role
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")

    updates["updated_at"] = utc_now_iso()
    db.users.update_one({"email": email}, {"$set": updates})
    updated = db.users.find_one({"email": email})
    if "role" in updates:
        record_audit_log(current_user, "Role Changed", f"{email}: {target.get('role')} -> {updates['role']}", request)
    if "status" in updates:
        record_audit_log(current_user, "User Status Changed", f"{email}: {target.get('status', 'active')} -> {updates['status']}", request)
    record_activity(current_user, "User updated", f"User: {email}", ", ".join(updates.keys()))
    return {"message": "User updated", "user": _serialize_user(updated)}


@router.post("/super-admin/users/{email}/reset-password")
def super_admin_reset_password(
    email: str,
    payload: SuperAdminPasswordReset,
    request: Request,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    target = db.users.find_one({"email": email})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if normalize_role(target.get("role")) == Role.SUPER_ADMIN.value and target.get("email") != current_user.get("email"):
        raise HTTPException(status_code=403, detail="Super Admin passwords cannot be reset here")
    password = (payload.password or "").strip() or _generate_password()
    validate_password(password)
    db.users.update_one({"email": email}, {"$set": {"password": pwd_context.hash(password), "updated_at": utc_now_iso()}})
    record_audit_log(current_user, "Password Reset", f"Password reset for {email}", request)
    return {"message": "Password reset", "temporary_password": password}


@router.delete("/super-admin/users/{email}")
def super_admin_delete_user(
    email: str,
    request: Request,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    if email == current_user.get("email"):
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    target = db.users.find_one({"email": email})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if normalize_role(target.get("role")) == Role.SUPER_ADMIN.value:
        raise HTTPException(status_code=403, detail="Super Admin accounts cannot be deleted here")
    db.users.delete_one({"email": email})
    record_audit_log(current_user, "User Deleted", f"Deleted {email}", request)
    return {"message": "User deleted"}


@router.get("/admin-management/admins")
def list_admins(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    admins = [_serialize_user(item) for item in db.users.find({"role": Role.ADMIN.value}).sort("created_at", -1)]
    for admin in admins:
        managed_projects = list(db.projects.find({"created_by": admin["email"]}))
        managed_project_ids = [item["_id"] for item in managed_projects]
        admin["projects_managed"] = len(managed_projects)
        admin["users_managed"] = db.activity_log.count_documents({"user_email": admin["email"], "action": {"$regex": "User", "$options": "i"}})
        admin["tasks_created"] = db.tasks.count_documents({"$or": [{"created_by": admin["email"]}, {"assigned_by": admin["email"]}, {"project_id": {"$in": managed_project_ids}}]})
    return admins


@router.post("/admin-management/admins")
async def create_admin(
    payload: AdminCreateUser,
    request: Request,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    if db.users.find_one({"email": payload.email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    password = (payload.password or "").strip() or _generate_password()
    validate_password(password)
    document = {
        "username": payload.username.strip(),
        "email": payload.email.strip().lower(),
        "password": pwd_context.hash(password),
        "role": Role.ADMIN.value,
        "status": "active",
        "created_at": utc_now_iso(),
        "last_login": None,
    }
    result = db.users.insert_one(document)
    document["_id"] = result.inserted_id
    ensure_admin_team(document)
    try:
        await send_account_creation_email(document["email"], document["username"], password, document["role"])
    except Exception:
        db.users.delete_one({"_id": result.inserted_id})
        raise HTTPException(status_code=500, detail="Admin email failed to send")
    record_audit_log(current_user, "User Created", f"Admin account created: {document['email']}", request)
    return {"message": "Admin created", "temporary_password": password, "admin": _serialize_user(document)}


@router.patch("/admin-management/admins/{email}")
def update_admin(
    email: str,
    payload: SuperAdminUserUpdate,
    request: Request,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    target = db.users.find_one({"email": email, "role": Role.ADMIN.value})
    if not target:
        raise HTTPException(status_code=404, detail="Admin not found")
    updates = {}
    if payload.username is not None:
        updates["username"] = payload.username.strip()
    if payload.status is not None:
        if payload.status not in {"active", "suspended"}:
            raise HTTPException(status_code=400, detail="Invalid status")
        updates["status"] = payload.status
    if payload.role is not None:
        next_role = normalize_role(payload.role)
        if next_role not in {Role.ADMIN.value, Role.MANAGER.value}:
            raise HTTPException(status_code=400, detail="Admin can only be demoted to Manager")
        updates["role"] = next_role
    if not updates:
        raise HTTPException(status_code=400, detail="No changes provided")
    updates["updated_at"] = utc_now_iso()
    db.users.update_one({"email": email}, {"$set": updates})
    record_audit_log(current_user, "Role Changed" if "role" in updates else "User Updated", f"Admin updated: {email}", request)
    return {"message": "Admin updated", "admin": _serialize_user(db.users.find_one({"email": email}))}


@router.get("/admin-management/admins/{email}/activity")
def admin_activity(email: str, current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    return [
        {
            "id": str(item.get("_id")),
            "action": item.get("action"),
            "target": item.get("target"),
            "details": item.get("details"),
            "timestamp": _serialize_datetime(item.get("timestamp")),
        }
        for item in db.activity_log.find({"user_email": email}).sort("timestamp", -1).limit(50)
    ]


@router.get("/admin-management/admins/{email}/performance")
def admin_performance(email: str, current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    projects = list(db.projects.find({"created_by": email}))
    project_ids = [item["_id"] for item in projects]
    return {
        "projects_managed": len(projects),
        "users_managed": db.activity_log.count_documents({"user_email": email, "action": {"$regex": "User", "$options": "i"}}),
        "tasks_created": db.tasks.count_documents({"$or": [{"created_by": email}, {"assigned_by": email}, {"project_id": {"$in": project_ids}}]}),
        "last_login": _serialize_datetime((db.users.find_one({"email": email}) or {}).get("last_login")),
    }


@router.get("/super-admin/projects")
def global_projects(
    search: str = "",
    status: str = "all",
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    projects = [serialize_project(item) for item in db.projects.find({}).sort("created_at", -1)]
    if status != "all":
        projects = [item for item in projects if normalize_project_status(item.get("status")) == normalize_project_status(status)]
    if search:
        needle = search.strip().lower()
        projects = [item for item in projects if needle in " ".join([item.get("name") or "", item.get("assigned_manager") or "", item.get("status") or ""]).lower()]
    tasks = [serialize_task(item) for item in db.tasks.find({})]
    return [_project_progress(project, tasks) | project for project in projects]


@router.patch("/super-admin/projects/{project_id}/archive")
def archive_project(project_id: str, request: Request, current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")
    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.projects.update_one({"_id": object_id}, {"$set": {"status": "On Hold", "archived": True, "updated_at": utc_now_iso()}})
    record_audit_log(current_user, "Project Archived", f"Archived project {project.get('name') or project.get('project_name')}", request)
    return {"message": "Project archived", "project": serialize_project(db.projects.find_one({"_id": object_id}))}


@router.patch("/super-admin/projects/{project_id}/transfer")
def transfer_project(
    project_id: str,
    payload: ProjectTransferPayload,
    request: Request,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")
    manager = db.users.find_one({"email": payload.manager_email.strip().lower(), "role": Role.MANAGER.value})
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")
    db.projects.update_one(
        {"_id": object_id},
        {"$set": {
            "assigned_manager": manager["email"],
            "owner_email": manager["email"],
            "manager_id": manager["email"],
            "team_id": manager.get("team_id"),
            "admin_id": manager.get("admin_id"),
            "updated_at": utc_now_iso(),
        }},
    )
    db.tasks.update_many(
        {"project_id": object_id},
        {"$set": {"team_id": manager.get("team_id"), "admin_id": manager.get("admin_id"), "manager_id": manager["email"], "updated_at": utc_now_iso()}},
    )
    record_audit_log(current_user, "Project Ownership Transferred", f"{project_id} -> {manager['email']}", request)
    return {"message": "Project transferred", "project": serialize_project(db.projects.find_one({"_id": object_id}))}


@router.delete("/super-admin/projects/{project_id}")
def super_admin_delete_project(project_id: str, request: Request, current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")
    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    task_ids = db.tasks.distinct("_id", {"project_id": object_id})
    db.projects.delete_one({"_id": object_id})
    db.tasks.delete_many({"project_id": object_id})
    if task_ids:
        db.task_assignments.delete_many({"task_id": {"$in": task_ids}})
    record_audit_log(current_user, "Project Deleted", f"Deleted project {project.get('name') or project.get('project_name')}", request)
    emit_realtime_event({"type": "project.deleted", "message": "Project deleted by Super Admin.", "data": {"id": project_id}})
    return {"message": "Project deleted"}


@router.get("/super-admin/tasks")
def global_tasks(
    project_id: str = "all",
    manager: str = "all",
    status: str = "all",
    overdue: bool = False,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    tasks = [serialize_task(item) for item in db.tasks.find({}).sort("created_at", -1)]
    projects = {str(item.get("_id")): item for item in db.projects.find({})}
    if project_id != "all":
        tasks = [item for item in tasks if str(item.get("project_id")) == str(project_id)]
    if manager != "all":
        tasks = [
            item for item in tasks
            if str((projects.get(str(item.get("project_id"))) or {}).get("assigned_manager") or "").lower() == manager.lower()
        ]
    if status != "all":
        tasks = [item for item in tasks if normalize_task_status(item.get("status")) == normalize_task_status(status)]
    if overdue:
        today = datetime.utcnow().date()
        tasks = [
            item for item in tasks
            if item.get("due_date") and datetime.fromisoformat(str(item.get("due_date"))[:10]).date() < today and normalize_task_status(item.get("status")) != "Completed"
        ]
    return {"tasks": tasks, "analytics": _task_counts(tasks)}


@router.get("/audit-logs")
def audit_logs(
    action: str = "all",
    user: str = "",
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    query = {}
    if action != "all":
        query["action"] = action
    if user:
        query["$or"] = [
            {"user": {"$regex": user, "$options": "i"}},
            {"user_email": {"$regex": user, "$options": "i"}},
        ]
    return [format_audit_log(item) for item in db.audit_logs.find(query).sort("timestamp", -1).limit(500)]


@router.get("/system-settings")
def get_system_settings(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN))):
    settings = db.system_settings.find_one({"key": "platform"}) or {}
    settings.pop("_id", None)
    return {
        "general": settings.get("general") or {"system_name": "TaskFlow", "logo": ""},
        "email": settings.get("email") or {},
        "gemini_ai": settings.get("gemini_ai") or {"api_key": ""},
        "notifications": settings.get("notifications") or {"enabled": True},
        "security": settings.get("security") or {"session_timeout": 1440, "password_policy": "strong"},
        "health": _system_health(),
    }


@router.put("/system-settings")
def update_system_settings(
    payload: SystemSettingsPayload,
    request: Request,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN)),
):
    document = {
        "key": "platform",
        "general": payload.general,
        "email": payload.email,
        "gemini_ai": payload.gemini_ai,
        "notifications": payload.notifications,
        "security": payload.security,
        "updated_at": utc_now_iso(),
        "updated_by": current_user.get("email"),
    }
    db.system_settings.update_one({"key": "platform"}, {"$set": document}, upsert=True)
    record_audit_log(current_user, "Settings Changes", "Platform settings updated", request)
    return {"message": "Settings updated", "settings": get_system_settings(current_user)}
