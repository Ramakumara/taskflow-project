from fastapi import APIRouter, Depends, Response, Request
from database import db
from auth_utils import get_current_user
from rbac import Permission, require_permission
from datetime import datetime, timezone
from io import StringIO
import csv
from zoneinfo import ZoneInfo
from websocket_manager import emit_realtime_event
from taskflow_utils import emit_admin_dashboard_update, get_user_team_id, get_visible_project_filter, get_visible_task_filter

router = APIRouter()


def get_team_emails(current_user: dict):
    role = current_user.get("role")
    email = str(current_user.get("email") or "").strip().lower()

    if role == "admin":
        team_id = get_user_team_id(current_user)
        return db.users.distinct("email", {"team_id": team_id}) if team_id else [email]

    if role == "manager":
        project_ids = [project["_id"] for project in db.projects.find({"assigned_manager": email}, {"_id": 1})]
        if not project_ids:
            return [email] if email else []

        member_emails = db.tasks.distinct("assigned_users", {"project_id": {"$in": project_ids}})
        team_emails = sorted({
            str(member).strip().lower()
            for member in member_emails
            if member and str(member).strip()
        })
        if email:
            team_emails.append(email)
            team_emails = sorted(set(team_emails))
        return team_emails

    project_ids = db.tasks.distinct("project_id", {"assigned_users": email})
    if not project_ids:
        return [email]

    member_emails = db.tasks.distinct("assigned_users", {"project_id": {"$in": project_ids}})
    team_emails = sorted({str(member).strip() for member in member_emails if member})
    if email not in team_emails:
        team_emails.append(email)
    return team_emails


def _build_activity_scope(current_user: dict) -> dict:
    role = str(current_user.get("role") or "").strip().lower()
    if role != "manager":
        return {"project_names": set(), "task_titles": set()}

    visible_projects = list(db.projects.find(get_visible_project_filter(current_user), {"name": 1, "project_name": 1}))
    visible_tasks = list(db.tasks.find(get_visible_task_filter(current_user), {"title": 1, "task_title": 1}))

    project_names = {
        str(project.get("project_name") or project.get("name") or "").strip().lower()
        for project in visible_projects
        if str(project.get("project_name") or project.get("name") or "").strip()
    }
    task_titles = {
        str(task.get("task_title") or task.get("title") or "").strip().lower()
        for task in visible_tasks
        if str(task.get("task_title") or task.get("title") or "").strip()
    }

    return {
        "project_names": project_names,
        "task_titles": task_titles,
    }


def _activity_matches_manager_scope(activity: dict, scope: dict, manager_email: str) -> bool:
    actor_email = str(activity.get("user_email") or "").strip().lower()
    if actor_email == manager_email:
        return True

    haystack = " ".join([
        str(activity.get("target") or "").strip().lower(),
        str(activity.get("details") or "").strip().lower(),
    ]).strip()

    if not haystack:
        return False

    for project_name in scope["project_names"]:
        if project_name and project_name in haystack:
            return True

    for task_title in scope["task_titles"]:
        if task_title and task_title in haystack:
            return True

    return False


def _get_scoped_activity_documents(current_user: dict) -> list[dict]:
    role = str(current_user.get("role") or "").strip().lower()
    email = str(current_user.get("email") or "").strip().lower()
    team_emails = get_team_emails(current_user)

    if role == "super_admin":
        return list(db.activity_log.find().sort("timestamp", -1))

    team_id = get_user_team_id(current_user)
    if role == "admin" and team_id:
        return list(db.activity_log.find({"team_id": team_id}).sort("timestamp", -1))

    documents = list(db.activity_log.find({"user_email": {"$in": team_emails}}).sort("timestamp", -1))
    if role != "manager":
        return documents

    scope = _build_activity_scope(current_user)
    return [
        activity for activity in documents
        if _activity_matches_manager_scope(activity, scope, email)
    ]


