import json
import socket
import time
from typing import Any

from .discovery import DEFAULT_HOST, read_bridge


class BridgeError(RuntimeError):
    pass


class BridgeClient:
    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = 47832,
        token: str = "",
        timeout: float = 8.0,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.token = token
        self.timeout = timeout

    @classmethod
    def from_discovery(cls, timeout: float = 8.0) -> "BridgeClient | None":
        found = read_bridge()
        if found is None:
            return None
        return cls(
            host=str(found.get("host") or DEFAULT_HOST),
            port=int(found["port"]),
            token=str(found.get("token") or ""),
            timeout=timeout,
        )

    def request(self, command: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = json.dumps(
            {"type": command, "params": params or {}, "token": self.token},
            ensure_ascii=False,
        ).encode("utf-8")
        deadline = time.monotonic() + self.timeout
        try:
            sock = socket.create_connection((self.host, self.port), timeout=min(2.5, self.timeout))
        except OSError as exc:
            raise BridgeError(f"Blender недоступен на {self.host}:{self.port}") from exc
        try:
            sock.settimeout(self.timeout)
            sock.sendall(payload)
            buffer = b""
            while time.monotonic() < deadline:
                chunk = sock.recv(65536)
                if not chunk:
                    break
                buffer += chunk
                try:
                    data = json.loads(buffer.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                if not isinstance(data, dict):
                    raise BridgeError("Blender вернул неожиданный ответ")
                if data.get("status") == "error":
                    raise BridgeError(str(data.get("message") or "ошибка Blender"))
                return data
            raise BridgeError("Blender не ответил вовремя")
        finally:
            try:
                sock.close()
            except OSError:
                pass

    def call(self, command: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        response = self.request(command, params)
        if response.get("status") != "success":
            raise BridgeError(str(response.get("message") or command))
        result = response.get("result")
        return result if isinstance(result, dict) else {}

    def ping(self) -> dict[str, Any]:
        return self.call("get_addon_info")

    def scene(self) -> dict[str, Any]:
        return self.call("get_scene_info")

    def execute(self, code: str) -> dict[str, Any]:
        return self.call("execute_code", {"code": code})

    def screenshot(self, filepath: str, max_size: int = 1200) -> dict[str, Any]:
        return self.call(
            "get_viewport_screenshot",
            {"filepath": filepath, "max_size": max_size, "format": "png"},
        )


def connection_state(timeout: float = 1.5) -> dict[str, Any]:
    found = read_bridge()
    if found is None:
        return {
            "connected": False,
            "host": "",
            "port": None,
            "addon_version": "",
            "blender_version": "",
            "message": "Аддон Blender не запущен",
        }
    client = BridgeClient(
        host=str(found.get("host") or DEFAULT_HOST),
        port=int(found["port"]),
        token=str(found.get("token") or ""),
        timeout=timeout,
    )
    try:
        info = client.ping()
    except BridgeError as exc:
        return {
            "connected": False,
            "host": client.host,
            "port": client.port,
            "addon_version": str(found.get("addon_version") or ""),
            "blender_version": str(found.get("blender_version") or ""),
            "message": str(exc),
        }
    return {
        "connected": True,
        "host": client.host,
        "port": client.port,
        "addon_version": ".".join(str(part) for part in info.get("addon_version") or []),
        "blender_version": str(info.get("blender_version") or ""),
        "message": "",
    }
