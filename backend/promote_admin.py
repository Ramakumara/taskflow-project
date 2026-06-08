import argparse

from database import db
from rbac import Role
from taskflow_utils import ensure_admin_team, utc_now_iso


def main():
    parser = argparse.ArgumentParser(description="Promote an existing TaskFlow account to Admin and create its team.")
    parser.add_argument("--email", required=True, help="Existing user email to promote")
    args = parser.parse_args()

    email = args.email.strip().lower()
    user = db.users.find_one({"email": email})
    if not user:
        raise SystemExit(f"User not found: {email}")

    db.users.update_one(
        {"_id": user["_id"]},
        {
            "$set": {
                "role": Role.ADMIN.value,
                "admin_id": email,
                "manager_id": None,
                "status": user.get("status") or "active",
                "updated_at": utc_now_iso(),
            }
        },
    )
    updated = db.users.find_one({"email": email})
    ensure_admin_team(updated)
    updated = db.users.find_one({"email": email})
    print(f"Promoted {email} to admin with team_id={updated.get('team_id')}")


if __name__ == "__main__":
    main()
