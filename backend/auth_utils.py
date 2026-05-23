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
ACCESS_TOKEN_EXPIRE_MINUTES = 240
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
        subject="TaskFlow Password Reset OTP",
        recipients=[email],
        body=f"""
    Your OTP is:

    {otp}

    This OTP expires in 5 minutes.
        """,
        subtype="plain"
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