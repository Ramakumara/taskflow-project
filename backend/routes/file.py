from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from fastapi.responses import FileResponse
from bson import ObjectId
import os
import shutil
import json
from datetime import datetime

from auth_utils import get_current_user
from database import db
from routes.activity import record_activity
from taskflow_utils import get_visible_task_filter, normalize_assignment_emails, add_notification
from websocket_manager import emit_realtime_event

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _normalize(value):
    return str(value or "").strip().lower()


def _aliases(value):
    raw = str(value or "").strip().lower()
    aliases = {raw}
    variants = {raw}

    for _ in range(3):
        next_variants = set()
        for item in variants:
            if "," in item:
                next_variants.add(item.split(",")[-1].strip())
            if ":" in item:
                next_variants.add(item.split(":")[-1].strip())
            if item.startswith("welcome "):
                next_variants.add(item.replace("welcome ", "", 1).strip())
            if item.startswith("welcome,"):
                next_variants.add(item.replace("welcome,", "", 1).strip())
        variants = {v for v in next_variants if v}
        aliases |= variants

    return {alias for alias in aliases if alias}


def _is_file_owner(file, current_user):
    current_values = _aliases(current_user.get("email")) | _aliases(current_user.get("username"))
    owner_values = _aliases(file.get("owner_email")) | _aliases(file.get("owner_name"))
    return bool(current_values & owner_values)


def _can_manage_file(file, current_user):
    if current_user.get("role") == "admin":
        return True
    if _is_file_owner(file, current_user):
        return True
    if current_user.get("role") != "manager":
        return False
    file_owner_role = _normalize(file.get("owner_role"))
    if file_owner_role == "manager":
        return True
    return _normalize(file.get("owner_email")) == _normalize(current_user.get("email"))


def _serialize_file(doc):
    stat = None
    try:
        stat = os.stat(doc["path"])
    except OSError:
        pass

    filename = doc.get("display_name") or doc.get("name", "")
    storage_name = doc.get("stored_name") or doc.get("name", "")
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    mime_map = {
        "pdf": "pdf",
        "doc": "doc",
        "docx": "doc",
        "xls": "xls",
        "xlsx": "xls",
        "ppt": "ppt",
        "pptx": "ppt",
        "png": "img",
        "jpg": "img",
        "jpeg": "img",
        "gif": "img",
        "zip": "zip",
    }

    size = doc.get("size")
    if size is None and stat is not None:
        size = stat.st_size

    modified = doc.get("uploaded_at")
    if not modified and stat is not None:
        modified = datetime.fromtimestamp(stat.st_mtime).isoformat()

    return {
        "name": filename,
        "storage_name": storage_name,
        "path": doc.get("path"),
        "size": size,
        "uploaded_at": modified,
        "extension": ext,
        "owner_email": doc.get("owner_email"),
        "owner_name": doc.get("owner_name"),
        "owner_role": doc.get("owner_role"),
        "shared_with": doc.get("shared_with", []),
        "project_id": doc.get("project_id"),
        "project_name": doc.get("project_name"),
        "message": doc.get("message", ""),
        "source": doc.get("source", "upload"),
        "task_id": doc.get("task_id"),
        "task_title": doc.get("task_title"),
        "type": mime_map.get(ext, "folder" if not ext else ext),
    }


def _format_size(num_bytes):
    if num_bytes is None:
        return "-"

    size = float(num_bytes)
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return "-"


