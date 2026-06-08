import argparse
from datetime import datetime, timezone
from getpass import getpass

from auth_utils import validate_password
from database import db
from passlib.context import CryptContext
from rbac import Role


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def main():
    parser = argparse.ArgumentParser(description="Provision the first TaskFlow Super Admin account.")
    parser.add_argument("--email", required=True, help="Super Admin email address")
    parser.add_argument("--username", required=True, help="Super Admin display name")
    parser.add_argument("--password", help="Password. If omitted, you will be prompted securely.")
    args = parser.parse_args()

    email = args.email.strip().lower()
    username = args.username.strip()
    password = args.password or getpass("Super Admin password: ")

    validate_password(password)
    now = datetime.now(timezone.utc).isoformat()

    existing = db.users.find_one({"email": email})
    document = {
        "username": username,
        "email": email,
        "password": pwd_context.hash(password),
        "role": Role.SUPER_ADMIN.value,
        "status": "active",
        "updated_at": now,
    }

    if existing:
        document["created_at"] = existing.get("created_at") or now
        document["last_login"] = existing.get("last_login")
        db.users.update_one({"email": email}, {"$set": document})
        print(f"Updated existing account {email} to Super Admin.")
        return

    document["created_at"] = now
    document["last_login"] = None
    db.users.insert_one(document)
    print(f"Created Super Admin account {email}.")


if __name__ == "__main__":
    main()
