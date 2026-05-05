from fastapi import APIRouter
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
from fastapi import Header, HTTPException
from passlib.context import CryptContext
from database import db
from fastapi_mail import FastMail, MessageSchema, ConnectionConfig
import re

router = APIRouter()

SECRET_KEY = "your_secret_key_here"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 240
conf = ConnectionConfig(
    MAIL_USERNAME="ramkumarram6073@gmail.com",
    MAIL_PASSWORD="ukfz xxsb sndp spfz",
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

    token = authorization.split(" ")[1]
    payload = verify_token(token)

    if payload is None:
        raise HTTPException(status_code=401, detail="Invalid token")

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

    token = create_reset_token(email)

    reset_link = f"http://localhost:8000/reset-password-page/{token}"

    await send_reset_email(email, reset_link)
    
    return {
        "message": "Reset link sent to your email"
    }

@router.post("/reset-password/{token}")
def reset_password(token: str, data: dict):
    new_password = data.get("new_password")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")

    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    user = db.users.find_one({"email": email})

    if pwd_context.verify(new_password, user["password"]):
        return {"message": "New password cannot be same as old password"}

    validate_password(new_password)
    hashed_password = pwd_context.hash(new_password)

    db.users.update_one(
        {"email": email},
        {"$set": {"password": hashed_password}}
    )

    return {"message": "Password updated successfully"}

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