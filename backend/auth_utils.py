from fastapi import APIRouter
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
from fastapi import Header, HTTPException
from passlib.context import CryptContext
from database import db
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig
import re
import random

router = APIRouter()

SECRET_KEY = "your_secret_key_here"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440
conf = ConnectionConfig(
    MAIL_USERNAME="ramkumarram6073@gmail.com",
    MAIL_PASSWORD="fjus euiw bhvz idyb",
    MAIL_FROM="ramkumarram6073@gmail.com",
    MAIL_PORT=587,
    MAIL_SERVER="smtp.gmail.com",
    MAIL_STARTTLS=True,
    MAIL_SSL_TLS=False
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def validate_password(password:str):
    pattern = r"^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&]).{8,}$"

    if not re.match(pattern, password):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 character,\ninclude at least 1 number,\ninclude at least1 letter, \ninclude at least 1 symbol"
        )

def generate_otp():
    return str(random.randint(100000, 999999))

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})

    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def get_current_user(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Token missing")

    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = parts[1]
    payload = verify_token(token)

    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    email = payload.get("email")
    if email:
        user = db.users.find_one({"email": email}, {"_id": 0, "email": 1, "username": 1, "role": 1})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        payload.update({
            "email": user.get("email"),
            "username": user.get("username"),
            "role": user.get("role") or "user"
        })

    return payload

def create_reset_token(email:str):
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    data = {"sub" : email, "exp": expire}
    return jwt.encode(data, SECRET_KEY, algorithm=ALGORITHM)

async def send_reset_email(email: str, reset_link: str):
    message = MessageSchema(
        subject="Password Reset Request",
        recipients=[email],
        body=f"Click the link to reset your password:\n{reset_link}",
        subtype="plain"
    )

    fm = FastMail(conf)
    await fm.send_message(message)

@router.post("/forgot-password")
async def forgot_password(data: dict):
    email = data.get("email")

    user = db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    otp = generate_otp()

    expires_at = datetime.utcnow() + timedelta(minutes=5)

    db.password_otps.update_one(
        {"email": email},
        {
            "$set": {
                "otp": otp,
                "expires_at": expires_at
            }
        },
        upsert=True
    )

    message = MessageSchema(
    subject="Your OTP for TaskFlow Verification",
    recipients=[email],
    body=f"""
    <html>
    <body style="
        margin:0;
        padding:20px;
        background:#f6f8fb;
        font-family:'Segoe UI', Arial, sans-serif;
    ">

    <div style="
        max-width:380px;
        margin:auto;
        background:#ffffff;
        border:1px solid #e8ecef;
        border-radius:14px;
        padding:22px;
        box-shadow:0 3px 10px rgba(0,0,0,0.05);
        text-align:left ;
    ">

        <!-- Top Icon -->
        <div style="
            width:48px;
            height:48px;
            background:#eaf8ef;
            border-radius:50%;
            margin:0 auto 14px;
            line-height:48px;
            font-size:24px;
        ">
            ✅
        </div>

        <!-- Heading -->
        <h2 style="
            margin:0;
            color:#111827;
            font-size:22px;
            font-weight:600;
        ">
            Your One-Time Password (OTP)
        </h2>

        <p style="
            color:#6b7280;
            font-size:13px;
            margin:10px 0 20px;
            line-height:1.5;
        ">
            Use the OTP below to verify your email and continue.
        </p>

        <!-- OTP BOXES -->
        <div style="
            background:#f5fbf7;
            border:1px solid #d8efe0;
            border-radius:10px;
            padding:12px;
            display:inline-block;
        ">

            <span style="
                display:inline-block;
                width:38px;
                height:42px;
                line-height:42px;
                margin:2px;
                border:1px solid #cfe8d8;
                border-radius:8px;
                background:#fff;
                color:#0f7a3b;
                font-size:26px;
                font-weight:700;
            ">{otp[0]}</span>

            <span style="
                display:inline-block;
                width:38px;
                height:42px;
                line-height:42px;
                margin:2px;
                border:1px solid #cfe8d8;
                border-radius:8px;
                background:#fff;
                color:#0f7a3b;
                font-size:26px;
                font-weight:700;
            ">{otp[1]}</span>

            <span style="
                display:inline-block;
                width:38px;
                height:42px;
                line-height:42px;
                margin:2px;
                border:1px solid #cfe8d8;
                border-radius:8px;
                background:#fff;
                color:#0f7a3b;
                font-size:26px;
                font-weight:700;
            ">{otp[2]}</span>

            <span style="
                display:inline-block;
                width:38px;
                height:42px;
                line-height:42px;
                margin:2px;
                border:1px solid #cfe8d8;
                border-radius:8px;
                background:#fff;
                color:#0f7a3b;
                font-size:26px;
                font-weight:700;
            ">{otp[3]}</span>

            <span style="
                display:inline-block;
                width:38px;
                height:42px;
                line-height:42px;
                margin:2px;
                border:1px solid #cfe8d8;
                border-radius:8px;
                background:#fff;
                color:#0f7a3b;
                font-size:26px;
                font-weight:700;
            ">{otp[4]}</span>

            <span style="
                display:inline-block;
                width:38px;
                height:42px;
                line-height:42px;
                margin:2px;
                border:1px solid #cfe8d8;
                border-radius:8px;
                background:#fff;
                color:#0f7a3b;
                font-size:26px;
                font-weight:700;
            ">{otp[5]}</span>

        </div>

        <p style="
            color:#6b7280;
            font-size:13px;
            margin:18px 0 14px;
        ">
            This OTP is valid for
            <span style="color:#16a34a;font-weight:600;">
                5 minutes
            </span>
        </p>

        <hr style="
            border:none;
            border-top:1px solid #edf1f4;
            margin:16px 0;
        ">

        <div style="
            display:flex;
            align-items:flex-start;
            text-align:left;
            gap:10px;
        ">
            <div style="
                width:34px;
                height:34px;
                background:#eaf8ef;
                border-radius:50%;
                text-align:center;
                line-height:34px;
                font-size:16px;
            ">
                🔒
            </div>

            <p style="
                margin:0;
                color:#6b7280;
                font-size:12px;
                line-height:1.5;
            ">
                If you didn’t request this OTP, please ignore this email.
            </p>
        </div>

        <div style="
            margin-top:20px;
            text-align:left;
            color:#374151;
            font-size:13px;
        ">
            Thanks,<br>
            <strong>TaskFlow Team</strong>
        </div>

    </div>
    </body>
    </html>
    """,
    subtype="html"
)
    
    fm = FastMail(conf)
    await fm.send_message(message)

    return {
        "message": "OTP sent successfully"
    }

@router.post("/verify-otp")
def verify_otp(data: dict):

    email = data.get("email")
    otp = data.get("otp")

    otp_record = db.password_otps.find_one({"email": email})

    if not otp_record:
        raise HTTPException(status_code=404, detail="OTP not found")

    if otp_record["otp"] != otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")

    if datetime.utcnow() > otp_record["expires_at"]:
        raise HTTPException(status_code=400, detail="OTP expired")

    return {
        "message": "OTP verified"
    }   



async def send_task_email(email: str, task_title: str, assigned_by: str):
    message = MessageSchema(
        subject="📌 New Task Assigned",
        recipients=[email],
        body=f"""
        <div style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #2c3e50;">New Task Assigned</h2>
            
            <p>Hello,</p>
            
            <p>You have been assigned a new task:</p>
            
            <div style="
                background-color: #f4f6f7;
                padding: 15px;
                border-left: 5px solid #3498db;
                margin: 10px 0;
                font-size: 16px;
            ">
                <b>{task_title}</b>
            </div>
            <p><b>Assigned by:</b> {assigned_by}</p>

            <p>Please log in to your dashboard to complete the task.</p>

            <br>

            <a href="http://127.0.0.1:8000/" 
               style="
                   background-color: #3498db;
                   color: white;
                   padding: 10px 15px;
                   text-decoration: none;
                   border-radius: 5px;
               ">
               Go to Dashboard
            </a>

            <br><br>

            <p style="color: gray; font-size: 12px;">
                This is an automated message from TaskFlow System.
            </p>
        </div>
        """,
        subtype="html"
    )

    fm = FastMail(conf)
    await fm.send_message(message)


async def send_reminder_email(email: str, task_title: str, deadline: str):

    message = MessageSchema(
        subject="⏰ Task Reminder",
        recipients=[email],
        body=f"""
        <div style="font-family: Arial, sans-serif; padding:20px;">

            <h2 style="color:#e67e22;">
                Task Deadline Reminder
            </h2>

            <p>Hello,</p>

            <p>Your task deadline is approaching.</p>

            <div style="
                background:#f4f6f7;
                padding:15px;
                border-left:5px solid orange;
                margin:10px 0;
            ">
                <b>Task:</b> {task_title}<br>
                <b>Deadline:</b> {deadline}
            </div>

            <p>Please complete the task before deadline.</p>

            <a href="http://127.0.0.1:8000/"
               style="
                   background:#3498db;
                   color:white;
                   padding:10px 15px;
                   text-decoration:none;
                   border-radius:5px;
               ">
               Open TaskFlow
            </a>

            <br><br>

            <p style="font-size:12px; color:gray;">
                Automated reminder from TaskFlow
            </p>

        </div>
        """,
        subtype="html"
    )

    fm = FastMail(conf)

    await fm.send_message(message)

@router.post("/reset-password")
def reset_password(data: dict):

    email = data.get("email")
    new_password = data.get("new_password")

    validate_password(new_password)

    user = db.users.find_one({"email": email})

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found"
        )

    hashed_password = pwd_context.hash(new_password)

    db.users.update_one(
        {"email": email},
        {
            "$set": {
                "password": hashed_password
            }
        }
    )

    db.password_otps.delete_one({"email": email})

    return {
        "message": "Password reset successful"
    }

