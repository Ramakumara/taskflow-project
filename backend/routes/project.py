from fastapi import APIRouter, HTTPException
from database import db
from models.projects import ProjectCreate
from bson import ObjectId
from fastapi import Depends
from auth_utils import get_current_user
from routes.activity import record_activity
from rbac import Role, Permission, require_permission

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

def format_mongo(doc):
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

def format_assignment(doc):
    return {
        "id": str(doc.get("_id")),
        "task_id": str(doc.get("task_id")),
        "user_id": doc.get("user_id"),
        "status": normalize_assignment_status(doc.get("status")),
        "assigned_date": doc.get("assigned_date"),
        "completion_date": doc.get("completion_date")
    }

def ensure_task_assignments(doc):
    assignments = list(db.task_assignments.find({"task_id": doc["_id"]}))
    if assignments:
        return assignments

    assigned_to = doc.get("assigned_to", [])
    if not isinstance(assigned_to, list):
        assigned_to = [assigned_to] if assigned_to else []

    assignments_to_insert = [
        {
            "task_id": doc["_id"],
            "user_id": str(email),
            "status": normalize_assignment_status(doc.get("status")),
            "assigned_date": None,
            "completion_date": None
        }
        for email in assigned_to
        if email
    ]

    if assignments_to_insert:
        db.task_assignments.insert_many(assignments_to_insert)
        assignments = list(db.task_assignments.find({"task_id": doc["_id"]}))

    return assignments

def format_task(doc):
    assignments = ensure_task_assignments(doc)
    main_status = calculate_task_status(assignments)

    doc["id"] = str(doc["_id"])
    del doc["_id"]

    if "project_id" in doc:
        doc["project_id"] = str(doc["project_id"])

    doc["status"] = main_status
    doc["assignments"] = [format_assignment(assignment) for assignment in assignments]
    doc["assigned_statuses"] = doc["assignments"]
    doc["assigned_to"] = [assignment["user_id"] for assignment in doc["assignments"]]

    return doc

def format_team_user(doc):
    return {
        "email": doc.get("email"),
        "username": doc.get("username"),
        "role": doc.get("role")
    }

@router.post("/projects")
def create_project(project: ProjectCreate, current_user: dict = Depends(require_permission(Permission.MANAGE_PROJECTS))):

    new_project = project.model_dump()
    new_project["owner_email"] = current_user["email"]  

    db.projects.insert_one(new_project)
    record_activity(
        current_user,
        "Project created",
        "Project",
        f"Name: {new_project['name']}"
    )
    return {"message": "Project created"}


@router.get("/projects")
def get_projects(current_user: dict = Depends(get_current_user)):

    if current_user["role"] == "manager":
        data = list(db.projects.find({"owner_email": current_user["email"]}))
    elif current_user["role"] == "admin":
        data = list(db.projects.find())
    else:
        member_task_ids = db.task_assignments.distinct("task_id", {"user_id": current_user["email"]})
        member_project_ids = db.tasks.distinct("project_id", {
            "$or": [
                {"_id": {"$in": member_task_ids}},
                {"assigned_to": current_user["email"]}
            ]
        })
        data = list(db.projects.find({"_id": {"$in": member_project_ids}})) if member_project_ids else []
        
    return [format_mongo(p) for p in data]


@router.get("/projects/team-workspace")
def get_team_workspace(current_user: dict = Depends(get_current_user)):
    user_email = current_user["email"]

    if current_user["role"] == "admin":
        projects = list(db.projects.find())
    elif current_user["role"] == "manager":
        projects = list(db.projects.find({"owner_email": user_email}))
    else:
        member_task_ids = db.task_assignments.distinct("task_id", {"user_id": user_email})
        member_project_ids = db.tasks.distinct("project_id", {"_id": {"$in": member_task_ids}})
        legacy_project_ids = db.tasks.distinct("project_id", {"assigned_to": user_email})
        member_project_ids = list(set(member_project_ids + legacy_project_ids))
        projects = list(db.projects.find({"_id": {"$in": member_project_ids}})) if member_project_ids else []

    project_ids = [project["_id"] for project in projects]
    tasks = list(db.tasks.find({"project_id": {"$in": project_ids}})) if project_ids else []
    
    member_emails_set = set()
    for task in tasks:
        assigned = task.get("assigned_to", [])
        assignments = ensure_task_assignments(task)
        if assignments:
            for assignment in assignments:
                email = assignment.get("user_id")
                if email: member_emails_set.add(str(email).strip())
        elif isinstance(assigned, list):
            for email in assigned:
                if email: member_emails_set.add(str(email).strip())
        elif assigned:
            member_emails_set.add(str(assigned).strip())
    member_emails = sorted(member_emails_set)

    users = list(db.users.find({"email": {"$in": member_emails}})) if member_emails else []

    return {
        "projects": [format_mongo(project) for project in projects],
        "tasks": [format_task(task) for task in tasks],
        "users": [format_team_user(user) for user in users]
    }


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, current_user: dict = Depends(require_permission(Permission.MANAGE_PROJECTS))):

    project = db.projects.find_one({"_id": ObjectId(project_id)})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if current_user["role"] != Role.ADMIN.value and project.get("owner_email") != current_user["email"]:
        raise HTTPException(status_code=403, detail="Not allowed")

    project_name = project.get("name") if project else "Unknown project"

    db.projects.delete_one({"_id": ObjectId(project_id)})
    task_ids = db.tasks.distinct("_id", {"project_id": ObjectId(project_id)})
    db.tasks.delete_many({"project_id": ObjectId(project_id)})
    if task_ids:
        db.task_assignments.delete_many({"task_id": {"$in": task_ids}})

    record_activity(
        current_user,
        "Project deleted",
        "Project",
        f"Name: {project_name}"
    )

    return {"message": "Project deleted"}
