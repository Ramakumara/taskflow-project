from datetime import datetime
import re
from typing import Iterable, List, Optional

from bson import ObjectId

from database import db
from rbac import Role, normalize_role


TASK_STATUS_MAP = {
    "todo": "Pending",
    "pending": "Pending",
    "in progress": "In Progress",
    "progress": "In Progress",
    "done": "Completed",
    "completed": "Completed",
}

PROJECT_STATUS_MAP = {
    "planning": "Planning",
    "pending": "Planning",
    "active": "Active",
    "in progress": "Active",
    "completed": "Completed",
    "on hold": "On Hold",
    "hold": "On Hold",
}

PRIORITY_MAP = {
    "low": "Low",
    "medium": "Medium",
    "high": "High",
    "urgent": "Urgent",
}


def utc_now_iso() -> str:
    return datetime.utcnow().isoformat()


def safe_object_id(value: str) -> Optional[ObjectId]:
    try:
        return ObjectId(value)
    except Exception:
        return None


def normalize_task_status(value: str) -> str:
    return TASK_STATUS_MAP.get(str(value or "Pending").strip().lower(), "Pending")


def normalize_project_status(value: str) -> str:
    return PROJECT_STATUS_MAP.get(str(value or "Planning").strip().lower(), "Planning")


def normalize_priority(value: str) -> str:
    return PRIORITY_MAP.get(str(value or "Medium").strip().lower(), "Medium")


def normalize_assignment_emails(values: Optional[Iterable[str]]) -> List[str]:
    unique = []
    seen = set()
    for raw in values or []:
        email = str(raw or "").strip().lower()
        if not email or email in seen:
            continue
        seen.add(email)
        unique.append(email)
    return unique


def email_match_filter(field: str, email: str) -> dict:
    normalized = str(email or "").strip().lower()
    if not normalized:
        return {field: normalized}
    return {
        field: {
            "$regex": f"^{re.escape(normalized)}$",
            "$options": "i",
        }
    }


def get_user_emails_by_roles(*roles: str) -> list[str]:
    normalized_roles = [normalize_role(role) for role in roles if role]
    if not normalized_roles:
        return []
    return normalize_assignment_emails(
        db.users.distinct("email", {"role": {"$in": normalized_roles}})
    )


def get_admin_emails() -> list[str]:
    return get_user_emails_by_roles(Role.ADMIN.value)


def get_manager_emails() -> list[str]:
    return get_user_emails_by_roles(Role.MANAGER.value)


def serialize_notification(doc: dict) -> dict:
    created_at = doc.get("created_at")
    time_value = doc.get("time")
    if hasattr(created_at, "isoformat"):
        created_at = created_at.isoformat()
    if not time_value:
        time_value = created_at or utc_now_iso()
    return {
        "id": str(doc.get("_id")),
        "title": doc.get("title") or "TaskFlow",
        "message": doc.get("message") or "",
        "email": doc.get("email") or doc.get("user_id"),
        "user_id": doc.get("user_id") or doc.get("email"),
        "read": bool(doc.get("read", doc.get("is_read", False))),
        "time": time_value,
        "created_at": created_at or time_value,
    }


def calculate_overall_status(assignments: List[dict]) -> str:
    statuses = [normalize_task_status(item.get("status")) for item in assignments]
    if statuses and all(status == "Completed" for status in statuses):
        return "Completed"
    if any(status == "In Progress" for status in statuses):
        return "In Progress"
    if statuses and all(status == "Pending" for status in statuses):
        return "Pending"
    if any(status == "Completed" for status in statuses):
        return "In Progress"
    return "Pending"


def calculate_project_status_from_tasks(tasks: List[dict]) -> str:
    if not tasks:
        return "Planning"

    statuses = [
        normalize_task_status(task.get("overall_status") or task.get("status"))
        for task in tasks
    ]

    if statuses and all(status == "Completed" for status in statuses):
        return "Completed"
    if any(status == "In Progress" for status in statuses):
        return "Active"
    if statuses and all(status == "Pending" for status in statuses):
        return "Planning"
    return "Active"


