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
    print("Database connected successfully")

except Exception as e:
    print("Database connection failed:", e)
    sys.exit(1)