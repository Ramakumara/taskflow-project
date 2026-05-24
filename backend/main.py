from contextlib import asynccontextmanager
import json
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from routes import user, project, task, file, activity
from auth_utils import router as auth_router
from auth.google_oauth import init_oauth
from routes.google_auth import router as google_router
from starlette.middleware.sessions import SessionMiddleware
from websocket_manager import manager
from routes.notifications import router as notification_router
from auth_utils import verify_token
from database import db


@asynccontextmanager
async def lifespan(app: FastAPI):
    await manager.startup()
    yield
    await manager.shutdown()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    SessionMiddleware,
    secret_key="super-secret-key",
    same_site="lax",
    https_only=False
)

oauth = init_oauth(app)

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "..", "frontend")), name="static")



app.include_router(user.router)
app.include_router(project.router)
app.include_router(task.router)
app.include_router(file.router, prefix="/files")
app.include_router(activity.router)
app.include_router(auth_router)
app.include_router(google_router)
app.include_router(notification_router)


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.get("/")
def login_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "login.html")
    )

@app.get("/register-page")
def register_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "register.html")
    )


@app.get("/about-us")
def about_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "about.html")
    )

@app.get("/features")
def features_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "features.html")
    )

@app.get("/pricing")
def pricing_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "pricing.html")
    )

@app.get("/contact")
def contact_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "contact.html")
    )

@app.get("/privacy-policy")
def privacy_policy_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "privacy.html")
    )

@app.get("/terms-of-service")
def terms_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "terms.html")
    )

@app.get("/help-center")
def help_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "help.html")
    )


@app.get("/dashboard-page")
def dashboard_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "dashboard.html")
    )

@app.get("/status-overview-page")
def status_overview_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "statusoverview.html")
    )

@app.get("/project-page")
def project_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "project.html")
    )

@app.get("/admin-page")
def admin_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "admin.html")
    )

@app.get("/forgot-page")
def forgot_page():
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "forgot.html")
    )

@app.get("/reset-password-page/{token}")
def reset_password_page(token: str):
    return FileResponse(
        os.path.join(BASE_DIR, "..", "frontend", "html", "reset.html")
    )

from fastapi import Request

@app.get("/test-session")
def test_session(request: Request):
    request.session["test"] = "working"
    return {"session": request.session.get("test")}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    payload = verify_token(token)
    if not payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_email = str(payload.get("email") or "").strip().lower()
    if not user_email:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user = db.users.find_one(
        {"email": user_email},
        {"_id": 0, "email": 1, "username": 1, "role": 1},
    )
    if not user:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    connection = await manager.connect(websocket, user)

    await manager.send_to_user(
        user_email,
        {
            "type": "system.connected",
            "message": "Realtime connected",
            "data": {
                "connection_id": connection["connection_id"],
                "email": user_email,
                "role": user.get("role"),
            },
        }
    )

    try:
        while True:
            data = await websocket.receive_text()
            await manager.touch(websocket)

            try:
                incoming = json.loads(data)
                event_type = str(incoming.get("type") or "").strip().lower()
                if event_type in {"system.ping", "ping", "heartbeat"}:
                    await manager.send_to_user(
                        user_email,
                        {
                            "type": "system.pong",
                            "message": "Heartbeat acknowledged",
                            "data": {
                                "connection_id": connection["connection_id"],
                            },
                        }
                    )
            except Exception:
                pass

    except WebSocketDisconnect:
        await manager.disconnect(websocket, user_email)
    except Exception:
        await manager.disconnect(websocket, user_email)
        try:
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        except Exception:
            pass
    finally:
        await manager.disconnect(websocket, user_email)