def ensure_task_assignments(task: dict) -> List[dict]:
    task_id = task["_id"]
    assignments = list(db.task_assignments.find({"task_id": task_id}))
    if assignments:
        return assignments

    assigned_users = normalize_assignment_emails(task.get("assigned_users") or task.get("assigned_to"))
    if not assigned_users:
        return []

    now = utc_now_iso()
    rows = []
    for email in assigned_users:
        rows.append({
            "task_id": task_id,
            "user_id": email,
            "status": normalize_task_status(task.get("overall_status") or task.get("status")),
            "assigned_date": now,
            "completion_date": None,
        })

    if rows:
        db.task_assignments.insert_many(rows)
    return list(db.task_assignments.find({"task_id": task_id}))


def serialize_assignment(row: dict) -> dict:
    return {
        "id": str(row.get("_id")),
        "task_id": str(row.get("task_id")),
        "user_id": row.get("user_id"),
        "status": normalize_task_status(row.get("status")),
        "assigned_date": row.get("assigned_date"),
        "completion_date": row.get("completion_date"),
    }


def sync_task_status(task_id: ObjectId) -> str:
    assignments = list(db.task_assignments.find({"task_id": task_id}))
    overall_status = calculate_overall_status(assignments)

    task = db.tasks.find_one({"_id": task_id})
    if not task:
        return overall_status

    previous_status = normalize_task_status(task.get("overall_status") or task.get("status"))
    db.tasks.update_one(
        {"_id": task_id},
        {
            "$set": {
                "status": overall_status,
                "overall_status": overall_status,
                "updated_at": utc_now_iso(),
            }
        },
    )

    updated_task = db.tasks.find_one({"_id": task_id}) or task
    project_status = None
    if updated_task.get("project_id"):
        project_status = sync_project_status(updated_task["project_id"])

    if previous_status != overall_status:
        try:
            from websocket_manager import emit_realtime_event

            emit_realtime_event(
                {
                    "type": "task.status.updated",
                    "message": f"Task status changed to {overall_status}.",
                    "data": {
                        "task": serialize_task(updated_task),
                        "previous_status": previous_status,
                        "status": overall_status,
                        "project_status": project_status,
                    },
                },
                recipients=collect_task_recipients(updated_task),
            )
        except Exception:
            pass

    return overall_status


def sync_project_status(project_id: ObjectId) -> str:
    project = db.projects.find_one({"_id": project_id})
    if not project:
        return "Planning"

    previous_status = normalize_project_status(project.get("status"))
    tasks = list(db.tasks.find({"project_id": project_id}))
    status = calculate_project_status_from_tasks(tasks)

    db.projects.update_one(
        {"_id": project_id},
        {
            "$set": {
                "status": status,
                "updated_at": utc_now_iso(),
            }
        },
    )

    if previous_status != status:
        try:
            from websocket_manager import emit_realtime_event

            updated_project = db.projects.find_one({"_id": project_id}) or project
            emit_realtime_event(
                {
                    "type": "project.status.updated",
                    "message": f"Project status changed to {status}.",
                    "data": {
                        "project": serialize_project(updated_project),
                        "previous_status": previous_status,
                        "status": status,
                    },
                },
                recipients=collect_project_recipients(updated_project),
            )
        except Exception:
            pass

    return status


def serialize_project(project: dict) -> dict:
    payload = dict(project)
    payload["id"] = str(payload.pop("_id"))
    payload["name"] = payload.get("project_name") or payload.get("name") or "Untitled Project"
    payload["project_name"] = payload["name"]
    payload["owner_email"] = str(payload.get("assigned_manager") or payload.get("owner_email") or "").strip().lower() or None
    payload["assigned_manager"] = str(payload.get("assigned_manager") or payload.get("owner_email") or "").strip().lower() or None
    sync_project_status(project["_id"])
    updated_project = db.projects.find_one({"_id": project["_id"]}) or project
    payload["status"] = normalize_project_status(updated_project.get("status"))
    payload["created_by"] = payload.get("created_by") or payload.get("owner_email")
    payload["team_size"] = db.task_assignments.count_documents({"task_id": {"$in": db.tasks.distinct("_id", {"project_id": project["_id"]})}})
    return payload


