from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request

from auth_utils import get_current_user
from database import db
from models.invitations import WorkspaceInvitationCreate
from rbac import Role, normalize_role, require_roles
from routes.activity import record_audit_log
from taskflow_utils import ensure_admin_team, get_user_team_id, normalize_email, utc_now_iso
from websocket_manager import emit_realtime_event


router = APIRouter(prefix="/api/invitations", tags=["Invitations"])


def _object_id_or_404(value: str) -> ObjectId:
    try:
        return ObjectId(value)
    except Exception:
        raise HTTPException(status_code=404, detail="Invitation not found")


def _current_workspace_id(current_user: dict) -> str:
    if normalize_role(current_user.get("role")) == Role.ADMIN.value:
        ensure_admin_team(current_user)
    workspace_id = get_user_team_id(current_user)
    if not workspace_id:
        raise HTTPException(status_code=400, detail="Current user is not assigned to a workspace.")
    return workspace_id


def _workspace_admin_id(workspace_id: str) -> str | None:
    team = db.teams.find_one({"_id": ObjectId(workspace_id)}) if ObjectId.is_valid(workspace_id) else None
    return normalize_email((team or {}).get("admin_id")) or None


def _is_workspace_member(user: dict, workspace_id: str) -> bool:
    user_id = str(user.get("_id"))
    email = normalize_email(user.get("email"))
    return bool(
        str(user.get("team_id") or "") == workspace_id
        or db.workspace_members.find_one({"workspace_id": workspace_id, "user_id": user_id})
        or db.workspace_members.find_one({"workspace_id": workspace_id, "email": email})
    )


def _serialize_invitation(invitation: dict) -> dict:
    created_at = invitation.get("created_at")
    if hasattr(created_at, "isoformat"):
        created_at = created_at.isoformat()
    return {
        "id": str(invitation.get("_id")),
        "workspace_id": invitation.get("workspace_id"),
        "sender_id": invitation.get("sender_id"),
        "receiver_id": invitation.get("receiver_id"),
        "email": invitation.get("email"),
        "role": invitation.get("role"),
        "status": invitation.get("status"),
        "created_at": created_at,
    }


@router.post("/send")
async def send_invitation(
    payload: WorkspaceInvitationCreate,
    request: Request,
    current_user: dict = Depends(require_roles(Role.ADMIN)),
):
    email = normalize_email(payload.email)
    role = payload.role
    current_email = normalize_email(current_user.get("email"))

    receiver = db.users.find_one({"email": email})
    if not receiver:
        return {
            "success": False,
            "message": "User not found. Please ask them to register first.",
        }

    if email == current_email or str(receiver.get("_id")) == str(current_user.get("user_id")):
        raise HTTPException(status_code=400, detail="You cannot invite yourself.")

    workspace_id = _current_workspace_id(current_user)

    if _is_workspace_member(receiver, workspace_id):
        raise HTTPException(status_code=400, detail="User already belongs to this workspace.")

    duplicate = db.workspace_invitations.find_one({
        "workspace_id": workspace_id,
        "receiver_id": str(receiver["_id"]),
        "status": "pending",
    })
    if duplicate:
        raise HTTPException(status_code=400, detail="A pending invitation already exists for this user.")

    now = datetime.now(timezone.utc)
    invitation = {
        "workspace_id": workspace_id,
        "sender_id": str(current_user.get("user_id") or ""),
        "receiver_id": str(receiver["_id"]),
        "email": email,
        "role": role,
        "status": "pending",
        "created_at": now,
    }

    result = db.workspace_invitations.insert_one(invitation)
    invitation["_id"] = result.inserted_id

    notification = {
        "user_id": str(receiver["_id"]),
        "email": email,
        "title": "Workspace Invitation",
        "message": f"You have been invited to join the workspace as {role}",
        "type": "invitation",
        "category": "users",
        "invitation_id": str(result.inserted_id),
        "workspace_id": workspace_id,
        "role": role,
        "status": "pending",
        "read": False,
        "is_read": False,
        "created_at": now,
    }
    db.notifications.insert_one(notification)

    emit_realtime_event(
        {
            "type": "notification.created",
            "message": "You have a new workspace invitation.",
            "data": {
                "invitation_id": str(result.inserted_id),
                "role": role,
                "workspace_id": workspace_id,
            },
        },
        recipients=[email],
    )

    record_audit_log(
        current_user,
        "Invitation Sent",
        f"Invited {email} to workspace {workspace_id} as {role}",
        request,
    )

    return {
        "success": True,
        "message": "Invitation sent successfully.",
        "invitation": _serialize_invitation(invitation),
    }