def _ensure_task_attachment_files(current_user: dict):
    visible_tasks = list(
        db.tasks.find(
            get_visible_task_filter(current_user),
            {
                "_id": 1,
                "task_title": 1,
                "title": 1,
                "attachments": 1,
                "assigned_to": 1,
                "assigned_users": 1,
                "created_by": 1,
                "assigned_by": 1,
                "updated_at": 1,
            },
        )
    )

    for task in visible_tasks:
        task_id = str(task.get("_id"))
        shared_with = normalize_assignment_emails(task.get("assigned_users") or task.get("assigned_to") or [])
        owner_email = task.get("assigned_by") or task.get("created_by")
        owner = db.users.find_one({"email": owner_email}, {"_id": 0, "email": 1, "username": 1, "role": 1}) if owner_email else None

        for attachment in task.get("attachments") or []:
            if not isinstance(attachment, dict):
                continue

            stored_name = attachment.get("stored_name") or attachment.get("name")
            file_path = attachment.get("path")
            if not stored_name or not file_path:
                continue

            db.files.update_one(
                {"stored_name": stored_name},
                {
                    "$set": {
                        "name": stored_name,
                        "display_name": attachment.get("name") or stored_name,
                        "stored_name": stored_name,
                        "path": file_path,
                        "size": os.path.getsize(file_path) if os.path.exists(file_path) else None,
                        "uploaded_at": attachment.get("uploaded_at"),
                        "owner_email": owner_email,
                        "owner_name": owner.get("username") if owner else owner_email,
                        "owner_role": owner.get("role") if owner else "manager",
                        "shared_with": shared_with,
                        "source": "task_attachment",
                        "task_id": task_id,
                        "task_title": task.get("task_title") or task.get("title"),
                        "updated_at": task.get("updated_at"),
                    }
                },
                upsert=True,
            )


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    project_id: str = Form(None),
    project_name: str = Form(None),
    task_id: str = Form(None),
    task_title: str = Form(None),
    message: str = Form(""),
    shared_with: str = Form(None),
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Only admins and managers can upload files")

    assigned_users = []
    if shared_with:
        try:
            parsed = json.loads(shared_with)
        except json.JSONDecodeError:
            parsed = [shared_with]

        if isinstance(parsed, str):
            assigned_users = [parsed]
        elif isinstance(parsed, list):
            assigned_users = parsed
        else:
            raise HTTPException(status_code=400, detail="shared_with must be a list")

    assigned_users = [str(item).strip() for item in assigned_users if str(item).strip()]
    file_path = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    db.files.insert_one(
        {
            "name": file.filename,
            "display_name": file.filename,
            "stored_name": file.filename,
            "path": file_path,
            "size": os.path.getsize(file_path),
            "uploaded_at": datetime.utcnow().isoformat(),
            "owner_email": current_user.get("email"),
            "owner_name": current_user.get("username") or current_user.get("email"),
            "owner_role": current_user.get("role"),
            "shared_with": assigned_users,
            "project_id": project_id,
            "project_name": project_name,
            "task_id": task_id,
            "task_title": task_title,
            "message": str(message or "").strip()[:200],
        }
    )
    record_activity(
        current_user,
        "File uploaded",
        f"File: {file.filename}",
        "",
    )
    for admin_email in db.users.distinct("email", {"role": "admin"}) or []:
        add_notification(admin_email, f"File '{file.filename}' was uploaded.", "File Uploaded")
    for recipient in assigned_users:
        detail = f"File '{file.filename}' was shared with you."
        if project_name:
            detail = f"File '{file.filename}' was shared with you for project '{project_name}'."
        add_notification(recipient, detail, "File Shared")
    emit_realtime_event(
        {
            "type": "file.uploaded",
            "message": f"File '{file.filename}' uploaded.",
            "data": {
                "name": file.filename,
                "owner_email": current_user.get("email"),
                "project_id": project_id,
                "project_name": project_name,
                "task_id": task_id,
                "task_title": task_title,
                "shared_with": assigned_users,
            },
        },
        recipients=[current_user.get("email"), *(db.users.distinct("email", {"role": "admin"}) or []), *assigned_users],
    )
    return {"message": "File uploaded successfully"}


@router.get("")
def list_files(current_user: dict = Depends(get_current_user)):
    _ensure_task_attachment_files(current_user)
    query = {}
    if current_user.get("role") == "admin":
        query = {}
    else:
        query = {
            "$or": [
                {"owner_email": current_user.get("email")},
                {"shared_with": current_user.get("email")},
            ]
        }

    files = list(db.files.find(query).sort("uploaded_at", -1))
    items = [_serialize_file(file) for file in files]

    for item in items:
        item["size_label"] = _format_size(item.get("size"))
        if not item.get("owner_name") and item.get("owner_email"):
            owner = db.users.find_one(
                {"email": item["owner_email"]},
                {"_id": 0, "username": 1, "email": 1},
            )
            item["owner_name"] = owner.get("username") if owner else item["owner_email"]
        if item.get("owner_name") and not item.get("owner_email"):
            owner = db.users.find_one(
                {"username": item["owner_name"]},
                {"_id": 0, "username": 1, "email": 1},
            )
            if owner:
                item["owner_email"] = owner.get("email")
        if not item.get("owner_name") and current_user.get("role") == "manager":
            item["owner_name"] = current_user.get("username") or current_user.get("email")

    return items