def serialize_task(task: dict) -> dict:
    payload = dict(task)
    assignments = ensure_task_assignments(task)
    overall_status = calculate_overall_status(assignments)
    db.tasks.update_one(
        {"_id": task["_id"]},
        {"$set": {"status": overall_status, "overall_status": overall_status}},
    )

    payload["id"] = str(payload.pop("_id"))
    if isinstance(payload.get("project_id"), ObjectId):
        payload["project_id"] = str(payload["project_id"])

    title = payload.get("task_title") or payload.get("title") or "Untitled Task"
    due_date = payload.get("due_date") or payload.get("deadline")
    assigned_users = normalize_assignment_emails(payload.get("assigned_users") or payload.get("assigned_to"))

    payload["title"] = title
    payload["task_title"] = title
    payload["deadline"] = due_date
    payload["due_date"] = due_date
    payload["priority"] = normalize_priority(payload.get("priority"))
    payload["status"] = overall_status
    payload["overall_status"] = overall_status
    payload["assigned_to"] = assigned_users
    payload["assigned_users"] = assigned_users
    payload["assignments"] = [serialize_assignment(item) for item in assignments]
    payload["assigned_statuses"] = payload["assignments"]
    payload["attachments"] = payload.get("attachments", [])
    payload["comments"] = payload.get("comments", [])
    return payload


def get_visible_project_filter(current_user: dict) -> dict:
    role = normalize_role(current_user.get("role"))
    email = str(current_user.get("email") or "").strip().lower()

    if role == "admin":
        return {}
    if role == "manager":
        return {
            "$or": [
                email_match_filter("assigned_manager", email),
                email_match_filter("owner_email", email),
            ]
        }

    task_ids = db.task_assignments.distinct("task_id", {"user_id": email})
    legacy_project_ids = db.tasks.distinct("project_id", {"assigned_to": email})
    project_ids = db.tasks.distinct("project_id", {"_id": {"$in": task_ids}})
    project_ids = list({*project_ids, *legacy_project_ids})
    return {"_id": {"$in": project_ids}} if project_ids else {"_id": {"$in": []}}


def get_visible_task_filter(current_user: dict) -> dict:
    role = normalize_role(current_user.get("role"))
    email = str(current_user.get("email") or "").strip().lower()

    if role == "admin":
        return {}
    if role == "manager":
        project_ids = db.projects.distinct(
            "_id",
            {
                "$or": [
                    email_match_filter("assigned_manager", email),
                    email_match_filter("owner_email", email),
                ]
            },
        )
        return {"project_id": {"$in": project_ids}} if project_ids else {"_id": {"$in": []}}

    task_ids = db.task_assignments.distinct("task_id", {"user_id": email})
    legacy_task_ids = db.tasks.distinct("_id", {"assigned_to": email})
    visible_task_ids = list({*task_ids, *legacy_task_ids})
    return {"_id": {"$in": visible_task_ids}} if visible_task_ids else {"_id": {"$in": []}}


def collect_project_recipients(project: dict, extra: Optional[Iterable[str]] = None) -> list[str]:
    recipients = set(normalize_assignment_emails(extra or []))
    manager_email = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if manager_email:
        recipients.add(manager_email)

    project_id = project.get("_id")
    if project_id:
        task_assignees = db.tasks.distinct("assigned_users", {"project_id": project_id})
        for assignee in task_assignees:
            if isinstance(assignee, list):
                recipients.update(normalize_assignment_emails(assignee))

    recipients.update(get_admin_emails())
    return sorted(recipients)


