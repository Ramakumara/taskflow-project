from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
import re
from auth_utils import send_project_assignment_email

from auth_utils import get_current_user
from database import db
from models.projects import AssignManagerPayload, ProjectCreate, ProjectUpdate
from rbac import Permission, Role, normalize_role, require_permission, require_roles
from routes.activity import record_activity, record_audit_log
from taskflow_utils import (
    add_notification,
    build_admin_dashboard_stats,
    build_scoped_dashboard_stats,
    collect_project_recipients,
    get_visible_project_filter,
    get_visible_task_filter,
    get_user_team_id,
    emit_admin_dashboard_update,
    normalize_email,
    normalize_assignment_emails,
    normalize_project_status,
    safe_object_id,
    serialize_project,
    serialize_task,
    tenant_notification_recipients,
    utc_now_iso,
)
from websocket_manager import emit_realtime_event

router = APIRouter()


def _resolve_project_name(payload: ProjectCreate | ProjectUpdate) -> str:
    return str(payload.project_name or payload.name or "").strip()


def _normalize_manager_email(email: str | None) -> str | None:
    value = normalize_email(email)
    return value or None


def _requested_manager_email(
    payload: ProjectCreate | ProjectUpdate | AssignManagerPayload,
) -> str | None:
    return _normalize_manager_email(
        getattr(payload, "assigned_manager", None)
        or getattr(payload, "manager_email", None)
        or getattr(payload, "owner_email", None)
    )


def _validate_manager(email: str | None, current_user: dict | None = None) -> dict | None:
    normalized_email = _normalize_manager_email(email)
    if not normalized_email:
        return None
    manager = db.users.find_one({
        "email": {
            "$regex": f"^{re.escape(normalized_email)}$",
            "$options": "i"
        }
    })
    if not manager:
        raise HTTPException(status_code=404, detail="Manager not found")
    if normalize_role(manager.get("role")) != Role.MANAGER.value:
        raise HTTPException(status_code=400, detail="Assigned user must have manager role")
    if current_user and normalize_role(current_user.get("role")) != Role.SUPER_ADMIN.value:
        current_team_id = get_user_team_id(current_user)
        if not current_team_id or manager.get("team_id") != current_team_id:
            raise HTTPException(status_code=403, detail="Manager must belong to your team")
    manager["email"] = normalized_email
    return manager


def _project_scope_or_403(project: dict, current_user: dict) -> None:
    role = normalize_role(current_user.get("role"))
    if role == Role.SUPER_ADMIN.value:
        return
    team_id = get_user_team_id(current_user)
    if not team_id or project.get("team_id") != team_id:
        current_email = normalize_email(current_user.get("email"))
        if role == Role.ADMIN.value and normalize_email(project.get("created_by")) == current_email:
            return
        if role == Role.MANAGER.value and normalize_email(project.get("assigned_manager") or project.get("owner_email")) == current_email:
            return
        raise HTTPException(status_code=403, detail="Not allowed")


