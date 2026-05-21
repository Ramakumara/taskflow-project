from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from auth_utils import get_current_user, send_reminder_email, send_task_email
from database import db
from models.tasks import TaskCommentCreate, TaskCreate, TaskUpdate
from rbac import Permission, Role, require_permission
from routes.activity import record_activity
from taskflow_utils import (
    add_notification,
    calculate_overall_status,
    ensure_task_assignments,
    get_visible_task_filter,
    normalize_assignment_emails,
    normalize_priority,
    normalize_task_status,
    safe_object_id,
    serialize_task,
    sync_task_status,
    utc_now_iso,
)

router = APIRouter()

UPLOAD_DIR = "uploads"


def _project_for_task(project_id: str, current_user: dict) -> dict:
    object_id = safe_object_id(project_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid project id")

    project = db.projects.find_one({"_id": object_id})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if current_user.get("role") == Role.ADMIN.value:
        return project
    current_email = str(current_user.get("email") or "").strip().lower()
    project_manager = str(project.get("assigned_manager") or project.get("owner_email") or "").strip().lower()
    if project_manager != current_email:
        raise HTTPException(status_code=403, detail="Not allowed")
    return project


def _task_title(value: TaskCreate | TaskUpdate) -> str:
    return str(value.task_title or value.title or "").strip()


def _task_due_date(value: TaskCreate | TaskUpdate) -> str | None:
    return value.due_date or value.deadline


def _task_assignees(value: TaskCreate | TaskUpdate) -> list[str]:
    return normalize_assignment_emails(value.assigned_users or value.assigned_to or [])


def _validate_assignees(emails: list[str]) -> list[dict]:
    if not emails:
        raise HTTPException(status_code=400, detail="At least one assignee is required")

    users = list(db.users.find({"email": {"$in": emails}}))
    if len(users) != len(emails):
        raise HTTPException(status_code=400, detail="One or more users not found")
    return users


async def _notify_task_assignment(users: list[dict], task_title: str, assigned_by: str, due_date: str | None):
    for user in users:
        add_notification(
            user.get("email"),
            f"You were assigned task '{task_title}'.",
            "New Task Assigned",
        )
        try:
            await send_task_email(user["email"], task_title, assigned_by)
            if due_date:
                due = datetime.strptime(due_date, "%Y-%m-%d")
                if (due.date() - datetime.utcnow().date()).days == 1:
                    await send_reminder_email(user["email"], task_title, due_date)
        except Exception:
            pass


@router.post("/tasks")
async def create_task(
    task: TaskCreate,
    current_user: dict = Depends(require_permission(Permission.ASSIGN_TASKS)),
):
    project = _project_for_task(task.project_id, current_user)
    title = _task_title(task)
    assignees = _task_assignees(task)
    users = _validate_assignees(assignees)

    if not title:
        raise HTTPException(status_code=400, detail="Task title is required")

    now = utc_now_iso()
    document = {
        "title": title,
        "task_title": title,
        "project_id": project["_id"],
        "description": str(task.description or "").strip(),
        "deadline": _task_due_date(task),
        "due_date": _task_due_date(task),
        "priority": normalize_priority(task.priority),
        "assigned_to": assignees,
        "assigned_users": assignees,
        "status": "Pending",
        "overall_status": "Pending",
        "attachments": task.attachments or [],
        "comments": [],
        "created_by": current_user.get("email"),
        "assigned_by": current_user.get("email"),
        "created_at": now,
        "updated_at": now,
    }

    result = db.tasks.insert_one(document)
    assignment_rows = [
        {
            "task_id": result.inserted_id,
            "user_id": user["email"],
            "status": "Pending",
            "assigned_date": now,
            "completion_date": None,
        }
        for user in users
    ]
    db.task_assignments.insert_many(assignment_rows)

    await _notify_task_assignment(users, title, current_user.get("email"), document["due_date"])

    record_activity(
        current_user,
        "Task created",
        f"Task: {title}",
        f"Project: {project.get('project_name') or project.get('name')}; assignees: {', '.join(assignees)}",
    )

    saved = db.tasks.find_one({"_id": result.inserted_id})
    return {"message": "Task created successfully", "task": serialize_task(saved)}


@router.get("/tasks")
def get_tasks(current_user: dict = Depends(get_current_user)):
    data = list(db.tasks.find(get_visible_task_filter(current_user)).sort("created_at", -1))
    return [serialize_task(item) for item in data]


@router.put("/tasks/{task_id}")
def update_task(task_id: str, update: TaskUpdate, current_user: dict = Depends(get_current_user)):
    object_id = safe_object_id(task_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid task id")

    task = db.tasks.find_one({"_id": object_id})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user.get("role") == Role.USER.value:
        assignment = db.task_assignments.find_one({"task_id": object_id, "user_id": current_user.get("email")})
        if not assignment:
            raise HTTPException(status_code=403, detail="Not allowed")

        status = normalize_task_status(update.status)
        db.task_assignments.update_one(
            {"_id": assignment["_id"]},
            {
                "$set": {
                    "status": status,
                    "completion_date": utc_now_iso() if status == "Completed" else None,
                }
            },
        )
        overall_status = sync_task_status(object_id)
        project = db.projects.find_one({"_id": task.get("project_id")})
        if project and project.get("assigned_manager"):
            add_notification(
                project["assigned_manager"],
                f"{current_user['email']} updated '{task.get('task_title') or task.get('title')}' to {status}.",
                "Task Updated",
            )
        record_activity(
            current_user,
            "Task updated",
            f"Task: {task.get('task_title') or task.get('title')}",
            f"My status: {status}; overall: {overall_status}",
        )
        saved = db.tasks.find_one({"_id": object_id})
        return {"message": "Task updated", "task": serialize_task(saved)}

    project = _project_for_task(str(task.get("project_id")), current_user)
    updates = {}

    title = _task_title(update)
    if title:
        updates["title"] = title
        updates["task_title"] = title
    if update.description is not None:
        updates["description"] = str(update.description).strip()
    if _task_due_date(update) is not None:
        updates["deadline"] = _task_due_date(update)
        updates["due_date"] = _task_due_date(update)
    if update.priority is not None:
        updates["priority"] = normalize_priority(update.priority)

    assignees = _task_assignees(update)
    if assignees:
        users = _validate_assignees(assignees)
        updates["assigned_to"] = assignees
        updates["assigned_users"] = assignees
        existing = {
            row["user_id"]: row
            for row in db.task_assignments.find({"task_id": object_id})
        }
        for email in assignees:
            if email not in existing:
                db.task_assignments.insert_one(
                    {
                        "task_id": object_id,
                        "user_id": email,
                        "status": "Pending",
                        "assigned_date": utc_now_iso(),
                        "completion_date": None,
                    }
                )
        db.task_assignments.delete_many({"task_id": object_id, "user_id": {"$nin": assignees}})
        for user in users:
            add_notification(
                user["email"],
                f"You were added to task '{title or task.get('task_title') or task.get('title')}'.",
                "Task Assignment Updated",
            )
        db.files.update_many(
            {"task_id": str(object_id), "source": "task_attachment"},
            {"$set": {"shared_with": assignees, "updated_at": utc_now_iso()}},
        )

    if update.status is not None:
        updates["status"] = normalize_task_status(update.status)
        updates["overall_status"] = normalize_task_status(update.status)

    if not updates:
        raise HTTPException(status_code=400, detail="No task changes provided")

    updates["updated_at"] = utc_now_iso()
    db.tasks.update_one({"_id": object_id}, {"$set": updates})

    if update.status is not None and not assignees:
        assignments = ensure_task_assignments(task)
        if assignments:
            db.task_assignments.update_many(
                {"task_id": object_id},
                {"$set": {"status": updates["status"]}},
            )
        sync_task_status(object_id)
    else:
        sync_task_status(object_id)

    record_activity(
        current_user,
        "Task updated",
        f"Task: {title or task.get('task_title') or task.get('title')}",
        f"Project: {project.get('project_name') or project.get('name')}",
    )
    saved = db.tasks.find_one({"_id": object_id})
    return {"message": "Task updated successfully", "task": serialize_task(saved)}


@router.put("/tasks/{task_id}/assignments/me")
def update_my_task_assignment(
    task_id: str,
    update: TaskUpdate,
    current_user: dict = Depends(get_current_user),
):
    return update_task(task_id, update, current_user)


@router.get("/manager/team-members")
def get_manager_team_members(current_user: dict = Depends(require_permission(Permission.MANAGE_TEAM_TASKS))):
    query = get_visible_task_filter(current_user)
    tasks = list(db.tasks.find(query))
    emails = set()
    for task in tasks:
        emails.update(normalize_assignment_emails(task.get("assigned_users") or task.get("assigned_to") or []))
    users = list(db.users.find({"email": {"$in": list(emails)}})) if emails else []
    return [
        {
            "email": user.get("email"),
            "username": user.get("username"),
            "role": user.get("role"),
        }
        for user in users
    ]


@router.post("/tasks/{task_id}/comments")
def add_task_comment(
    task_id: str,
    payload: TaskCommentCreate,
    current_user: dict = Depends(get_current_user),
):
    object_id = safe_object_id(task_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid task id")

    task = db.tasks.find_one({"_id": object_id})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    visible = list(db.tasks.find({"_id": object_id, **get_visible_task_filter(current_user)}))
    if not visible:
        raise HTTPException(status_code=403, detail="Not allowed")

    comment = {
        "id": str(ObjectId()),
        "author": current_user.get("email"),
        "author_name": current_user.get("username"),
        "content": payload.content.strip(),
        "created_at": utc_now_iso(),
    }
    if not comment["content"]:
        raise HTTPException(status_code=400, detail="Comment cannot be empty")

    db.tasks.update_one({"_id": object_id}, {"$push": {"comments": comment}, "$set": {"updated_at": utc_now_iso()}})
    record_activity(
        current_user,
        "Task comment added",
        f"Task: {task.get('task_title') or task.get('title')}",
        comment["content"],
    )
    saved = db.tasks.find_one({"_id": object_id})
    return {"message": "Comment added", "task": serialize_task(saved)}


@router.post("/tasks/{task_id}/attachments")
async def upload_task_attachment(
    task_id: str,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    import os
    import shutil

    object_id = safe_object_id(task_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid task id")

    task = db.tasks.find_one({"_id": object_id})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    visible = list(db.tasks.find({"_id": object_id, **get_visible_task_filter(current_user)}))
    if not visible:
        raise HTTPException(status_code=403, detail="Not allowed")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    filename = f"{utc_now_iso().replace(':', '-')}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    attachment = {
        "name": file.filename,
        "stored_name": filename,
        "path": file_path,
        "uploaded_by": current_user.get("email"),
        "uploaded_at": utc_now_iso(),
    }
    db.tasks.update_one({"_id": object_id}, {"$push": {"attachments": attachment}, "$set": {"updated_at": utc_now_iso()}})
    db.files.insert_one(
        {
            "name": filename,
            "display_name": file.filename,
            "stored_name": filename,
            "path": file_path,
            "size": attachment.get("size") or os.path.getsize(file_path),
            "uploaded_at": attachment["uploaded_at"],
            "owner_email": current_user.get("email"),
            "owner_name": current_user.get("username") or current_user.get("email"),
            "owner_role": current_user.get("role"),
            "shared_with": normalize_assignment_emails(task.get("assigned_users") or task.get("assigned_to") or []),
            "source": "task_attachment",
            "task_id": str(object_id),
            "task_title": task.get("task_title") or task.get("title"),
        }
    )
    record_activity(
        current_user,
        "Task attachment uploaded",
        f"Task: {task.get('task_title') or task.get('title')}",
        file.filename,
    )
    saved = db.tasks.find_one({"_id": object_id})
    return {"message": "Attachment uploaded", "task": serialize_task(saved), "attachment": attachment}


@router.get("/tasks/{task_id}/attachments/{stored_name}")
def download_task_attachment(
    task_id: str,
    stored_name: str,
    current_user: dict = Depends(get_current_user),
):
    import os

    object_id = safe_object_id(task_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid task id")

    task = db.tasks.find_one({"_id": object_id})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    visible = list(db.tasks.find({"_id": object_id, **get_visible_task_filter(current_user)}))
    if not visible:
        raise HTTPException(status_code=403, detail="Not allowed")

    attachments = task.get("attachments") or []
    attachment = next(
        (
            item for item in attachments
            if isinstance(item, dict) and str(item.get("stored_name") or "") == str(stored_name)
        ),
        None,
    )

    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    file_path = attachment.get("path")
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Attachment file not found")

    return FileResponse(file_path, filename=attachment.get("name") or stored_name)


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: str,
    current_user: dict = Depends(require_permission(Permission.MANAGE_TEAM_TASKS)),
):
    object_id = safe_object_id(task_id)
    if not object_id:
        raise HTTPException(status_code=400, detail="Invalid task id")

    task = db.tasks.find_one({"_id": object_id})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    _project_for_task(str(task.get("project_id")), current_user)
    attachment_docs = list(db.files.find({"task_id": str(object_id), "source": "task_attachment"}))
    for attachment_doc in attachment_docs:
        path = attachment_doc.get("path")
        if path:
            try:
                import os
                if os.path.exists(path):
                    os.remove(path)
            except OSError:
                pass
    db.tasks.delete_one({"_id": object_id})
    db.task_assignments.delete_many({"task_id": object_id})
    db.files.delete_many({"task_id": str(object_id), "source": "task_attachment"})

    record_activity(
        current_user,
        "Task deleted",
        f"Task: {task.get('task_title') or task.get('title')}",
        "",
    )
    return {"message": "Task deleted"}
