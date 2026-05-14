from enum import Enum
from fastapi import Depends, HTTPException, status

from auth_utils import get_current_user


class Role(str, Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    USER = "user"


class Permission(str, Enum):
    MANAGE_USERS = "manage_users"
    CHANGE_ROLES = "change_roles"
    VIEW_ACTIVITY_LOGS = "view_activity_logs"
    VIEW_REPORTS = "view_reports"
    MANAGE_PROJECTS = "manage_projects"
    ASSIGN_TASKS = "assign_tasks"
    MANAGE_TEAM_TASKS = "manage_team_tasks"
    VIEW_ASSIGNED_TASKS = "view_assigned_tasks"
    UPDATE_OWN_TASK_STATUS = "update_own_task_status"
    UPLOAD_FILES = "upload_files"
    VIEW_NOTIFICATIONS = "view_notifications"


ROLE_PERMISSIONS = {
    Role.ADMIN: {
        Permission.MANAGE_USERS,
        Permission.CHANGE_ROLES,
        Permission.VIEW_ACTIVITY_LOGS,
        Permission.VIEW_REPORTS,
        Permission.MANAGE_PROJECTS,
        Permission.ASSIGN_TASKS,
        Permission.MANAGE_TEAM_TASKS,
        Permission.VIEW_ASSIGNED_TASKS,
        Permission.UPDATE_OWN_TASK_STATUS,
        Permission.UPLOAD_FILES,
        Permission.VIEW_NOTIFICATIONS,
    },
    Role.MANAGER: {
        Permission.VIEW_ACTIVITY_LOGS,
        Permission.VIEW_REPORTS,
        Permission.MANAGE_PROJECTS,
        Permission.ASSIGN_TASKS,
        Permission.MANAGE_TEAM_TASKS,
        Permission.VIEW_ASSIGNED_TASKS,
        Permission.UPDATE_OWN_TASK_STATUS,
        Permission.UPLOAD_FILES,
        Permission.VIEW_NOTIFICATIONS,
    },
    Role.USER: {
        Permission.VIEW_ASSIGNED_TASKS,
        Permission.UPDATE_OWN_TASK_STATUS,
        Permission.UPLOAD_FILES,
        Permission.VIEW_NOTIFICATIONS,
    },
}


VALID_ROLES = {role.value for role in Role}


def normalize_role(role: str) -> str:
    value = str(role or Role.USER.value).strip().lower()
    return value if value in VALID_ROLES else Role.USER.value


def require_roles(*roles: Role):
    allowed = {role.value if isinstance(role, Role) else str(role) for role in roles}

    def dependency(current_user: dict = Depends(get_current_user)):
        if normalize_role(current_user.get("role")) not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )
        return current_user

    return dependency


def require_permission(permission: Permission):
    def dependency(current_user: dict = Depends(get_current_user)):
        role = Role(normalize_role(current_user.get("role")))
        if permission not in ROLE_PERMISSIONS[role]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )
        return current_user

    return dependency
