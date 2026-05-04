from fastapi import APIRouter
from database import db
from models.projects import ProjectCreate
from bson import ObjectId
from fastapi import Depends
from auth_utils import get_current_user

router = APIRouter()

def format_mongo(doc):
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

def format_task(doc):
    doc["id"] = str(doc["_id"])
    del doc["_id"]

    if "project_id" in doc:
        doc["project_id"] = str(doc["project_id"])

    return doc

def format_team_user(doc):
    return {
        "email": doc.get("email"),
        "username": doc.get("username"),
        "role": doc.get("role")
    }

@router.post("/projects")
def create_project(project: ProjectCreate, current_user: dict = Depends(get_current_user)):

    if current_user["role"] not in ["manager", "admin"]:
        return {"message": "Access denied"}

    new_project = project.model_dump()
    new_project["owner_email"] = current_user["email"]  

    db.projects.insert_one(new_project)
    return {"message": "Project created"}


@router.get("/projects")
def get_projects(current_user: dict = Depends(get_current_user)):

    if current_user["role"] == "manager":
        data = list(db.projects.find({"owner_email": current_user["email"]}))
    elif current_user["role"] == "admin":
        data = list(db.projects.find())
    else:
        data = list(db.projects.find())  
        
    return [format_mongo(p) for p in data]


@router.get("/projects/team-workspace")
def get_team_workspace(current_user: dict = Depends(get_current_user)):
    user_email = current_user["email"]

    if current_user["role"] == "admin":
        projects = list(db.projects.find())
    elif current_user["role"] == "manager":
        projects = list(db.projects.find({"owner_email": user_email}))
    else:
        member_project_ids = db.tasks.distinct("project_id", {"assigned_to": user_email})
        projects = list(db.projects.find({"_id": {"$in": member_project_ids}})) if member_project_ids else []

    project_ids = [project["_id"] for project in projects]
    tasks = list(db.tasks.find({"project_id": {"$in": project_ids}})) if project_ids else []
    member_emails = sorted({
        str(task.get("assigned_to") or "").strip()
        for task in tasks
        if task.get("assigned_to")
    })

    users = list(db.users.find({"email": {"$in": member_emails}})) if member_emails else []

    return {
        "projects": [format_mongo(project) for project in projects],
        "tasks": [format_task(task) for task in tasks],
        "users": [format_team_user(user) for user in users]
    }


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):

    if current_user["role"] != "manager":
        return {"message": "Not allowed"}

    db.projects.delete_one({"_id": ObjectId(project_id)})


    db.tasks.delete_many({"project_id": ObjectId(project_id)})

    return {"message": "Project deleted"}