def collect_task_recipients(task: dict, project: Optional[dict] = None, extra: Optional[Iterable[str]] = None) -> list[str]:
    recipients = set(normalize_assignment_emails(extra or []))
    recipients.update(normalize_assignment_emails(task.get("assigned_users") or task.get("assigned_to") or []))

    if task.get("assigned_by"):
        recipients.add(str(task.get("assigned_by")).strip().lower())
    if task.get("created_by"):
        recipients.add(str(task.get("created_by")).strip().lower())

    if project is None and task.get("project_id"):
        project_id = task.get("project_id")
        if isinstance(project_id, str):
            project_id = safe_object_id(project_id)
        if project_id:
            project = db.projects.find_one({"_id": project_id})

    if project:
        recipients.update(collect_project_recipients(project))

    return sorted({item for item in recipients if item})


def add_notification(user_id: Optional[str], message: str, title: str = "TaskFlow") -> Optional[dict]:
    if not user_id:
        return None

    now = datetime.utcnow()
    document = {
        "user_id": user_id,
        "email": user_id,
        "title": title,
        "message": message,
        "is_read": False,
        "read": False,
        "created_at": now,
        "time": now.isoformat(),
    }
    result = db.notifications.insert_one(document)
    saved = dict(document)
    saved["_id"] = result.inserted_id
    serialized = serialize_notification(saved)

    try:
        from websocket_manager import emit_realtime_event

        emit_realtime_event(
            {
                "type": "notification.created",
                "message": message,
                "data": serialized,
            },
            recipients=[user_id],
        )
    except Exception:
        pass

    return serialized


def build_admin_dashboard_stats() -> dict:
    tasks = [serialize_task(item) for item in db.tasks.find({})]
    projects = [serialize_project(item) for item in db.projects.find({})]
    activities = list(db.activity_log.find().sort("timestamp", -1).limit(8))

    completed_tasks = [task for task in tasks if task.get("overall_status") == "Completed"]
    pending_tasks = [task for task in tasks if task.get("overall_status") == "Pending"]
    in_progress_tasks = [task for task in tasks if task.get("overall_status") == "In Progress"]

    project_progress = []
    for project in projects:
        project_tasks = [task for task in tasks if str(task.get("project_id")) == str(project["id"])]
        total = len(project_tasks)
        completed = len([task for task in project_tasks if task.get("overall_status") == "Completed"])
        project_progress.append(
            {
                "project_id": project["id"],
                "project_name": project.get("project_name") or project.get("name") or "Untitled Project",
                "total_tasks": total,
                "completed_tasks": completed,
                "progress_percent": round((completed / total) * 100) if total else 0,
                "status": project.get("status"),
            }
        )

    return {
        "total_users": db.users.count_documents({}),
        "total_projects": len(projects),
        "total_tasks": len(tasks),
        "completed_tasks": len(completed_tasks),
        "pending_tasks": len(pending_tasks),
        "in_progress_tasks": len(in_progress_tasks),
        "recent_activities": [
            {
                "id": str(item.get("_id")),
                "user_email": item.get("user_email"),
                "username": item.get("username"),
                "action": item.get("action"),
                "target": item.get("target"),
                "details": item.get("details"),
                "timestamp": item.get("timestamp").isoformat() if hasattr(item.get("timestamp"), "isoformat") else item.get("timestamp"),
            }
            for item in activities
        ],
        "project_progress": project_progress,
        "notifications": db.notifications.count_documents({"read": False}),
        "reports_generated_at": datetime.utcnow().isoformat(),
    }


def emit_admin_dashboard_update(message: str = "Admin dashboard updated."):
    admin_emails = get_admin_emails()
    if not admin_emails:
        return

    try:
        from websocket_manager import emit_realtime_event

        emit_realtime_event(
            {
                "type": "admin.dashboard.updated",
                "message": message,
                "data": build_admin_dashboard_stats(),
            },
            recipients=admin_emails,
        )
    except Exception:
        pass
