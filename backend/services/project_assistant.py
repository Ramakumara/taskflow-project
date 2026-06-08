from __future__ import annotations
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any

from database import db
from rbac import Role, normalize_role
from taskflow_utils import (
    get_visible_project_filter,
    get_visible_task_filter,
    normalize_task_status,
    serialize_project,
    serialize_task,
)


HIGH_PRIORITY = {"High", "Urgent"}


@dataclass
class WorkspaceSnapshot:
    user: dict[str, Any]
    role: str
    projects: list[dict[str, Any]]
    tasks: list[dict[str, Any]]
    today: date


def _parse_date(value: Any) -> date | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).date() if value.tzinfo else value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text:
        return None

    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y"):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            pass

    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def _task_due_date(task: dict[str, Any]) -> date | None:
    return _parse_date(task.get("due_date") or task.get("deadline"))


def _task_title(task: dict[str, Any]) -> str:
    return str(task.get("task_title") or task.get("title") or "Untitled task")


def _project_name(project: dict[str, Any]) -> str:
    return str(project.get("project_name") or project.get("name") or "Untitled project")


def _completion_percent(completed: int, total: int) -> int:
    return round((completed / total) * 100) if total else 0


def _scope_label(role: str) -> str:
    if role in {Role.SUPER_ADMIN.value, Role.ADMIN.value}:
        return "all TaskFlow projects and tasks"
    if role == Role.MANAGER.value:
        return "projects you manage and their team tasks"
    return "tasks assigned to you"


def build_workspace_snapshot(current_user: dict[str, Any]) -> WorkspaceSnapshot:
    role = normalize_role(current_user.get("role"))
    projects = [
        serialize_project(item)
        for item in db.projects.find(get_visible_project_filter(current_user)).sort("created_at", -1)
    ]
    tasks = [
        serialize_task(item)
        for item in db.tasks.find(get_visible_task_filter(current_user)).sort("created_at", -1)
    ]

    return WorkspaceSnapshot(
        user=current_user,
        role=role,
        projects=projects,
        tasks=tasks,
        today=datetime.combine(date.today(), time.min).date(),
    )


def summarize_workspace(snapshot: WorkspaceSnapshot) -> dict[str, Any]:
    status_counts = Counter(
        normalize_task_status(task.get("overall_status") or task.get("status"))
        for task in snapshot.tasks
    )
    total_tasks = len(snapshot.tasks)
    completed = status_counts.get("Completed", 0)
    pending = status_counts.get("Pending", 0)
    in_progress = status_counts.get("In Progress", 0)

    active_tasks = [
        task
        for task in snapshot.tasks
        if normalize_task_status(task.get("overall_status") or task.get("status")) != "Completed"
    ]
    overdue = [
        task
        for task in active_tasks
        if (due := _task_due_date(task)) and due < snapshot.today
    ]
    due_today = [
        task
        for task in active_tasks
        if _task_due_date(task) == snapshot.today
    ]
    due_this_week = [
        task
        for task in active_tasks
        if (due := _task_due_date(task)) and 0 <= (due - snapshot.today).days <= 7
    ]
    high_priority_open = [
        task
        for task in active_tasks
        if str(task.get("priority") or "").strip().title() in HIGH_PRIORITY
    ]

    return {
        "projects": len(snapshot.projects),
        "tasks": total_tasks,
        "completed": completed,
        "pending": pending,
        "in_progress": in_progress,
        "overdue": len(overdue),
        "due_today": len(due_today),
        "due_this_week": len(due_this_week),
        "high_priority_open": len(high_priority_open),
        "progress": _completion_percent(completed, total_tasks),
        "overdue_tasks": overdue,
        "due_today_tasks": due_today,
        "high_priority_tasks": high_priority_open,
        "active_tasks": active_tasks,
    }


def _sorted_action_tasks(tasks: list[dict[str, Any]], today: date) -> list[dict[str, Any]]:
    priority_rank = {"Urgent": 0, "High": 1, "Medium": 2, "Low": 3}

    def sort_key(task: dict[str, Any]):
        due = _task_due_date(task)
        return (
            0 if due and due < today else 1,
            priority_rank.get(str(task.get("priority") or "Medium").title(), 2),
            due or date.max,
            _task_title(task).lower(),
        )

    return sorted(tasks, key=sort_key)


def _format_task_list(tasks: list[dict[str, Any]], limit: int = 4) -> list[str]:
    rows = []
    for task in tasks[:limit]:
        due = _task_due_date(task)
        due_text = f" due {due.strftime('%d %b')}" if due else " with no due date"
        rows.append(f"- {_task_title(task)} ({task.get('priority', 'Medium')}, {normalize_task_status(task.get('status'))},{due_text})")
    return rows