@router.post("/projects")
async def create_project(
    project: ProjectCreate,
    request: Request,
    current_user: dict = Depends(require_permission(Permission.MANAGE_PROJECTS)),
):
    current_role = normalize_role(current_user.get("role"))
    project_name = _resolve_project_name(project)

    if not project_name:
        raise HTTPException(
            status_code=400,
            detail="Project name is required"
        )

    requested_manager = _requested_manager_email(project)

    if (
        current_role == Role.ADMIN.value
        and not requested_manager
    ):
        raise HTTPException(
            status_code=400,
            detail="Assigned manager is required for admin-created projects"
        )

    manager = _validate_manager(requested_manager, current_user)

    assigned_manager = (
        str(manager.get("email")).strip().lower()
        if manager
        else str(current_user["email"]).strip().lower()
        if current_role == Role.MANAGER.value
        else None
    )

    team_id = get_user_team_id(current_user)
    admin_id = normalize_email(current_user.get("email")) if current_role == Role.ADMIN.value else current_user.get("admin_id")
    if current_role == Role.MANAGER.value:
        if not team_id:
            raise HTTPException(status_code=403, detail="Your account is not attached to a team")
        admin_id = current_user.get("admin_id")
    if manager:
        team_id = manager.get("team_id")
        admin_id = manager.get("admin_id")

    document = {
        "name": project_name,
        "project_name": project_name,
        "description": str(project.description or "").strip(),
        "team_id": team_id,
        "admin_id": admin_id,
        "manager_id": assigned_manager,
        "assigned_manager": assigned_manager,
        "owner_email": assigned_manager,
        "start_date": project.start_date,
        "end_date": project.end_date,
        "status": normalize_project_status(project.status),
        "created_by": str(current_user.get("email") or "").strip().lower(),
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
    }

    # Save project
    result = db.projects.insert_one(document)

    # Notifications + Email
    if assigned_manager:

        # Manager bell notification
        add_notification(
            assigned_manager,
            f"You were assigned to project '{project_name}'.",
            "Project Assignment",
        )

        # EMAIL TO MANAGER
        await send_project_assignment_email(
            assigned_manager,
            project_name,
            current_user.get("email"),
        )

        # Admin notifications
        admin_emails = {
            *tenant_notification_recipients(current_user, include_super_admins=True),
            str(current_user.get("email") or "").strip().lower(),
        }

        for admin_email in admin_emails:
            if (
                admin_email
                and admin_email != assigned_manager
            ):
                add_notification(
                    admin_email,
                    f"Project '{project_name}' was assigned to {assigned_manager}.",
                    "Project Assigned",
                )

    # Activity log
    record_activity(
        current_user,
        "Project created",
        f"Project: {project_name}",
        f"Manager: {assigned_manager or 'Unassigned'}",
    )
    record_audit_log(current_user, "Project Created", f"Project: {project_name}", request)

    # Fetch saved project
    saved = db.projects.find_one(
        {"_id": result.inserted_id}
    )

    serialized_project = serialize_project(saved)

    # WebSocket realtime event
    emit_realtime_event(
        {
            "type": "project.created",
            "message": f"Project '{project_name}' created.",
            "data": serialized_project,
        },
        recipients=collect_project_recipients(
            saved,
            extra=[
                current_user.get("email"),
                assigned_manager,
            ],
        ),
    )

    return {
        "message": "Project created successfully",
        "project": serialized_project,
    }


@router.get("/projects")
def get_projects(current_user: dict = Depends(get_current_user)):
    query = get_visible_project_filter(current_user)
    data = list(db.projects.find(query).sort("created_at", -1))

    # Backfill legacy records opportunistically so manager visibility stays consistent.
    for item in data:
        normalized_owner = _normalize_manager_email(item.get("owner_email"))
        normalized_manager = _normalize_manager_email(item.get("assigned_manager"))
        updates = {}

        if normalized_manager and normalized_manager != item.get("assigned_manager"):
            updates["assigned_manager"] = normalized_manager
        if normalized_owner and normalized_owner != item.get("owner_email"):
            updates["owner_email"] = normalized_owner

        if not normalized_manager and normalized_owner:
            owner_user = db.users.find_one({"email": normalized_owner}, {"role": 1})
            if owner_user and normalize_role(owner_user.get("role")) == Role.MANAGER.value:
                updates["assigned_manager"] = normalized_owner
                updates["owner_email"] = normalized_owner
                item["assigned_manager"] = normalized_owner
                item["owner_email"] = normalized_owner

        if updates:
            updates["updated_at"] = utc_now_iso()
            db.projects.update_one(
                {"_id": item["_id"]},
                {"$set": updates},
            )
            item.update(updates)

    return [serialize_project(item) for item in data]


@router.get("/projects/team-workspace")
def get_team_workspace(current_user: dict = Depends(get_current_user)):
    projects = list(db.projects.find(get_visible_project_filter(current_user)).sort("created_at", -1))
    project_ids = [item["_id"] for item in projects]
    tasks = list(db.tasks.find({"project_id": {"$in": project_ids}}).sort("created_at", -1)) if project_ids else []

    member_emails = set()
    for task in tasks:
        for email in normalize_assignment_emails(task.get("assigned_users") or task.get("assigned_to") or []):
            if email:
                member_emails.add(str(email).strip().lower())
    if normalize_role(current_user.get("role")) == Role.USER.value and current_user.get("email"):
        member_emails.add(current_user["email"])

    users = list(db.users.find({"email": {"$in": list(member_emails)}})) if member_emails else []

    return {
        "projects": [serialize_project(project) for project in projects],
        "tasks": [serialize_task(task) for task in tasks],
        "users": [
            {
                "email": user.get("email"),
                "username": user.get("username"),
                "role": user.get("role"),
            }
            for user in users
        ],
    }


