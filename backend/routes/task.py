from fastapi import APIRouter
from database import db
from models.tasks import TaskCreate, TaskUpdate
from bson import ObjectId
from fastapi import Depends
from auth_utils import get_current_user
from auth_utils import send_task_email
from routes.activity import record_activity
router = APIRouter()

def format_mongo(doc):
    doc["id"] = str(doc["_id"])
    del doc["_id"]

    if "project_id" in doc:
        doc["project_id"] = str(doc["project_id"])

    return doc


@router.post("/tasks")
async def create_task(task: TaskCreate, current_user: dict = Depends(get_current_user)):

    if current_user["role"] != "manager":
        return {"message": "Only manager can create tasks"}

    project = db.projects.find_one({"_id": ObjectId(task.project_id)})
    if not project or project.get("owner_email") != current_user["email"]:
        return {"message": "Not allowed"}

    user = db.users.find_one({"email": task.assigned_to})
    if not user:
        return {"message": "User not found"}

    new_task = task.model_dump()
    new_task["project_id"] = ObjectId(task.project_id)

    db.tasks.insert_one(new_task)

    record_activity(
        current_user,
        "Task created",
        f"Task: {new_task.get('title')}",
        f"Assigned to: {new_task.get('assigned_to')}"
    )

    await send_task_email(
        email=user["email"],
        task_title=new_task.get("title"),
        assigned_by=current_user["email"]   
    )

    return {"message": "Task created and email sent"}


@router.get("/tasks")
def get_tasks(current_user: dict = Depends(get_current_user)):

    if current_user["role"] == "admin":
        data = list(db.tasks.find())
    elif current_user["role"] == "manager":
        project_ids = [
            project["_id"]
            for project in db.projects.find({"owner_email": current_user["email"]}, {"_id": 1})
        ]
        data = list(db.tasks.find({"project_id": {"$in": project_ids}})) if project_ids else []
    else:
        data = list(db.tasks.find({"assigned_to": current_user["email"]}))

    return [format_mongo(t) for t in data]


@router.put("/tasks/{task_id}")
def update_task(task_id: str, update: TaskUpdate, current_user: dict = Depends(get_current_user)):

    task = db.tasks.find_one({"_id": ObjectId(task_id)})

    if not task:
        return {"message": "Task not found"}

    if current_user["role"] == "manager":
        project = db.projects.find_one({"_id": task["project_id"]})
        if not project or project.get("owner_email") != current_user["email"]:
            return {"message": "Not allowed"}
    elif task["assigned_to"] != current_user["email"]:
        return {"message": "Not allowed"}

    db.tasks.update_one(
        {"_id": ObjectId(task_id)},
        {"$set": {"status": update.status}}
    )

    record_activity(
        current_user,
        "Task updated",
        f"Task: {task.get('title')}",
        f"New status: {update.status}"
    )

    return {"message": "Task updated"}


@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, current_user: dict = Depends(get_current_user)):

    task = db.tasks.find_one({"_id": ObjectId(task_id)})
    if not task:
        return {"message": "Task not found"}

    if current_user["role"] != "admin":
        project = db.projects.find_one({"_id": task["project_id"]})
        if not project or project.get("owner_email") != current_user["email"]:
            return {"message": "Not allowed"}

    db.tasks.delete_one({"_id": ObjectId(task_id)})

    return {"message": "Task deleted"}