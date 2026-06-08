from pymongo import MongoClient
from dotenv import load_dotenv
import os
import sys

load_dotenv()

MONGO_URL = os.getenv("MONGO_URL")
DB_NAME = os.getenv("DB_NAME", "task_manager")

if not MONGO_URL:
    print(" MONGO_URL is missing in .env file")
    sys.exit(1)

try:
    client = MongoClient(
        MONGO_URL,
        serverSelectionTimeoutMS=5000  
    )

    client.server_info()
    db = client[DB_NAME]
    db.users.create_index("email", unique=True)
    db.users.create_index("team_id")
    db.users.create_index([("team_id", 1), ("role", 1)])
    db.users.create_index("admin_id")
    db.users.create_index("manager_id")
    db.teams.create_index("admin_id", unique=True)
    db.teams.create_index("status")
    db.invitations.create_index("token", unique=True)
    db.invitations.create_index([("team_id", 1), ("status", 1)])
    db.invitations.create_index("email")
    db.workspace_invitations.create_index(
        [("workspace_id", 1), ("receiver_id", 1), ("status", 1)]
    )
    db.workspace_members.create_index(
        [("workspace_id", 1), ("user_id", 1)],
        unique=True
    )
    db.workspace_members.create_index("email")
    db.projects.create_index("assigned_manager")
    db.projects.create_index("team_id")
    db.projects.create_index("admin_id")
    db.projects.create_index("manager_id")
    db.projects.create_index("status")
    db.tasks.create_index("project_id")
    db.tasks.create_index("team_id")
    db.tasks.create_index("manager_id")
    db.tasks.create_index("assigned_user_id")
    db.tasks.create_index("assigned_users")
    db.notifications.create_index("user_id")
    db.notifications.create_index("email")
    db.notifications.create_index("invitation_id")
    db.notifications.create_index("created_at")
    db.audit_logs.create_index("timestamp")
    db.audit_logs.create_index("action")
    db.audit_logs.create_index("team_id")
    db.activity_log.create_index("team_id")
    db.system_settings.create_index("key", unique=True)
    db.platform_stats.create_index("generated_at")
    db.notifications.create_index(
        "expires_at",
        expireAfterSeconds=0
    )
    db.password_otps.create_index(
        "expires_at",
        expireAfterSeconds=0
    )
    db.task_assignments.create_index(
        [("task_id", 1), ("user_id", 1)],
        name="task_id_1_user_id_1",
        unique=True
    )
    print("Database connected successfully")

except Exception as e:
    print("Database connection failed:", e)
    sys.exit(1)