@router.put("/projects/{project_id}")
def update_project(
    project_id: str,
    payload: ProjectUpdate,
    current_user: dict = Depends(require_permission(Permission.MANAGE_PROJECTS)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _project_scope_or_403(project, current_user)

    current_email = str(current_user.get("email") or "").strip().lower()
    project_manager = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if normalize_role(current_user.get("role")) not in {Role.SUPER_ADMIN.value, Role.ADMIN.value} and project_manager != current_email:
        raise HTTPException(status_code=403, detail="Not allowed")

    updates = {}
    project_name = _resolve_project_name(payload)
    if project_name:
        updates["name"] = project_name
        updates["project_name"] = project_name
    if payload.description is not None:
        updates["description"] = str(payload.description).strip()
    if payload.status is not None:
        updates["status"] = normalize_project_status(payload.status)
    if payload.start_date is not None:
        updates["start_date"] = payload.start_date
    if payload.end_date is not None:
        updates["end_date"] = payload.end_date
    requested_manager = _requested_manager_email(payload)
    if requested_manager is not None:
        manager = _validate_manager(requested_manager, current_user)
        if manager:
            updates["assigned_manager"] = str(manager["email"]).strip().lower()
            updates["owner_email"] = str(manager["email"]).strip().lower()
            updates["manager_id"] = str(manager["email"]).strip().lower()

    if not updates:
        raise HTTPException(status_code=400, detail="No project changes provided")

    updates["updated_at"] = utc_now_iso()
    db.projects.update_one({"_id": object_id}, {"$set": updates})

    updated = db.projects.find_one({"_id": object_id})
    record_activity(
        current_user,
        "Project updated",
        f"Project: {updated.get('project_name') or updated.get('name')}",
        ", ".join(sorted(updates.keys())),
    )
    serialized_project = serialize_project(updated)
    emit_realtime_event(
        {
            "type": "project.updated",
            "message": f"Project '{serialized_project.get('name')}' updated.",
            "data": serialized_project,
        },
        recipients=collect_project_recipients(updated, extra=[current_user.get("email")]),
    )
    add_notification(
        serialized_project.get("assigned_manager"),
        f"Project '{serialized_project.get('name')}' details were updated.",
        "Project Updated",
    )
    return {
        "message": "Project updated successfully",
        "project": serialized_project,
    }


@router.put("/projects/{project_id}/assign-manager")
async def assign_manager(
    project_id: str,
    payload: AssignManagerPayload,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _project_scope_or_403(project, current_user)

    manager = _validate_manager(_requested_manager_email(payload), current_user)

    # Update project manager
    db.projects.update_one(
        {"_id": object_id},
        {
            "$set": {
                "assigned_manager": str(manager["email"]).strip().lower(),
                "owner_email": str(manager["email"]).strip().lower(),
                "manager_id": str(manager["email"]).strip().lower(),
                "updated_at": utc_now_iso(),
            }
        },
    )

    # Notification to manager
    add_notification(
        manager["email"],
        f"You were assigned to manage project '{project.get('project_name') or project.get('name')}'.",
        "Manager Assignment",
    )

    # Notification to admins
    for admin_email in tenant_notification_recipients(current_user, include_super_admins=True):
        add_notification(
            admin_email,
            f"Manager {manager['email']} was assigned to project '{project.get('project_name') or project.get('name')}'.",
            "Manager Assigned",
        )

    # EMAIL SEND TO MANAGER
    await send_project_assignment_email(
        manager["email"],
        project.get("project_name") or project.get("name"),
        current_user.get("email"),
    )

    # Activity log
    record_activity(
        current_user,
        "Manager assigned",
        f"Project: {project.get('project_name') or project.get('name')}",
        manager["email"],
    )

    # Fetch updated project
    updated = db.projects.find_one({"_id": object_id})
    serialized_project = serialize_project(updated)

    # Realtime websocket event
    emit_realtime_event(
        {
            "type": "project.manager.assigned",
            "message": f"Manager assigned to project '{serialized_project.get('name')}'.",
            "data": serialized_project,
        },
        recipients=collect_project_recipients(
            updated,
            extra=[current_user.get("email"), manager["email"]],
        ),
    )

    return {
        "message": "Manager assigned successfully",
        "project": serialized_project,
    }

@router.get("/projects/{project_id}/team")
def get_project_team(
    project_id: str,
    current_user: dict = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _project_scope_or_403(project, current_user)
    serialized_project = serialize_project(project)

    current_email = str(current_user.get("email") or "").strip().lower()
    project_manager = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if normalize_role(current_user.get("role")) not in {Role.SUPER_ADMIN.value, Role.ADMIN.value} and project_manager != current_email:
        raise HTTPException(status_code=403, detail="Not allowed")

    member_emails = db.tasks.distinct("assigned_users", {"project_id": object_id})
    users = list(db.users.find({"email": {"$in": member_emails}})) if member_emails else []
    return {
        "project": serialize_project(project),
        "members": [
            {"email": user.get("email"), "username": user.get("username"), "role": user.get("role")}
            for user in users
        ],
    }


@router.get("/admin/dashboard-stats")
def admin_dashboard_stats(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN))):
    return build_scoped_dashboard_stats(current_user)


@router.get("/reports/summary")
def report_summary(current_user: dict = Depends(get_current_user)):
    projects = [serialize_project(item) for item in db.projects.find(get_visible_project_filter(current_user))]
    tasks = [serialize_task(item) for item in db.tasks.find(get_visible_task_filter(current_user))]
    if normalize_role(current_user.get("role")) not in {Role.SUPER_ADMIN.value, Role.ADMIN.value}:
        for admin_email in db.users.distinct("email", {"role": "admin"}) or []:
            add_notification(admin_email, f"{current_user.get('email')} generated a report summary.", "Report Activity")
    emit_admin_dashboard_update("Admin dashboard updated after report activity.")

    user_query = {} if normalize_role(current_user.get("role")) == Role.SUPER_ADMIN.value else {"team_id": get_user_team_id(current_user)}
    users = db.users.count_documents(user_query)
    completed = len([item for item in tasks if item.get("overall_status") == "Completed"])
    pending = len([item for item in tasks if item.get("overall_status") == "Pending"])
    progress = len([item for item in tasks if item.get("overall_status") == "In Progress"])

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "scope": current_user.get("role"),
        "summary": {
            "users": users if normalize_role(current_user.get("role")) in {Role.SUPER_ADMIN.value, Role.ADMIN.value} else None,
            "projects": len(projects),
            "tasks": len(tasks),
            "completed_tasks": completed,
            "pending_tasks": pending,
            "in_progress_tasks": progress,
        },
        "projects": projects,
        "tasks": tasks,
    }


@router.delete("/projects/{project_id}")
def delete_project(
    project_id: str,
    request: Request,
    current_user: dict = Depends(require_permission(Permission.MANAGE_PROJECTS)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _project_scope_or_403(project, current_user)

    current_email = str(current_user.get("email") or "").strip().lower()
    project_manager = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if normalize_role(current_user.get("role")) not in {Role.SUPER_ADMIN.value, Role.ADMIN.value} and project_manager != current_email:
        raise HTTPException(status_code=403, detail="Not allowed")

    task_ids = db.tasks.distinct("_id", {"project_id": object_id})
    db.projects.delete_one({"_id": object_id})
    db.tasks.delete_many({"project_id": object_id})
    if task_ids:
        db.task_assignments.delete_many({"task_id": {"$in": task_ids}})

    record_activity(
        current_user,
        "Project deleted",
        f"Project: {project.get('project_name') or project.get('name')}",
        "",
    )
    record_audit_log(current_user, "Project Deleted", f"Project: {project.get('project_name') or project.get('name')}", request)

    serialized_project = serialize_project(project)

    emit_realtime_event(
        {
            "type": "project.deleted",
            "message": f"Project '{serialized_project.get('name')}' deleted.",
            "data": serialized_project,
        },
        recipients=collect_project_recipients(project, extra=[current_user.get("email")]),
    )
    return {"message": "Project deleted"}
