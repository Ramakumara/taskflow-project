from fastapi import APIRouter, HTTPException
from database import db
from models.tasks import TaskCreate, TaskUpdate
from bson import ObjectId
from fastapi import Depends
from auth_utils import get_current_user
from auth_utils import send_task_email, send_reminder_email
from routes.activity import record_activity
from rbac import Role, Permission, require_permission
from datetime import datetime, timedelta
from datetime import datetime
import pytz

india = pytz.timezone("Asia/Kolkata")

router = APIRouter()

STATUS_LABELS = {
    "todo": "Pending",
    "pending": "Pending",
    "in progress": "In Progress",
    "progress": "In Progress",
    "done": "Completed",
    "completed": "Completed"
}

def normalize_assignment_status(status):
    return STATUS_LABELS.get(str(status or "Pending").strip().lower(), "Pending")

def calculate_task_status(assignments):
    statuses = [normalize_assignment_status(a.get("status")) for a in assignments]

    if statuses and all(status == "Completed" for status in statuses):
        return "Completed"

    if any(status != "Pending" for status in statuses):
        return "In Progress"

    return "Pending"

def format_assignment(doc):
    return {
        "id": str(doc.get("_id")),
        "task_id": str(doc.get("task_id")),
        "user_id": doc.get("user_id"),
        "status": normalize_assignment_status(doc.get("status")),
        "assigned_date": doc.get("assigned_date"),
        "completion_date": doc.get("completion_date")
    }

def ensure_task_assignments(task):
    task_id = task["_id"]
    assignments = list(db.task_assignments.find({"task_id": task_id}))

    if assignments:
        return assignments

    assigned_to = task.get("assigned_to", [])
    if not isinstance(assigned_to, list):
        assigned_to = [assigned_to] if assigned_to else []

    now = datetime.utcnow()
    initial_status = normalize_assignment_status(task.get("status"))
    new_assignments = []

    for email in assigned_to:
        if not email:
            continue

        new_assignments.append({
            "task_id": task_id,
            "user_id": str(email),
            "status": initial_status,
            "assigned_date": now.isoformat(),
            "completion_date": now.isoformat() if initial_status == "Completed" else None
        })

    if new_assignments:
        db.task_assignments.insert_many(new_assignments)
        assignments = list(db.task_assignments.find({"task_id": task_id}))

    return assignments

def sync_task_status(task_id):
    assignments = list(db.task_assignments.find({"task_id": ObjectId(task_id)}))
    main_status = calculate_task_status(assignments)
    db.tasks.update_one({"_id": ObjectId(task_id)}, {"$set": {"status": main_status}})
    return main_status

def format_task(doc):
    assignments = ensure_task_assignments(doc)
    main_status = calculate_task_status(assignments)

    db.tasks.update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": main_status}}
    )

    doc["id"] = str(doc["_id"])
    del doc["_id"]

    if "project_id" in doc:
        doc["project_id"] = str(doc["project_id"])

    doc["status"] = main_status
    doc["assignments"] = [format_assignment(a) for a in assignments]
    doc["assigned_statuses"] = doc["assignments"]
    doc["assigned_to"] = [a["user_id"] for a in doc["assignments"]]

    return doc