def project_attention(snapshot: WorkspaceSnapshot) -> dict[str, Any] | None:
    if not snapshot.projects:
        return None

    project_map = {str(project.get("id")): project for project in snapshot.projects}
    stats: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "total": 0,
            "completed": 0,
            "pending": 0,
            "overdue": 0,
            "high_priority": 0,
        }
    )

    for task in snapshot.tasks:
        project_id = str(task.get("project_id") or "")
        if project_id not in project_map:
            continue
        status = normalize_task_status(task.get("overall_status") or task.get("status"))
        bucket = stats[project_id]
        bucket["total"] += 1
        if status == "Completed":
            bucket["completed"] += 1
        else:
            bucket["pending"] += 1
            if str(task.get("priority") or "").title() in HIGH_PRIORITY:
                bucket["high_priority"] += 1
            due = _task_due_date(task)
            if due and due < snapshot.today:
                bucket["overdue"] += 1

    if not stats:
        return None

    def score(item):
        project_id, values = item
        return (
            values["overdue"] * 5
            + values["high_priority"] * 3
            + values["pending"] * 2
            - values["completed"],
            values["pending"],
            values["total"],
            _project_name(project_map[project_id]),
        )

    project_id, values = max(stats.items(), key=score)
    progress = _completion_percent(values["completed"], values["total"])
    return {
        "project": project_map[project_id],
        "stats": values,
        "progress": progress,
    }


def detect_intent(message: str) -> str:
    text = f" {message.lower().strip()} "
    compact = " ".join(text.split())

    if compact in {"hi", "hello", "hey", "hii", "good morning", "good afternoon", "good evening" "hiii"}:
        return "greeting"
    if any(word in text for word in (" future ", " roadmap ", " coming soon ", " prediction ", " weekly report ")):
        return "future"
    if any(word in text for word in (" summary ", " dashboard ", " progress ", " report ", " overview ")):
        return "summary"
    if any(phrase in compact for phrase in ("how is my work", "current workload", "workload", "work going")):
        return "workload"
    if any(phrase in compact for phrase in ("behind schedule", "behind", "late", "at risk")):
        return "risk"
    if any(word in text for word in (" overdue ", " delayed ")):
        return "overdue"
    if any(phrase in compact for phrase in ("what should i do", "focus today", "do today", "focus on today", "recommend")):
        return "recommendation"
    if any(phrase in compact for phrase in ("needs attention", "need attention", "which project", "attention project")):
        return "project_attention"
    if " pending " in text:
        return "pending"
    if any(word in text for word in (" task ", " tasks ")):
        return "tasks"
    if any(word in text for word in (" project ", " projects ")):
        return "projects"
    return "assistant"


