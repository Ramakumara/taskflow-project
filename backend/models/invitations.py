from pydantic import BaseModel, EmailStr, validator

class WorkspaceInvitationCreate(BaseModel):
    email: EmailStr
    role: str

    @validator("role")
    def validate_role(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if normalized not in {"user", "manager"}:
            raise ValueError("Role must be User or Manager")
        return "Manager" if normalized == "manager" else "User"

class InvitationResponse(BaseModel):
    success: bool
    message: str
