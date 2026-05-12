from fastapi import APIRouter, Depends
from database import db
from auth_utils import get_current_user
from datetime import datetime, timedelta
from bson import ObjectId


router = APIRouter()

@router.get("/notifications")
async def get_notifications(current_user: dict = Depends(get_current_user)):

    notifications = list(
        db.notifications.find(
            {"email": current_user["email"]}
        ).sort("created_at", -1)
    )

    for n in notifications:
        n["id"] = str(n["_id"])
        del n["_id"]

    return notifications



@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str
):

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

    result = db.notifications.update_many(

        {
            "email": current_user["email"],
            "read": False
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

@router.delete("/notifications/cleanup")
async def cleanup_notifications():

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