@router.post("/accept/{invitation_id}")
async def accept_invitation(
    invitation_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    object_id = _object_id_or_404(invitation_id)
    invitation = db.workspace_invitations.find_one({"_id": object_id})
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    current_user_id = str(current_user.get("user_id") or "")
    current_email = normalize_email(current_user.get("email"))
    if invitation.get("receiver_id") != current_user_id and normalize_email(invitation.get("email")) != current_email:
        raise HTTPException(status_code=403, detail="This invitation belongs to another user.")

    if invitation.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Invitation already processed.")

    receiver = db.users.find_one({"_id": ObjectId(invitation["receiver_id"])})
    if not receiver:
        raise HTTPException(status_code=404, detail="Invited user not found.")

    workspace_id = invitation["workspace_id"]
    if _is_workspace_member(receiver, workspace_id):
        now = datetime.now(timezone.utc)
        db.workspace_invitations.update_one({"_id": object_id}, {"$set": {"status": "accepted", "accepted_at": now}})
        db.notifications.update_many(
            {"invitation_id": invitation_id},
            {"$set": {"status": "accepted", "read": True, "is_read": True, "read_at": now}},
        )
        return {"success": True, "message": "You are already a member of this workspace."}

    now = datetime.now(timezone.utc)
    role = invitation.get("role") or "User"
    admin_id = _workspace_admin_id(workspace_id)
    user_updates = {
        "team_id": workspace_id,
        "role": normalize_role(role),
        "updated_at": utc_now_iso(),
    }
    if admin_id:
        user_updates["admin_id"] = admin_id
    if normalize_role(role) == Role.MANAGER.value:
        user_updates["manager_id"] = None

    db.workspace_members.update_one(
        {
            "workspace_id": workspace_id,
            "user_id": str(receiver["_id"]),
        },
        {
            "$setOnInsert": {
                "workspace_id": workspace_id,
                "user_id": str(receiver["_id"]),
                "email": normalize_email(receiver.get("email")),
                "role": role,
                "joined_at": now,
            }
        },
        upsert=True,
    )
    db.users.update_one({"_id": receiver["_id"]}, {"$set": user_updates})
    db.workspace_invitations.update_one({"_id": object_id}, {"$set": {"status": "accepted", "accepted_at": now}})
    db.notifications.update_many(
        {"invitation_id": invitation_id},
        {"$set": {"status": "accepted", "read": True, "is_read": True, "read_at": now}},
    )

    record_audit_log(
        current_user,
        "Invitation Accepted",
        f"{current_email} joined workspace {workspace_id} as {role}",
        request,
    )
    emit_realtime_event(
        {
            "type": "user.updated",
            "message": f"{current_email} accepted a workspace invitation.",
            "data": {"email": current_email, "workspace_id": workspace_id, "role": role},
        },
    )

    return {"success": True, "message": "Invitation accepted."}


@router.post("/reject/{invitation_id}")
async def reject_invitation(
    invitation_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    object_id = _object_id_or_404(invitation_id)
    invitation = db.workspace_invitations.find_one({"_id": object_id})
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    current_user_id = str(current_user.get("user_id") or "")
    current_email = normalize_email(current_user.get("email"))
    if invitation.get("receiver_id") != current_user_id and normalize_email(invitation.get("email")) != current_email:
        raise HTTPException(status_code=403, detail="This invitation belongs to another user.")

    if invitation.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Invitation already processed.")

    now = datetime.now(timezone.utc)
    db.workspace_invitations.update_one({"_id": object_id}, {"$set": {"status": "rejected", "rejected_at": now}})
    db.notifications.update_many(
        {"invitation_id": invitation_id},
        {"$set": {"status": "rejected", "read": True, "is_read": True, "read_at": now}},
    )

    record_audit_log(
        current_user,
        "Invitation Rejected",
        f"{current_email} rejected invitation to workspace {invitation.get('workspace_id')}",
        request,
    )

    return {"success": True, "message": "Invitation rejected."}
