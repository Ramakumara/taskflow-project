from fastapi import APIRouter, Depends, Response
from database import db
from auth_utils import get_current_user
from rbac import Permission, require_permission
from datetime import datetime, timezone
from io import StringIO
import csv
from zoneinfo import ZoneInfo
from websocket_manager import manager
import asyncio

router = APIRouter()


def get_team_emails(current_user: dict):
    role = current_user.get("role")
    email = current_user.get("email")

    if role == "admin":
        return None

    if role == "manager":
        project_ids = [project["_id"] for project in db.projects.find({"owner_email": email}, {"_id": 1})]
        if not project_ids:
            return []

        member_emails = db.tasks.distinct("assigned_to", {"project_id": {"$in": project_ids}})
        team_emails = sorted({str(member).strip() for member in member_emails if member and str(member).strip().lower() != email.lower()})
        return team_emails

    project_ids = db.tasks.distinct("project_id", {"assigned_to": email})
    if not project_ids:
        return [email]

    member_emails = db.tasks.distinct("assigned_to", {"project_id": {"$in": project_ids}})
    team_emails = sorted({str(member).strip() for member in member_emails if member})
    if email not in team_emails:
        team_emails.append(email)
    return team_emails


def record_activity(user: dict, action: str, target: str = "", details: str = "") -> dict:
    if not user:
        return {}

    activity = {
        "user_email": user.get("email"),
        "username": user.get("username"),
        "role": user.get("role"),
        "action": action,
        "target": target,
        "details": details,
        "timestamp": datetime.now(ZoneInfo("Asia/Kolkata"))
    }

    db.activity_log.insert_one(activity)

    message = f"{user.get('username')} performed {action}"

    try:
        loop = asyncio.get_event_loop()
        loop.create_task(manager.broadcast(message))
    except:
        pass

    return activity


def format_activity(doc: dict) -> dict:
    timestamp = doc.get("timestamp")
    if hasattr(timestamp, "isoformat"):
        timestamp = timestamp.isoformat()
    return {
        "id": str(doc.get("_id")),
        "user_email": doc.get("user_email"),
        "username": doc.get("username"),
        "role": doc.get("role"),
        "action": doc.get("action"),
        "target": doc.get("target"),
        "details": doc.get("details"),
        "timestamp": timestamp,
    }


@router.get("/activities")
def get_activities(current_user: dict = Depends(require_permission(Permission.VIEW_ACTIVITY_LOGS))):
    team_emails = get_team_emails(current_user)

    if team_emails is None:
        documents = list(db.activity_log.find().sort("timestamp", -1))
    else:
        documents = list(db.activity_log.find({"user_email": {"$in": team_emails}}).sort("timestamp", -1))

    return [format_activity(doc) for doc in documents]


@router.get("/activities/export")
def export_activities(current_user: dict = Depends(require_permission(Permission.VIEW_ACTIVITY_LOGS))):
    team_emails = get_team_emails(current_user)

    if team_emails is None:
        documents = list(db.activity_log.find().sort("timestamp", -1))
    else:
        documents = list(db.activity_log.find({"user_email": {"$in": team_emails}}).sort("timestamp", -1))

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