@router.post("/tasks")
async def create_task(task: TaskCreate, current_user: dict = Depends(require_permission(Permission.ASSIGN_TASKS))):

    is_admin = current_user["role"] == Role.ADMIN.value

    project = db.projects.find_one({"_id": ObjectId(task.project_id)})
    if not project or (not is_admin and project.get("owner_email") != current_user["email"]):
        raise HTTPException(status_code=403, detail="Not allowed")

    user_emails = list(dict.fromkeys(str(email) for email in task.assigned_to))
    if not user_emails:
        raise HTTPException(status_code=400, detail="At least one assignee is required")

    users = list(db.users.find({"email": {"$in": user_emails}}))
    if len(users) != len(user_emails):
        raise HTTPException(status_code=400, detail="One or more users not found")

    new_task = task.model_dump()
    new_task["project_id"] = ObjectId(task.project_id)
    new_task["assigned_by"] = current_user["email"]
    new_task["assigned_to"] = user_emails
    new_task["status"] = "Pending"
    new_task["created_at"] = datetime.utcnow().isoformat()
    new_task["updated_at"] = new_task["created_at"]

    result = db.tasks.insert_one(new_task)
    now = datetime.utcnow()
    db.task_assignments.insert_many([
        {
            "task_id": result.inserted_id,
            "user_id": user["email"],
            "status": "Pending",
            "assigned_date": now.isoformat(),
            "completion_date": None
        }
        for user in users
    ])

    deadline = None
    if task.deadline:
        deadline = datetime.strptime(task.deadline, "%Y-%m-%d").date()
    today = datetime.now().date()

    for user in users:
        db.notifications.insert_one({
            "email": user["email"],
            "title": "New Task Assigned",
            "message": f"You were assigned task '{new_task.get('title')}'",
            "time": datetime.now(india).isoformat(),
            "read": False,
            "created_at": datetime.utcnow()
        })

        await send_task_email(
            email=user["email"],
            task_title=new_task.get("title"),
            assigned_by=current_user["email"]   
        )

        if deadline and deadline == today + timedelta(days=1):
            await send_reminder_email(
                email=user["email"],
                task_title=new_task.get("title"),
                deadline=str(deadline)
            )

    assigned_to_str = ", ".join(user_emails)
    record_activity(
        current_user,
        "Task created",
        f"Task: {new_task.get('title')}",
        f"Assigned to: {assigned_to_str}"
    )

    return {"message": "Task created and email sent"}


@router.get("/tasks")
def get_tasks(current_user: dict = Depends(get_current_user)):

    if current_user["role"] == "admin":
        data = list(db.tasks.find().sort("_id", -1))
    elif current_user["role"] == "manager":
        project_ids = [
            project["_id"]
            for project in db.projects.find({"owner_email": current_user["email"]}, {"_id": 1})
        ]
        data = list(db.tasks.find({"project_id": {"$in": project_ids}}).sort("_id", -1)) if project_ids else []
    else:
        task_ids = db.task_assignments.distinct("task_id", {"user_id": current_user["email"]})
        data = list(db.tasks.find({
            "$or": [
                {"_id": {"$in": task_ids}},
                {"assigned_to": current_user["email"]}
            ]
        }).sort("_id", -1))

    return [format_task(t) for t in data]


@router.put("/tasks/{task_id}")
def update_task(task_id: str, update: TaskUpdate, current_user: dict = Depends(get_current_user)):

    task = db.tasks.find_one({"_id": ObjectId(task_id)})

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    ensure_task_assignments(task)
    assignment = db.task_assignments.find_one({
        "task_id": ObjectId(task_id),
        "user_id": current_user["email"]
    })

    if not assignment:
        raise HTTPException(status_code=403, detail="Not allowed")

    status = normalize_assignment_status(update.status)
    completion_date = datetime.utcnow().isoformat() if status == "Completed" else None

    db.task_assignments.update_one(
        {"_id": assignment["_id"]},
        {"$set": {
            "status": status,
            "completion_date": completion_date
        }}
    )

    main_status = sync_task_status(task_id)

    db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": {"status": main_status, "updated_at": datetime.utcnow().isoformat()}}
    )

    project = db.projects.find_one({"_id": task["project_id"]})

    manager_email = project.get("owner_email") if project else None

    if manager_email:
        db.notifications.insert_one({

            "email": manager_email,

            "title": "Task Updated",

            "message": f"{current_user['email']} updated task '{task['title']}' to {status}",

            "time": datetime.now(india).isoformat(),

            "read": False,

            "created_at": datetime.utcnow()
        })

    record_activity(
        current_user,
        "Task updated",
        f"Task: {task.get('title')}",
        f"{current_user['email']} status: {status}; task status: {main_status}"
    )

    return {"message": "Task updated"}


@router.put("/tasks/{task_id}/assignments/me")
def update_my_task_assignment(task_id: str, update: TaskUpdate, current_user: dict = Depends(get_current_user)):
    return update_task(task_id, update, current_user)


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, current_user: dict = Depends(require_permission(Permission.MANAGE_TEAM_TASKS))):

    task = db.tasks.find_one({"_id": ObjectId(task_id)})
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if current_user["role"] != "admin":
        project = db.projects.find_one({"_id": task["project_id"]})
        if not project or project.get("owner_email") != current_user["email"]:
            raise HTTPException(status_code=403, detail="Not allowed")

    db.tasks.delete_one({"_id": ObjectId(task_id)})
    db.task_assignments.delete_many({"task_id": ObjectId(task_id)})

    return {"message": "Task deleted"}
