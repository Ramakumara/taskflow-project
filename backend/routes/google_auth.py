from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from auth.google_oauth import oauth
from auth_utils import create_access_token
from database import db
from rbac import Role, normalize_role
from taskflow_utils import ensure_admin_team

router = APIRouter()

FRONTEND_URL = "http://localhost:8000"


def post_login_path(role: str) -> str:
    normalized_role = normalize_role(role)
    if normalized_role == Role.SUPER_ADMIN.value:
        return "/super-admin"
    if normalized_role == Role.ADMIN.value:
        return "/admin-page"
    return "/dashboard-page"

@router.get("/login/google")
async def login_google(request: Request):
    redirect_uri = "http://localhost:8000/auth/google"
    return await oauth.google.authorize_redirect(request, redirect_uri)

@router.get("/auth/google")
async def auth_google(request: Request):
    try:
        code = request.query_params.get("code")

        if not code:
            return {"error": "No code received"}

        token = await oauth.google.fetch_access_token(
            grant_type="authorization_code",
            code=code,
            redirect_uri="http://localhost:8000/auth/google"
        )

        user = await oauth.google.userinfo(token=token)

        email = user.get("email")
        name = user.get("name")
        existing_user = db.users.find_one({"email": email})

        if not existing_user:
            db.users.insert_one({
                "username": name,
                "email": email,
                "role": Role.USER.value
            })
            user_role = Role.USER.value
        else:
            user_role = normalize_role(existing_user.get("role"))
            name = existing_user.get("username") or name
            if user_role == Role.ADMIN.value:
                ensure_admin_team(existing_user)
                existing_user = db.users.find_one({"email": email}) or existing_user

        jwt_token = create_access_token({
            "email": email,
            "username": name,
            "role": user_role,
            "user_id": str((existing_user or {}).get("_id", "")),
            "team_id": (existing_user or {}).get("team_id"),
            "admin_id": (existing_user or {}).get("admin_id"),
            "manager_id": (existing_user or {}).get("manager_id"),
        })

        return RedirectResponse(
            f"{FRONTEND_URL}{post_login_path(user_role)}?token={jwt_token}&username={name}&email={email}&role={user_role}&team_id={(existing_user or {}).get('team_id') or ''}&admin_id={(existing_user or {}).get('admin_id') or ''}&manager_id={(existing_user or {}).get('manager_id') or ''}"
        )

    except Exception as e:
        print(" ERROR:", str(e))
        return {"error": str(e)}
