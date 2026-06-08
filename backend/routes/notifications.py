from fastapi import APIRouter, Depends, HTTPException
from database import db
from auth_utils import get_current_user
from rbac import Role, require_roles
from datetime import datetime, timedelta
from bson import ObjectId
from websocket_manager import emit_realtime_event
from taskflow_utils import emit_admin_dashboard_update, serialize_notification


router = APIRouter()

@router.get("/notifications")
async def get_notifications(current_user: dict = Depends(get_current_user)):
    now = datetime.utcnow()
    legacy_cutoff = now - timedelta(minutes=60)
    query = {
        "$nor": [
            {"expires_at": {"$lte": now}},
            {
                "$and": [
                    {"read": True},
                    {
                        "$or": [
                            {"expires_at": {"$exists": False}},
                            {"expires_at": None},
                        ]
                    },
                    {"created_at": {"$lte": legacy_cutoff}},
                ]
            }
        ]
    }
    if current_user.get("role") != "super_admin":
        current_owner_values = [
            current_user["email"],
            current_user.get("user_id"),
        ]
        current_owner_values = [value for value in current_owner_values if value]
        query = {
            "$and": [
                query,
                {"$or": [{"email": current_user["email"]}, {"user_id": {"$in": current_owner_values}}]}
            ]
        }

    notifications = list(
        db.notifications.find(
            query
        ).sort("created_at", -1)
    )

    for n in notifications:
        n["id"] = str(n["_id"])
        del n["_id"]
        n["read"] = bool(n.get("read", n.get("is_read", False)))

    return notifications



@router.put("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: str,
    current_user: dict = Depends(get_current_user)
):
    notification = db.notifications.find_one({"_id": ObjectId(notification_id)})
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")

    owner = notification.get("email") or notification.get("user_id")
    current_owner_values = {
        current_user.get("email"),
        current_user.get("user_id"),
    }
    if current_user.get("role") != "super_admin" and owner not in current_owner_values:
        raise HTTPException(status_code=403, detail="Access denied")

    read_at = datetime.utcnow()
    expires_at = read_at + timedelta(minutes=60)

    result = db.notifications.update_one(

        {
            "_id": ObjectId(notification_id)
        },

        {
            "$set": {
                "read": True,
                "is_read": True,
                "read_at": read_at,
                "expires_at": expires_at,
            }
        }
    )
    updated = db.notifications.find_one({"_id": ObjectId(notification_id)})
    emit_realtime_event(
        {
            "type": "notification.read",
            "message": "Notification marked as read.",
            "data": serialize_notification(updated or notification),
        },
        recipients=[owner],
    )
    emit_admin_dashboard_update("Admin dashboard updated after notification read state changed.")

    return {
        "success": True,
        "modified": result.modified_count
    }

@router.put("/notifications/read-all")
async def mark_all_notifications_read(
    current_user: dict = Depends(get_current_user)
):
    query = {"read": False}
    if current_user.get("role") != "super_admin":
        current_owner_values = [
            current_user["email"],
            current_user.get("user_id"),
        ]
        current_owner_values = [value for value in current_owner_values if value]
        query["$or"] = [{"email": current_user["email"]}, {"user_id": {"$in": current_owner_values}}]

    read_at = datetime.utcnow()
    expires_at = read_at + timedelta(minutes=60)

    result = db.notifications.update_many(

        query,

        {
            "$set": {
                "read": True,
                "is_read": True,
                "read_at": read_at,
                "expires_at": expires_at,
            }
        }
    )
    emit_realtime_event(
        {
            "type": "notification.read_all",
            "message": "Notifications marked as read.",
            "data": {
                "email": current_user.get("email"),
                "modified": result.modified_count,
            },
        },
        recipients=[current_user.get("email")],
    )
    emit_admin_dashboard_update("Admin dashboard updated after notifications were marked read.")

    return {
        "success": True,
        "modified": result.modified_count
    }

@router.delete("/notifications/cleanup")
async def cleanup_notifications(current_user: dict = Depends(require_roles(Role.SUPER_ADMIN, Role.ADMIN))):
    now = datetime.utcnow()
    legacy_cutoff = now - timedelta(minutes=60)

    db.notifications.delete_many({
        "$or": [
            {
                "expires_at": {
                    "$lte": now
                }
            },
            {
                "$and": [
                    {"read": True},
                    {
                        "$or": [
                            {"expires_at": {"$exists": False}},
                            {"expires_at": None},
                        ]
                    },
                    {"created_at": {"$lte": legacy_cutoff}},
                ]
            }
        ]
    })

    return {
        "message": "Old notifications removed"
    }
