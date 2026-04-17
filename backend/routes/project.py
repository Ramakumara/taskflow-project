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

@router.post("/projects")
def create_project(project: ProjectCreate, current_user: dict = Depends(get_current_user)):

    if current_user["role"] not in ["manager", "admin"]:
        return {"message": "Access denied"}

    new_project = project.model_dump()
    new_project["owner_email"] = current_user["email"]  # 🔥 important

    db.projects.insert_one(new_project)
    return {"message": "Project created"}


@router.get("/projects")
def get_projects(current_user: dict = Depends(get_current_user)):

    if current_user["role"] == "manager":
        data = list(db.projects.find({"owner_email": current_user["email"]}))
    elif current_user["role"] == "admin":
        data = list(db.projects.find())
    else:
        data = list(db.projects.find())  # or restrict if needed

    return [format_mongo(p) for p in data]


@router.delete("/projects/{project_id}")
def delete_project(project_id: str, current_user: dict = Depends(get_current_user)):

    if current_user["role"] != "manager":
        return {"message": "Not allowed"}

    db.projects.delete_one({"_id": ObjectId(project_id)})

    # 🔥 fix: project_id must be ObjectId
    db.tasks.delete_many({"project_id": ObjectId(project_id)})

    return {"message": "Project deleted"}