from fastapi import APIRouter, Depends, HTTPException
from database import db
from auth_utils import get_current_user
from rbac import Role, require_roles
from datetime import datetime, timedelta
from bson import ObjectId


router = APIRouter()

@router.get("/notifications")
async def get_notifications(current_user: dict = Depends(get_current_user)):
    query = {}
    if current_user.get("role") != "admin":
        query = {"email": current_user["email"]}

    notifications = list(
        db.notifications.find(
            query
        ).sort("created_at", -1)
    )

    for n in notifications:
        n["id"] = str(n["_id"])
        del n["_id"]

    return notifications



@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    notification = db.notifications.find_one({"_id": ObjectId(notification_id)})
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    if current_user.get("role") != "admin" and notification.get("email") != current_user.get("email"):
        raise HTTPException(status_code=403, detail="Access denied")

    result = db.notifications.update_one(

        {
            "_id": ObjectId(notification_id)
        },

        {
            "$set": {
                "read": True
            }
        }
    )

    return {
        "success": True,
        "modified": result.modified_count
    }

@router.put("/notifications/read-all")
async def mark_all_notifications_read(
    current_user: dict = Depends(get_current_user)
):
    query = {"read": False}
    if current_user.get("role") != "admin":
        query["email"] = current_user["email"]

    result = db.notifications.update_many(

        query,

        {
            "$set": {
                "read": True
            }
        }
    )

    return {
        "success": True,
        "modified": result.modified_count
    }

@router.delete("/notifications/cleanup")
async def cleanup_notifications(current_user: dict = Depends(require_roles(Role.ADMIN))):
    one_hour_ago = datetime.utcnow() - timedelta(minutes=60)

    db.notifications.delete_many({

        "read": True,

        "created_at": {
            "$lte": one_hour_ago
        }
    })

    return {
        "message": "Old notifications removed"
    }
