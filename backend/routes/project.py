from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
import re
from auth_utils import send_project_assignment_email

from auth_utils import get_current_user
from database import db
from models.projects import AssignManagerPayload, ProjectCreate, ProjectUpdate
from rbac import Permission, Role, normalize_role, require_permission, require_roles
from routes.activity import record_activity
from taskflow_utils import (
    add_notification,
    build_admin_dashboard_stats,
    collect_project_recipients,
    get_visible_project_filter,
    get_visible_task_filter,
    emit_admin_dashboard_update,
    normalize_assignment_emails,
    normalize_project_status,
    safe_object_id,
    serialize_project,
    serialize_task,
    utc_now_iso,
)
from websocket_manager import emit_realtime_event

router = APIRouter()


def _resolve_project_name(payload: ProjectCreate | ProjectUpdate) -> str:
    return str(payload.project_name or payload.name or "").strip()


def _normalize_manager_email(email: str | None) -> str | None:
    value = str(email or "").strip().lower()
    return value or None


def _requested_manager_email(
    payload: ProjectCreate | ProjectUpdate | AssignManagerPayload,
) -> str | None:
    return _normalize_manager_email(
        getattr(payload, "assigned_manager", None)
        or getattr(payload, "manager_email", None)
        or getattr(payload, "owner_email", None)
    )


def _validate_manager(email: str | None) -> dict | None:
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
    manager["email"] = normalized_email
    return manager


@router.post("/projects")
async def create_project(
    project: ProjectCreate,
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

    manager = _validate_manager(requested_manager)

    assigned_manager = (
        str(manager.get("email")).strip().lower()
        if manager
        else str(current_user["email"]).strip().lower()
        if current_role == Role.MANAGER.value
        else None
    )

    document = {
        "name": project_name,
        "project_name": project_name,
        "description": str(project.description or "").strip(),
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
            *(db.users.distinct("email", {"role": "admin"}) or []),
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

    current_email = str(current_user.get("email") or "").strip().lower()
    project_manager = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if normalize_role(current_user.get("role")) != Role.ADMIN.value and project_manager != current_email:
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
        manager = _validate_manager(requested_manager)
        if manager:
            updates["assigned_manager"] = str(manager["email"]).strip().lower()
            updates["owner_email"] = str(manager["email"]).strip().lower()

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
    current_user: dict = Depends(require_roles(Role.ADMIN)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    manager = _validate_manager(_requested_manager_email(payload))

    # Update project manager
    db.projects.update_one(
        {"_id": object_id},
        {
            "$set": {
                "assigned_manager": str(manager["email"]).strip().lower(),
                "owner_email": str(manager["email"]).strip().lower(),
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
    for admin_email in db.users.distinct("email", {"role": "admin"}) or []:
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
    current_user: dict = Depends(require_roles(Role.ADMIN, Role.MANAGER)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    serialized_project = serialize_project(project)

    current_email = str(current_user.get("email") or "").strip().lower()
    project_manager = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if normalize_role(current_user.get("role")) != Role.ADMIN.value and project_manager != current_email:
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
def admin_dashboard_stats(current_user: dict = Depends(require_roles(Role.ADMIN))):
    return build_admin_dashboard_stats()


@router.get("/reports/summary")
def report_summary(current_user: dict = Depends(get_current_user)):
    projects = [serialize_project(item) for item in db.projects.find(get_visible_project_filter(current_user))]
    tasks = [serialize_task(item) for item in db.tasks.find(get_visible_task_filter(current_user))]
    if normalize_role(current_user.get("role")) != Role.ADMIN.value:
        for admin_email in db.users.distinct("email", {"role": "admin"}) or []:
            add_notification(admin_email, f"{current_user.get('email')} generated a report summary.", "Report Activity")
    emit_admin_dashboard_update("Admin dashboard updated after report activity.")

    users = db.users.count_documents({})
    completed = len([item for item in tasks if item.get("overall_status") == "Completed"])
    pending = len([item for item in tasks if item.get("overall_status") == "Pending"])
    progress = len([item for item in tasks if item.get("overall_status") == "In Progress"])

    return {
        "generated_at": datetime.utcnow().isoformat(),
        "scope": current_user.get("role"),
        "summary": {
            "users": users if normalize_role(current_user.get("role")) == Role.ADMIN.value else None,
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
    current_user: dict = Depends(require_permission(Permission.MANAGE_PROJECTS)),
):
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    current_email = str(current_user.get("email") or "").strip().lower()
    project_manager = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if normalize_role(current_user.get("role")) != Role.ADMIN.value and project_manager != current_email:
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