def answer_message(message: str, snapshot: WorkspaceSnapshot) -> dict[str, Any]:
    intent = detect_intent(message)
    summary = summarize_workspace(snapshot)
    username = str(snapshot.user.get("username") or snapshot.user.get("email") or "there").split("@")[0]
    quick_replies = [
        "What should I focus on today?",
        "Show project progress",
        "Which project needs attention?",
    ]

    if intent == "greeting":
        return {
            "intent": intent,
            "response": f"👋 Hello {username}! I can help you track tasks, spot overdue work, review project progress, and decide what to focus on today.",
            "quick_replies": quick_replies,
        }

    if intent in {"summary", "workload"}:
        heading = "📊 Dashboard Summary" if intent == "summary" else "📊 Workload Check"
        recommendation = _recommendation_line(summary, snapshot)
        return {
            "intent": intent,
            "response": "\n".join(
                [
                    heading,
                    "",
                    f"Projects: {summary['projects']}",
                    f"Tasks: {summary['tasks']}",
                    f"Completed: {summary['completed']}",
                    f"Pending: {summary['pending']}",
                    f"In progress: {summary['in_progress']}",
                    f"Overdue: {summary['overdue']}",
                    "",
                    f"Overall progress: {summary['progress']}%",
                    "",
                    recommendation,
                ]
            ),
            "quick_replies": quick_replies,
        }

    if intent == "risk":
        if summary["overdue"]:
            rows = _format_task_list(_sorted_action_tasks(summary["overdue_tasks"], snapshot.today), 3)
            return {
                "intent": intent,
                "response": "\n".join(["⚠️ You are behind on overdue work.", "", *rows, "", "Start with the oldest overdue task, then move to high-priority pending work."]),
                "quick_replies": ["What should I do today?", "Show overdue tasks"],
            }
        if summary["due_today"]:
            return {
                "intent": intent,
                "response": f"🟡 You are not overdue, but {summary['due_today']} task is due today. Finish today’s due work before starting new tasks.",
                "quick_replies": ["What should I do today?", "Give me a summary"],
            }
        return {
            "intent": intent,
            "response": "✅ You are not behind schedule right now. Keep momentum by closing pending and high-priority tasks next.",
            "quick_replies": quick_replies,
        }

    if intent == "overdue":
        if not summary["overdue"]:
            return {"intent": intent, "response": "✅ No overdue tasks in your current TaskFlow scope.", "quick_replies": quick_replies}
        rows = _format_task_list(_sorted_action_tasks(summary["overdue_tasks"], snapshot.today), 5)
        return {
            "intent": intent,
            "response": "\n".join([f"⚠️ You have {summary['overdue']} overdue task(s):", "", *rows, "", "Recommendation: clear overdue work first before starting new tasks."]),
            "quick_replies": ["What should I do today?", "Which project needs attention?"],
        }

    if intent == "recommendation":
        tasks = _sorted_action_tasks(summary["active_tasks"], snapshot.today)
        if not tasks:
            return {
                "intent": intent,
                "response": "✅ You have no open tasks in your current scope. Good time to review completed work or plan the next project milestone.",
                "quick_replies": quick_replies,
            }
        rows = _format_task_list(tasks, 4)
        return {
            "intent": intent,
            "response": "\n".join(["🎯 Today’s Focus", "", "Start with overdue tasks, then complete high-priority pending tasks.", "", *rows]),
            "quick_replies": ["Give me a summary", "What tasks are overdue?"],
        }

    if intent == "project_attention":
        attention = project_attention(snapshot)
        if not attention:
            return {"intent": intent, "response": "No project needs attention yet because there are no visible project tasks in your scope.", "quick_replies": quick_replies}
        project = attention["project"]
        stats = attention["stats"]
        return {
            "intent": intent,
            "response": "\n".join(
                [
                    f"📌 {_project_name(project)} needs the most attention.",
                    "",
                    f"Pending tasks: {stats['pending']}",
                    f"Overdue tasks: {stats['overdue']}",
                    f"High-priority open tasks: {stats['high_priority']}",
                    f"Progress: {attention['progress']}%",
                    "",
                    "Recommendation: review blockers, assign owners clearly, and close overdue/high-priority tasks first.",
                ]
            ),
            "quick_replies": ["What should I do today?", "Show project progress"],
        }

    if intent == "pending":
        return {
            "intent": intent,
            "response": f"📌 You have {summary['pending']} pending task(s) in {_scope_label(snapshot.role)}.",
            "quick_replies": ["What should I do today?", "Give me a summary"],
        }

    if intent == "tasks":
        return {
            "intent": intent,
            "response": f"📋 You have access to {summary['tasks']} task(s): {summary['completed']} completed, {summary['pending']} pending, {summary['in_progress']} in progress, and {summary['overdue']} overdue.",
            "quick_replies": quick_replies,
        }

    if intent == "projects":
        return {
            "intent": intent,
            "response": f"🗂️ You have access to {summary['projects']} project(s) ",
            "quick_replies": ["Which project needs attention?", "Show project progress"],
        }

    if intent == "future":
        return {
            "intent": intent,
            "response": "\n".join(
                [
                    "🚀 Future Assistant Features",
                    "",
                    "- ML-based completion prediction",
                    "- Due date risk prediction",
                    "- Team productivity analysis",
                    "- Notification summaries",
                    "- Task prioritization suggestions",
                    "- Weekly project reports",
                ]
            ),
            "quick_replies": quick_replies,
        }

    return {
        "intent": intent,
        "response": "\n".join(
            [
                "I can help with TaskFlow project management questions.",
                "",
                "Try asking:",
                "- What is my current workload?",
                "- What should I focus on today?",
                "- Am I behind schedule?",
                "- Which project needs attention?",
                "- Give me a dashboard summary.",
            ]
        ),
        "quick_replies": quick_replies,
    }


def _recommendation_line(summary: dict[str, Any], snapshot: WorkspaceSnapshot) -> str:
    if summary["overdue"]:
        return "Recommendation: focus on overdue tasks first."
    if summary["due_today"]:
        return "Recommendation: finish tasks due today before starting new work."
    if summary["high_priority_open"]:
        return "Recommendation: tackle high-priority pending tasks next."
    if summary["pending"]:
        return "Recommendation: continue closing pending tasks in due-date order."
    return "Recommendation: you are clear on open work; review project plans or prepare the next milestone."
