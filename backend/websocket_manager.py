import asyncio
import json
from collections import defaultdict
from typing import Iterable

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, user_email: str):
        await websocket.accept()
        if websocket not in self.active_connections[user_email]:
            self.active_connections[user_email].append(websocket)

    def disconnect(self, websocket: WebSocket, user_email: str | None = None):
        if user_email:
            connections = self.active_connections.get(user_email, [])
            if websocket in connections:
                connections.remove(websocket)
            if not connections and user_email in self.active_connections:
                del self.active_connections[user_email]
            return

        empty_users = []
        for email, connections in self.active_connections.items():
            if websocket in connections:
                connections.remove(websocket)
            if not connections:
                empty_users.append(email)

        for email in empty_users:
            self.active_connections.pop(email, None)

    async def _send_json(self, websocket: WebSocket, payload: dict) -> bool:
        try:
            await websocket.send_text(json.dumps(payload))
            return True
        except Exception:
            return False

    async def send_to_user(self, user_email: str, payload: dict):
        connections = list(self.active_connections.get(str(user_email or "").strip().lower(), []))
        disconnected = []
        for connection in connections:
            ok = await self._send_json(connection, payload)
            if not ok:
                disconnected.append(connection)

        for connection in disconnected:
            self.disconnect(connection, str(user_email or "").strip().lower())

    async def broadcast(self, payload: dict):
        disconnected: list[tuple[str, WebSocket]] = []
        for email, connections in list(self.active_connections.items()):
            for connection in list(connections):
                ok = await self._send_json(connection, payload)
                if not ok:
                    disconnected.append((email, connection))

        for email, connection in disconnected:
            self.disconnect(connection, email)

    async def broadcast_to_users(self, user_emails: Iterable[str], payload: dict):
        seen = set()
        for raw_email in user_emails or []:
            email = str(raw_email or "").strip().lower()
            if not email or email in seen:
                continue
            seen.add(email)
            await self.send_to_user(email, payload)


manager = ConnectionManager()


def _schedule(coro):
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
        return True
    except RuntimeError:
        return False


def emit_realtime_event(payload: dict, recipients: Iterable[str] | None = None):
    envelope = {
        "channel": "taskflow",
        **payload,
    }
    if recipients:
        recipient_list = [str(item or "").strip().lower() for item in recipients if str(item or "").strip()]
        if recipient_list:
            _schedule(manager.broadcast_to_users(recipient_list, envelope))
            return
    _schedule(manager.broadcast(envelope))
