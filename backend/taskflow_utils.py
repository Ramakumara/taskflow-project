from datetime import datetime
import re
from typing import Iterable, List, Optional

from bson import ObjectId

from database import db
from rbac import normalize_role


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


def sync_task_status(task_id: ObjectId) -> str:
    assignments = list(db.task_assignments.find({"task_id": task_id}))
    overall_status = calculate_overall_status(assignments)
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
    return overall_status


def serialize_assignment(row: dict) -> dict:
    return {
        "id": str(row.get("_id")),
        "task_id": str(row.get("task_id")),
        "user_id": row.get("user_id"),
        "status": normalize_task_status(row.get("status")),
        "assigned_date": row.get("assigned_date"),
        "completion_date": row.get("completion_date"),
    }


def serialize_project(project: dict) -> dict:
    payload = dict(project)
    payload["id"] = str(payload.pop("_id"))
    payload["name"] = payload.get("project_name") or payload.get("name") or "Untitled Project"
    payload["project_name"] = payload["name"]
    payload["owner_email"] = str(payload.get("assigned_manager") or payload.get("owner_email") or "").strip().lower() or None
    payload["assigned_manager"] = str(payload.get("assigned_manager") or payload.get("owner_email") or "").strip().lower() or None
    payload["status"] = normalize_project_status(payload.get("status"))
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


def add_notification(user_id: Optional[str], message: str, title: str = "TaskFlow") -> None:
    if not user_id:
        return

    db.notifications.insert_one({
        "user_id": user_id,
        "email": user_id,
        "title": title,
        "message": message,
        "is_read": False,
        "read": False,
        "created_at": datetime.utcnow(),
        "time": datetime.utcnow().isoformat(),
    })
