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
    db.projects.create_index("assigned_manager")
    db.projects.create_index("status")
    db.tasks.create_index("project_id")
    db.tasks.create_index("assigned_users")
    db.notifications.create_index("user_id")
    db.notifications.create_index("created_at")
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
