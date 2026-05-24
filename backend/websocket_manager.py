import asyncio
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Iterable, Optional
from uuid import uuid4

from fastapi import WebSocket


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[str, list[dict]] = defaultdict(list)
        self.connection_index: dict[int, dict] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: Optional[asyncio.Task] = None
        self.heartbeat_timeout = timedelta(seconds=75)
        self.cleanup_interval_seconds = 30

    async def startup(self):
        if self._cleanup_task and not self._cleanup_task.done():
            return
        self._cleanup_task = asyncio.create_task(self._cleanup_loop())

    async def shutdown(self):
        task = self._cleanup_task
        self._cleanup_task = None
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass

        async with self._lock:
            snapshots = list(self.connection_index.values())
            self.active_connections.clear()
            self.connection_index.clear()

        for entry in snapshots:
            try:
                await entry["websocket"].close()
            except Exception:
                pass

    async def connect(self, websocket: WebSocket, user: dict) -> dict:
        await websocket.accept()

        email = str(user.get("email") or "").strip().lower()
        metadata = {
            "connection_id": str(uuid4()),
            "user_email": email,
            "username": user.get("username"),
            "role": user.get("role"),
            "websocket": websocket,
            "connected_at": utc_now(),
            "last_seen": utc_now(),
        }

        async with self._lock:
            socket_id = id(websocket)
            existing = self.connection_index.get(socket_id)
            if existing:
                return existing
            self.active_connections[email].append(metadata)
            self.connection_index[socket_id] = metadata

        return metadata

    async def disconnect(self, websocket: WebSocket, user_email: str | None = None):
        async with self._lock:
            entry = self.connection_index.pop(id(websocket), None)
            email = str(user_email or (entry or {}).get("user_email") or "").strip().lower()
            if not email:
                return

            connections = self.active_connections.get(email, [])
            self.active_connections[email] = [item for item in connections if item.get("websocket") is not websocket]
            if not self.active_connections[email]:
                self.active_connections.pop(email, None)

    async def touch(self, websocket: WebSocket):
        async with self._lock:
            entry = self.connection_index.get(id(websocket))
            if entry:
                entry["last_seen"] = utc_now()

    async def send_to_user(self, user_email: str, payload: dict):
        email = str(user_email or "").strip().lower()
        entries = await self._get_user_entries(email)
        await self._send_entries(entries, payload)

    async def broadcast(self, payload: dict):
        entries = await self._get_all_entries()
        await self._send_entries(entries, payload)

    async def broadcast_to_users(self, user_emails: Iterable[str], payload: dict):
        seen = set()
        entries = []
        for raw_email in user_emails or []:
            email = str(raw_email or "").strip().lower()
            if not email or email in seen:
                continue
            seen.add(email)
            entries.extend(await self._get_user_entries(email))
        await self._send_entries(entries, payload)

    async def connection_snapshot(self) -> dict:
        async with self._lock:
            return {
                email: [
                    {
                        "connection_id": item.get("connection_id"),
                        "role": item.get("role"),
                        "connected_at": item.get("connected_at").isoformat() if item.get("connected_at") else None,
                        "last_seen": item.get("last_seen").isoformat() if item.get("last_seen") else None,
                    }
                    for item in connections
                ]
                for email, connections in self.active_connections.items()
            }

    async def _get_user_entries(self, user_email: str) -> list[dict]:
        async with self._lock:
            return list(self.active_connections.get(user_email, []))

    async def _get_all_entries(self) -> list[dict]:
        async with self._lock:
            entries = []
            for connections in self.active_connections.values():
                entries.extend(list(connections))
            return entries

    async def _send_entries(self, entries: list[dict], payload: dict):
        if not entries:
            return

        results = await asyncio.gather(
            *(self._send_json(entry["websocket"], payload) for entry in entries),
            return_exceptions=True,
        )

        for entry, result in zip(entries, results):
            ok = bool(result) and not isinstance(result, Exception)
            if ok:
                await self.touch(entry["websocket"])
                continue
            await self.disconnect(entry["websocket"], entry.get("user_email"))

    async def _send_json(self, websocket: WebSocket, payload: dict) -> bool:
        try:
            await websocket.send_json(payload)
            return True
        except Exception:
            return False

    async def _cleanup_loop(self):
        try:
            while True:
                await asyncio.sleep(self.cleanup_interval_seconds)
                await self.cleanup_stale_connections()
        except asyncio.CancelledError:
            raise

    async def cleanup_stale_connections(self):
        cutoff = utc_now() - self.heartbeat_timeout
        async with self._lock:
            stale_entries = [
                entry
                for entry in self.connection_index.values()
                if (entry.get("last_seen") or utc_now()) < cutoff
            ]

        for entry in stale_entries:
            websocket = entry.get("websocket")
            if websocket:
                try:
                    await websocket.close(code=1001)
                except Exception:
                    pass
                await self.disconnect(websocket, entry.get("user_email"))


manager = ConnectionManager()


def build_event_payload(event_type: str, message: str, data: Optional[dict] = None) -> dict:
    return {
        "channel": "taskflow",
        "type": event_type,
        "message": message,
        "data": data or {},
    }


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
        "type": payload.get("type") or "system.event",
        "message": payload.get("message") or "",
        "data": payload.get("data") or {},
    }
    if recipients:
        recipient_list = [
            str(item or "").strip().lower()
            for item in recipients
            if str(item or "").strip()
        ]
        if recipient_list:
            _schedule(manager.broadcast_to_users(recipient_list, envelope))
            return
    _schedule(manager.broadcast(envelope))
