from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import os
from routes import user, project, task, file, activity
from auth_utils import router as auth_router
from auth.google_oauth import init_oauth
from routes.google_auth import router as google_router
from starlette.middleware.sessions import SessionMiddleware
from fastapi import WebSocket, WebSocketDisconnect
from websocket_manager import manager


app = FastAPI()

clients = []

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

    await websocket.accept()
    clients.append(websocket)

    try:
        while True:
            data = await websocket.receive_text()

            for client in clients:
                await client.send_text(data)

    except WebSocketDisconnect:
        clients.remove(websocket)