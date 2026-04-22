from fastapi import APIRouter, UploadFile, File
from fastapi.responses import FileResponse
import os, shutil
from database import db

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Upload File
@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    db.files.insert_one({
        "name": file.filename,
        "path": file_path
    })

    return {"message": "File uploaded successfully"}

# Get Files
@router.get("/")
def get_files():
    files = list(db.files.find({}, {"_id": 0}))
    return files

# Download File
@router.get("/download/{filename}")
def download_file(filename: str):
    return FileResponse(f"uploads/{filename}", filename=filename)

# Delete File
@router.delete("/{filename}")
def delete_file(filename: str):
    file = db.files.find_one({"name": filename})

    if file:
        os.remove(file["path"])
        db.files.delete_one({"name": filename})
        return {"message": "Deleted"}

    return {"error": "Not found"}