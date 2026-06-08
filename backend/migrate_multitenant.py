from database import db
from rbac import Role, normalize_role
from taskflow_utils import ensure_admin_team, normalize_assignment_emails, utc_now_iso


def normalize_email(value):
    return str(value or "").strip().lower()


def team_for_admin(admin):
    ensure_admin_team(admin)
    return db.users.find_one({"email": normalize_email(admin.get("email"))}) or admin


def infer_project_admin(project, manager=None):
    created_by = normalize_email(project.get("created_by"))
    if created_by:
        creator = db.users.find_one({"email": created_by})
        if creator and normalize_role(creator.get("role")) == Role.ADMIN.value:
            return team_for_admin(creator)
    if manager and manager.get("admin_id"):
        return db.users.find_one({"email": manager["admin_id"], "role": Role.ADMIN.value})
    return db.users.find_one({"role": Role.ADMIN.value}, sort=[("created_at", 1)])


def migrate():
    now = utc_now_iso()

    for admin in db.users.find({"role": Role.ADMIN.value}):
        team_for_admin(admin)

    default_admin = db.users.find_one({"role": Role.ADMIN.value}, sort=[("created_at", 1)])
    default_admin = team_for_admin(default_admin) if default_admin else None

    for project in db.projects.find({}):
        manager_email = normalize_email(project.get("assigned_manager") or project.get("owner_email"))
        manager = db.users.find_one({"email": manager_email}) if manager_email else None
        admin = infer_project_admin(project, manager) or default_admin
        updates = {}

        if manager and admin:
            if not manager.get("team_id"):
                db.users.update_one(
                    {"_id": manager["_id"]},
                    {"$set": {
                        "team_id": admin.get("team_id"),
                        "admin_id": admin.get("email"),
                        "manager_id": None,
                        "updated_at": now,
                    }},
                )
                manager = db.users.find_one({"_id": manager["_id"]})

        if admin:
            updates["team_id"] = project.get("team_id") or admin.get("team_id")
            updates["admin_id"] = project.get("admin_id") or admin.get("email")
        if manager_email:
            updates["assigned_manager"] = manager_email
            updates["owner_email"] = manager_email
            updates["manager_id"] = manager_email
        if updates:
            updates["updated_at"] = now
            db.projects.update_one({"_id": project["_id"]}, {"$set": updates})

    for task in db.tasks.find({}):
        project = db.projects.find_one({"_id": task.get("project_id")})
        if not project:
            continue
        assignees = normalize_assignment_emails(task.get("assigned_users") or task.get("assigned_to") or [])
        for email in assignees:
            user = db.users.find_one({"email": email})
            if user and normalize_role(user.get("role")) == Role.USER.value and not user.get("team_id"):
                db.users.update_one(
                    {"_id": user["_id"]},
                    {"$set": {
                        "team_id": project.get("team_id"),
                        "admin_id": project.get("admin_id"),
                        "manager_id": project.get("manager_id") or project.get("assigned_manager"),
                        "updated_at": now,
                    }},
                )
        db.tasks.update_one(
            {"_id": task["_id"]},
            {"$set": {
                "team_id": task.get("team_id") or project.get("team_id"),
                "admin_id": task.get("admin_id") or project.get("admin_id"),
                "manager_id": task.get("manager_id") or project.get("manager_id") or project.get("assigned_manager"),
                "assigned_user_id": task.get("assigned_user_id") or (assignees[0] if assignees else None),
                "updated_at": now,
            }},
        )
        db.task_assignments.update_many(
            {"task_id": task["_id"]},
            {"$set": {"team_id": project.get("team_id")}},
        )

    for user in db.users.find({"role": {"$in": [Role.MANAGER.value, Role.USER.value]}, "team_id": {"$in": [None, ""]}}):
        if default_admin:
            db.users.update_one(
                {"_id": user["_id"]},
                {"$set": {
                    "team_id": default_admin.get("team_id"),
                    "admin_id": default_admin.get("email"),
                    "manager_id": None,
                    "updated_at": now,
                }},
            )

    for file in db.files.find({}):
        owner = db.users.find_one({"email": normalize_email(file.get("owner_email"))})
        if owner and owner.get("team_id"):
            db.files.update_one(
                {"_id": file["_id"]},
                {"$set": {"team_id": owner.get("team_id"), "admin_id": owner.get("admin_id"), "updated_at": now}},
            )

    for collection in (db.activity_log, db.audit_logs, db.notifications):
        for item in collection.find({"team_id": {"$exists": False}}):
            email = normalize_email(item.get("user_email") or item.get("email") or item.get("user_id") or item.get("user"))
            user = db.users.find_one({"email": email}) if email else None
            if user and user.get("team_id"):
                collection.update_one(
                    {"_id": item["_id"]},
                    {"$set": {"team_id": user.get("team_id"), "admin_id": user.get("admin_id")}},
                )

    print("Multi-tenant migration completed.")


if __name__ == "__main__":
    migrate()
