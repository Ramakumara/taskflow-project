from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Request

from auth_utils import get_current_user
from services.gemini_service import ask_gemini
from services.project_assistant import (
    answer_message,
    build_workspace_snapshot,
    summarize_workspace,
)
from routes.activity import record_audit_log


router = APIRouter(prefix="/chat", tags=["Chat"])


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=600)


class ChatResponse(BaseModel):
    response: str
    intent: str
    summary: dict
    quick_replies: list[str] = []


@router.post("/", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    snapshot = build_workspace_snapshot(current_user)
    assistant_answer = answer_message(message, snapshot)
    summary = summarize_workspace(snapshot)

    if assistant_answer["intent"] == "assistant":
        record_audit_log(current_user, "AI Usage", f"AI query: {message[:120]}", request)
        gemini_answer = ask_gemini(
            "\n".join(
                [
                    "You are TaskFlow AI, a concise project manager assistant.",
                    "Answer only from the provided TaskFlow summary.",
                    "Do not invent project or task names.",
                    f"User role: {snapshot.role}",
                    f"Projects: {summary['projects']}",
                    f"Tasks: {summary['tasks']}",
                    f"Completed: {summary['completed']}",
                    f"Pending: {summary['pending']}",
                    f"In progress: {summary['in_progress']}",
                    f"Overdue: {summary['overdue']}",
                    f"Overall progress: {summary['progress']}%",
                    f"User question: {message}",
                ]
            )
        )
        if gemini_answer:
            assistant_answer["response"] = gemini_answer

    return ChatResponse(
        response=assistant_answer["response"],
        intent=assistant_answer["intent"],
        summary={
            "projects": summary["projects"],
            "tasks": summary["tasks"],
            "completed": summary["completed"],
            "pending": summary["pending"],
            "in_progress": summary["in_progress"],
            "overdue": summary["overdue"],
            "due_today": summary["due_today"],
            "progress": summary["progress"],
        },
        quick_replies=assistant_answer.get("quick_replies", []),
    )