async def send_project_assignment_email(
    email: str,
    project_name: str,
    assigned_by: str
):
    message = MessageSchema(
        subject="📁 New Project Assigned",
        recipients=[email],
        body=f"""
        <div style="font-family:Arial;padding:20px;">
            <h2 style="color:#2c3e50;">
                New Project Assignment
            </h2>

            <p>Hello Manager,</p>

            <p>You have been assigned a new project.</p>

            <div style="
                background:#f4f6f7;
                padding:15px;
                border-left:5px solid #3498db;
                margin:10px 0;
            ">
                <b>Project:</b> {project_name}
            </div>

            <p>
                <b>Assigned By:</b>
                {assigned_by}
            </p>

            <p>
                Please login to TaskFlow dashboard
                and manage this project.
            </p>

            <a href="http://127.0.0.1:8000/"
               style="
                   background:#3498db;
                   color:white;
                   padding:10px 15px;
                   text-decoration:none;
                   border-radius:5px;
               ">
               Open TaskFlow
            </a>

            <br><br>

            <p style="font-size:12px;color:gray;">
                TaskFlow Project Management System
            </p>
        </div>
        """,
        subtype="html"
    )

    fm = FastMail(conf)
    await fm.send_message(message)


async def send_account_creation_email(
    email: str,
    username: str,
    temporary_password: str,
    role: str,
):
    message = MessageSchema(
        subject="Welcome to TaskFlow - Your Temporary Password",
        recipients=[email],
        body=f"""
        <div style="font-family:Arial,sans-serif;padding:20px;color:#172033;">
            <h2 style="color:#16a34a;margin:0 0 16px;">Your TaskFlow account is ready</h2>

            <p>Hello {username or "there"},</p>

            <p>An administrator created a TaskFlow account for you.</p>

            <div style="
                background:#f8fafc;
                border:1px solid #dbe4ef;
                border-radius:10px;
                padding:16px;
                margin:16px 0;
            ">
                <p style="margin:0 0 8px;"><b>Email:</b> {email}</p>
                <p style="margin:0 0 8px;"><b>Role:</b> {role}</p>
                <p style="margin:0;"><b>Temporary Password:</b> {temporary_password}</p>
            </div>

            <p>Please sign in and change this password as soon as possible.</p>

            <a href="http://127.0.0.1:8000/"
               style="
                   display:inline-block;
                   background:#16a34a;
                   color:white;
                   padding:10px 16px;
                   text-decoration:none;
                   border-radius:8px;
                   font-weight:700;
               ">
               Open TaskFlow
            </a>

            <p style="margin-top:20px;font-size:12px;color:#667085;">
                This is an automated message from TaskFlow.
            </p>
        </div>
        """,
        subtype="html"
    )

    fm = FastMail(conf)
    await fm.send_message(message)