@router.get("/download/{filename}")
def download_file(filename: str, current_user: dict = Depends(get_current_user)):
    file = db.files.find_one({"$or": [{"name": filename}, {"stored_name": filename}]})
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if current_user.get("role") != "admin":
        allowed = file.get("owner_email") == current_user.get("email") or current_user.get("email") in file.get(
            "shared_with", []
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Access denied")

    file_path = file.get("path") or os.path.join(UPLOAD_DIR, file.get("stored_name") or file.get("name") or filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=file.get("display_name") or file.get("name") or filename)


@router.delete("/{filename}")
def delete_file(filename: str, current_user: dict = Depends(get_current_user)):
    file = db.files.find_one({"$or": [{"name": filename}, {"stored_name": filename}]})

    if file:
        if not _can_manage_file(file, current_user):
            raise HTTPException(status_code=403, detail="Access denied")

        if os.path.exists(file["path"]):
            os.remove(file["path"])
        db.files.delete_one({"_id": file["_id"]})
        if file.get("source") == "task_attachment" and file.get("task_id"):
            task_object_id = None
            try:
                task_object_id = ObjectId(str(file.get("task_id")))
            except Exception:
                task_object_id = None
            if task_object_id:
                db.tasks.update_one(
                    {"_id": task_object_id},
                    {"$pull": {"attachments": {"stored_name": file.get("stored_name") or file.get("name")}}},
                )
        record_activity(
            current_user,
            "File deleted",
            f"File: {file.get('display_name') or file.get('name')}",
            "",
        )
        emit_realtime_event(
            {
                "type": "file.deleted",
                "message": f"File '{file.get('display_name') or file.get('name')}' deleted.",
                "data": _serialize_file(file),
            },
            recipients=[current_user.get("email"), *(file.get("shared_with") or [])],
        )
        return {"message": "Deleted"}

    raise HTTPException(status_code=404, detail="Not found")


@router.post("/{filename}/share")
def share_file(filename: str, payload: dict, current_user: dict = Depends(get_current_user)):
    file = db.files.find_one({"$or": [{"name": filename}, {"stored_name": filename}]})
    if not file:
        raise HTTPException(status_code=404, detail="Not found")

    if current_user.get("role") not in ("admin", "manager"):
        raise HTTPException(status_code=403, detail="Access denied")

    if current_user.get("role") == "manager":
        owner_role = _normalize(file.get("owner_role"))
        if owner_role and owner_role != "manager":
            if not _is_file_owner(file, current_user):
                raise HTTPException(status_code=403, detail="Access denied")

    shared_with = payload.get("shared_with") if isinstance(payload, dict) else None
    if shared_with is None:
        shared_with = []
    elif isinstance(shared_with, str):
        shared_with = [shared_with]
    elif not isinstance(shared_with, list):
        raise HTTPException(status_code=400, detail="shared_with must be a list or string")

    shared_with = [str(item).strip() for item in shared_with if str(item).strip()]

    db.files.update_one(
        {"_id": file["_id"]},
        {"$set": {"shared_with": shared_with}},
    )
    updated_file = dict(file)
    updated_file["shared_with"] = shared_with
    record_activity(
        current_user,
        "File shared",
        f"File: {file.get('display_name') or file.get('name')}",
        ", ".join(shared_with),
    )
    for recipient in shared_with:
        add_notification(
            recipient,
            f"File '{file.get('display_name') or file.get('name')}' was shared with you.",
            "File Shared",
        )
    emit_realtime_event(
        {
            "type": "file.shared",
            "message": f"File '{file.get('display_name') or file.get('name')}' sharing updated.",
            "data": _serialize_file(updated_file),
        },
        recipients=[current_user.get("email"), *shared_with],
    )
    return {"message": "Shared"}
