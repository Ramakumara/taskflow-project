from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from auth.google_oauth import oauth
from auth_utils import create_access_token
from database import db

router = APIRouter()

FRONTEND_URL = "http://localhost:8000/dashboard-page"

@router.get("/login/google")
async def login_google(request: Request):
    redirect_uri = "http://localhost:8000/auth/google"
    return await oauth.google.authorize_redirect(request, redirect_uri)

@router.get("/auth/google")
async def auth_google(request: Request):
    try:
        # ✅ get code manually
        code = request.query_params.get("code")

        if not code:
            return {"error": "No code received"}

        # ✅ exchange code manually
        token = await oauth.google.fetch_access_token(
            grant_type="authorization_code",
            code=code,
            redirect_uri="http://localhost:8000/auth/google"
        )

        # ✅ get user info
        user = await oauth.google.userinfo(token=token)

        email = user.get("email")
        name = user.get("name")
        existing_user = db.users.find_one({"email": email})

        if not existing_user:
            db.users.insert_one({
                "username": name,
                "email": email,
                "role": "user"
            })

        jwt_token = create_access_token({
            "email": email,
            "username": name,
            "role": "user"
        })

        return RedirectResponse(
            f"http://localhost:8000/dashboard-page?token={jwt_token}&username={name}&email={email}&role=user"
        )

    except Exception as e:
        print("🔥 ERROR:", str(e))
        return {"error": str(e)}