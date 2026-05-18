from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import FileResponse
import os
import shutil
from datetime import datetime

from auth_utils import get_current_user
from database import db

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

    filename = doc.get("name", "")
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
        "path": doc.get("path"),
        "size": size,
        "uploaded_at": modified,
        "extension": ext,
        "owner_email": doc.get("owner_email"),
        "owner_name": doc.get("owner_name"),
        "owner_role": doc.get("owner_role"),
        "shared_with": doc.get("shared_with", []),
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


@router.post("/upload")
async def upload_file(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    db.files.insert_one(
        {
            "name": file.filename,
            "path": file_path,
            "size": os.path.getsize(file_path),
            "uploaded_at": datetime.utcnow().isoformat(),
            "owner_email": current_user.get("email"),
            "owner_name": current_user.get("username") or current_user.get("email"),
            "owner_role": current_user.get("role"),
            "shared_with": [],
        }
    )

    return {"message": "File uploaded successfully"}


@router.get("")
def list_files(current_user: dict = Depends(get_current_user)):
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
    file = db.files.find_one({"name": filename})
    if not file:
        raise HTTPException(status_code=404, detail="File not found")

    if current_user.get("role") != "admin":
        allowed = file.get("owner_email") == current_user.get("email") or current_user.get("email") in file.get(
            "shared_with", []
        )
        if not allowed:
            raise HTTPException(status_code=403, detail="Access denied")

    file_path = os.path.join(UPLOAD_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path, filename=filename)


@router.delete("/{filename}")
def delete_file(filename: str, current_user: dict = Depends(get_current_user)):
    file = db.files.find_one({"name": filename})

    if file:
        if not _can_manage_file(file, current_user):
            raise HTTPException(status_code=403, detail="Access denied")

        if os.path.exists(file["path"]):
            os.remove(file["path"])
        db.files.delete_one({"name": filename})
        return {"message": "Deleted"}

    raise HTTPException(status_code=404, detail="Not found")


@router.post("/{filename}/share")
def share_file(filename: str, payload: dict, current_user: dict = Depends(get_current_user)):
    file = db.files.find_one({"name": filename})
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
        {"name": filename},
        {"$set": {"shared_with": shared_with}},
    )
    return {"message": "Shared"}