def record_activity(user: dict, action: str, target: str = "", details: str = "") -> dict:
    if not user:
        return {}

    activity = {
        "user_email": user.get("email"),
        "username": user.get("username"),
        "role": user.get("role"),
        "team_id": user.get("team_id"),
        "admin_id": user.get("admin_id"),
        "action": action,
        "target": target,
        "details": details,
        "timestamp": datetime.now(ZoneInfo("Asia/Kolkata"))
    }

    result = db.activity_log.insert_one(activity)
    activity["_id"] = result.inserted_id

    emit_realtime_event(
        {
            "type": "activity.created",
            "message": f"{user.get('username') or user.get('email')} performed {action}",
            "data": {
                "id": str(result.inserted_id),
                "action": action,
                "user_email": user.get("email"),
            },
        }
    )
    emit_admin_dashboard_update("Admin dashboard updated after activity.")

    return activity


def record_audit_log(
    user: dict,
    action: str,
    description: str = "",
    request: Request | None = None,
) -> dict:
    if not user:
        user = {}

    document = {
        "action": action,
        "user": user.get("email") or user.get("username") or "system",
        "user_email": user.get("email"),
        "username": user.get("username"),
        "role": user.get("role"),
        "team_id": user.get("team_id"),
        "admin_id": user.get("admin_id"),
        "timestamp": datetime.now(timezone.utc),
        "ip_address": request.client.host if request and request.client else "",
        "description": description,
    }

    result = db.audit_logs.insert_one(document)
    document["_id"] = result.inserted_id

    emit_realtime_event(
        {
            "type": "audit.created",
            "message": f"Audit event recorded: {action}",
            "data": {
                "id": str(result.inserted_id),
                "action": action,
                "user": document["user"],
            },
        }
    )

    return document


def format_audit_log(doc: dict) -> dict:
    timestamp = doc.get("timestamp")
    if hasattr(timestamp, "isoformat"):
        timestamp = timestamp.isoformat()
    return {
        "id": str(doc.get("_id")),
        "action": doc.get("action"),
        "user": doc.get("user") or doc.get("user_email"),
        "user_email": doc.get("user_email"),
        "username": doc.get("username"),
        "role": doc.get("role"),
        "team_id": doc.get("team_id"),
        "admin_id": doc.get("admin_id"),
        "timestamp": timestamp,
        "ip_address": doc.get("ip_address") or "",
        "description": doc.get("description") or "",
    }


def format_activity(doc: dict) -> dict:
    timestamp = doc.get("timestamp")
    if hasattr(timestamp, "isoformat"):
        timestamp = timestamp.isoformat()
    return {
        "id": str(doc.get("_id")),
        "user_email": doc.get("user_email"),
        "username": doc.get("username"),
        "role": doc.get("role"),
        "team_id": doc.get("team_id"),
        "admin_id": doc.get("admin_id"),
        "action": doc.get("action"),
        "target": doc.get("target"),
        "details": doc.get("details"),
        "timestamp": timestamp,
    }


@router.get("/activities")
def get_activities(current_user: dict = Depends(require_permission(Permission.VIEW_ACTIVITY_LOGS))):
    documents = _get_scoped_activity_documents(current_user)
    return [format_activity(doc) for doc in documents]


@router.get("/activities/export")
def export_activities(current_user: dict = Depends(require_permission(Permission.VIEW_ACTIVITY_LOGS))):
    documents = _get_scoped_activity_documents(current_user)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["Timestamp", "User Email", "User Name", "Role", "Action", "Target", "Details"])

    for doc in documents:
        timestamp = doc.get("timestamp")
        if hasattr(timestamp, "isoformat"):
            timestamp = timestamp.isoformat()
        writer.writerow([
            timestamp,
            doc.get("user_email", ""),
            doc.get("username", ""),
            doc.get("role", ""),
            doc.get("action", ""),
            doc.get("target", ""),
            doc.get("details", "")
        ])

    headers = {
        "Content-Disposition": "attachment; filename=taskflow-activity-log.csv"
    }
    return Response(content=output.getvalue(), media_type="text/csv", headers=headers)
