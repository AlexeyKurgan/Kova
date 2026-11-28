"""TCP server and command handlers for the Kova Blender Bridge addon.

The server thread only moves bytes. Every bpy call is queued and executed by a
timer on Blender's main thread, because bpy is not thread-safe.
"""
from __future__ import annotations

import json
import os
import queue
import secrets
import socket
import threading
import time
import traceback
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

import bpy

from .constants import (
    ADDON_NAME,
    ADDON_VERSION,
    ADDON_VERSION_TEXT,
    DEFAULT_HOST,
    DEFAULT_PORT,
    PORT_SCAN_LIMIT,
    PROTOCOL_VERSION,
)


from .paths import data_dir, discovery_path


def _write_discovery(port: int, token: str) -> None:
    path = discovery_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "protocol": PROTOCOL_VERSION,
        "name": ADDON_NAME,
        "addon_version": ADDON_VERSION_TEXT,
        "host": DEFAULT_HOST,
        "port": port,
        "pid": os.getpid(),
        "token": token,
        "blender_version": bpy.app.version_string,
        "started": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    }
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temp, path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _remove_discovery() -> None:
    path = discovery_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        if int(payload.get("pid", -1)) != os.getpid():
            return
        path.unlink()
    except (OSError, ValueError, TypeError):
        return


def _json_bytes(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class BridgeServer:
    def __init__(
        self,
        host: str = DEFAULT_HOST,
        port: int = DEFAULT_PORT,
        require_token: bool = True,
    ) -> None:
        self.host = host
        self.preferred_port = int(port)
        self.port = int(port)
        self.require_token = bool(require_token)
        self.token = secrets.token_urlsafe(24) if self.require_token else ""
        self.running = False
        self.last_error = ""
        self.last_command = ""
        self.last_agent = ""
        self.started_at = ""
        self._socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._clients: set[socket.socket] = set()
        self._clients_lock = threading.Lock()
        self._commands: queue.Queue = queue.Queue()

    # -- lifecycle -------------------------------------------------------
    def start(self) -> bool:
        if bpy.app.background:
            self.last_error = "server cannot start in Blender background mode"
            return False
        if self.running:
            return True
        if self.host not in ("127.0.0.1", "localhost"):
            self.last_error = "only loopback binding is supported"
            return False

        try:
            listener, actual_port = self._bind()
        except OSError as exc:
            self.last_error = f"cannot bind {self.host}:{self.preferred_port} ({exc})"
            return False

        self._socket = listener
        self.port = actual_port
        self.running = True
        self.last_error = ""
        self.started_at = datetime.now().astimezone().isoformat(timespec="seconds")
        try:
            self._thread = threading.Thread(target=self._server_loop, name="kova-bridge", daemon=True)
            self._thread.start()
            if not bpy.app.timers.is_registered(self._drain):
                bpy.app.timers.register(self._drain, persistent=True)
            _write_discovery(self.port, self.token)
        except Exception as exc:  # noqa: BLE001
            self.last_error = f"server started but setup failed: {exc}"
            self.stop()
            return False
        print(f"[Kova Bridge] listening on {self.host}:{self.port}")
        return True

    def stop(self) -> None:
        was_running = self.running
        self.running = False
        listener = self._socket
        self._socket = None
        if listener is not None:
            try:
                listener.close()
            except OSError:
                pass
        with self._clients_lock:
            clients = list(self._clients)
            self._clients.clear()
        for client in clients:
            try:
                client.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                client.close()
            except OSError:
                pass
        while True:
            try:
                self._commands.get_nowait()
            except queue.Empty:
                break
        if bpy.app.timers.is_registered(self._drain):
            bpy.app.timers.unregister(self._drain)
        thread = self._thread
        self._thread = None
        if thread is not None and thread.is_alive():
            thread.join(timeout=1.0)
        if was_running:
            _remove_discovery()
            print("[Kova Bridge] stopped")

    def status(self) -> str:
        if self.running:
            return f"listening on {self.host}:{self.port}"
        return self.last_error or "stopped"

    def _bind(self) -> tuple[socket.socket, int]:
        last_error: OSError | None = None
        for port in range(self.preferred_port, self.preferred_port + PORT_SCAN_LIMIT):
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            else:
                listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                listener.bind((self.host, port))
                listener.listen(8)
                listener.settimeout(1.0)
                return listener, port
            except OSError as exc:
                last_error = exc
                try:
                    listener.close()
                except OSError:
                    pass
        raise OSError(f"no free port in {self.preferred_port}-{self.preferred_port + PORT_SCAN_LIMIT - 1}") from last_error

    # -- transport -------------------------------------------------------
    def _server_loop(self) -> None:
        listener = self._socket
        if listener is None:
            return
        while self.running:
            try:
                client, _address = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            thread = threading.Thread(target=self._client_loop, args=(client,), daemon=True)
            thread.start()

    def _client_loop(self, client: socket.socket) -> None:
        client.settimeout(1.0)
        with self._clients_lock:
            self._clients.add(client)
        buffer = b""
        try:
            while self.running:
                try:
                    chunk = client.recv(65536)
                except socket.timeout:
                    continue
                except OSError:
                    break
                if not chunk:
                    break
                buffer += chunk
                if len(buffer) > 16 * 1024 * 1024:
                    self._send(client, {"status": "error", "message": "request is too large"})
                    break
                try:
                    request = json.loads(buffer.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    continue
                buffer = b""
                if not isinstance(request, dict):
                    self._send(client, {"status": "error", "message": "request must be a JSON object"})
                    continue
                if self.require_token and request.get("token") != self.token:
                    self._send(client, {"status": "error", "message": "unauthorized: invalid bridge token"})
                    break
                self._commands.put((request, client))
        finally:
            with self._clients_lock:
                self._clients.discard(client)
            try:
                client.close()
            except OSError:
                pass

    def _send(self, client: socket.socket, payload: dict) -> None:
        try:
            client.sendall(_json_bytes(payload))
        except OSError:
            pass

    def _drain(self) -> float | None:
        if not self.running:
            return None
        while True:
            try:
                request, client = self._commands.get_nowait()
            except queue.Empty:
                break
            try:
                response = self.execute(request)
            except Exception as exc:  # noqa: BLE001
                response = {
                    "status": "error",
                    "message": f"{type(exc).__name__}: {exc}",
                }
                traceback.print_exc()
            self._send(client, response)
        return 0.05

    # -- command dispatch ------------------------------------------------
    def execute(self, request: dict) -> dict:
        command = str(request.get("type") or "")
        params = request.get("params") or {}
        if not isinstance(params, dict):
            return {"status": "error", "message": "params must be a JSON object"}
        self.last_command = command
        marker = bpy.app.driver_namespace.get("KOVA_AGENT")
        if isinstance(marker, dict):
            self.last_agent = str(marker.get("agent") or "")

        handlers = {
            "ping": self.ping,
            "get_addon_info": self.get_addon_info,
            "get_scene_info": self.get_scene_info,
            "get_object_info": self.get_object_info,
            "get_viewport_screenshot": self.get_viewport_screenshot,
            "execute_code": self.execute_code,
        }
        handler = handlers.get(command)
        if handler is None:
            return {"status": "error", "message": f"unknown command: {command}"}
        try:
            result = handler(**params)
        except Exception as exc:  # noqa: BLE001
            return {
                "status": "error",
                "message": json.dumps(
                    {
                        "exception_type": type(exc).__name__,
                        "message": str(exc),
                        "traceback": traceback.format_exc(),
                    }
                ),
            }
        return {"status": "success", "result": result}

    # -- commands --------------------------------------------------------
    def ping(self) -> dict:
        return {"pong": True}

    def get_addon_info(self) -> dict:
        return {
            "name": ADDON_NAME,
            "addon_version": list(ADDON_VERSION),
            "protocol_version": [PROTOCOL_VERSION],
            "capabilities": [
                "execute_code",
                "get_addon_info",
                "get_object_info",
                "get_scene_info",
                "get_viewport_screenshot",
                "ping",
            ],
            "blender_version": bpy.app.version_string,
            "port": self.port,
            "token_required": self.require_token,
        }

    def get_scene_info(self) -> dict:
        scene = bpy.context.scene
        if scene is None:
            raise RuntimeError("no active scene")
        objects = []
        for obj in scene.objects:
            objects.append(
                {
                    "name": obj.name,
                    "type": obj.type,
                    "location": [round(float(value), 3) for value in obj.location],
                }
            )
            if len(objects) >= 200:
                break
        return {
            "name": scene.name,
            "object_count": len(scene.objects),
            "objects": objects,
            "materials_count": len(bpy.data.materials),
            "file": bpy.data.filepath,
        }

    def get_object_info(self, name: str) -> dict:
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise KeyError(f"object not found: {name}")
        info = {
            "name": obj.name,
            "type": obj.type,
            "location": [round(float(value), 4) for value in obj.location],
            "rotation": [round(float(value), 4) for value in obj.rotation_euler],
            "scale": [round(float(value), 4) for value in obj.scale],
            "dimensions": [round(float(value), 4) for value in obj.dimensions],
            "parent": obj.parent.name if obj.parent else None,
            "materials": [slot.material.name for slot in obj.material_slots if slot.material],
            "modifiers": [modifier.type for modifier in obj.modifiers],
        }
        if obj.type == "MESH" and obj.data is not None:
            info.update(
                {
                    "vertices": len(obj.data.vertices),
                    "edges": len(obj.data.edges),
                    "polygons": len(obj.data.polygons),
                }
            )
        return info

    def get_viewport_screenshot(self, max_size: int = 1200, filepath: str = "", format: str = "png") -> dict:
        if not filepath:
            raise ValueError("filepath is required")
        path = Path(filepath).expanduser().resolve()
        if not path.suffix:
            path = path.with_suffix(".png")
        path.parent.mkdir(parents=True, exist_ok=True)
        file_format = {"jpg": "JPEG", "jpeg": "JPEG"}.get(format.lower(), format.upper())

        screen = bpy.context.screen
        if screen is None:
            raise RuntimeError("no active screen")
        area = region = space = None
        for candidate in screen.areas:
            if candidate.type == "VIEW_3D":
                area = candidate
                space = candidate.spaces.active
                region = next((item for item in candidate.regions if item.type == "WINDOW"), None)
                break
        if area is None or region is None or space is None:
            raise RuntimeError("no 3D viewport found")

        method = "offscreen"
        try:
            import gpu
            import numpy as np

            region_3d = space.region_3d
            source_width, source_height = region.width, region.height
            limit = max(1, int(max_size))
            if max(source_width, source_height) > limit:
                scale = limit / max(source_width, source_height)
                width = max(1, int(source_width * scale))
                height = max(1, int(source_height * scale))
            else:
                width, height = source_width, source_height

            offscreen = gpu.types.GPUOffScreen(width, height)
            try:
                offscreen.draw_view3d(
                    bpy.context.scene,
                    bpy.context.view_layer,
                    space,
                    region,
                    region_3d.view_matrix,
                    region_3d.window_matrix,
                    do_color_management=True,
                )
                buffer = offscreen.texture_color.read()
            finally:
                offscreen.free()

            buffer.dimensions = width * height * 4
            pixels = np.asarray(buffer, dtype=np.float32) / 255.0
            image = bpy.data.images.new("kova_viewport", width, height, alpha=True)
            try:
                image.pixels.foreach_set(pixels.ravel())
                image.filepath_raw = str(path)
                image.file_format = file_format
                image.save()
            finally:
                bpy.data.images.remove(image)
        except Exception as exc:  # noqa: BLE001
            print(f"[Kova Bridge] offscreen capture failed: {exc}")
            method = "window_grab"
            with bpy.context.temp_override(area=area):
                bpy.ops.screen.screenshot_area(filepath=str(path))
            image = bpy.data.images.load(str(path))
            try:
                width, height = image.size
                if max(width, height) > int(max_size):
                    scale = int(max_size) / max(width, height)
                    image.scale(int(width * scale), int(height * scale))
                    image.file_format = file_format
                    image.save()
            finally:
                bpy.data.images.remove(image)
        return {
            "success": True,
            "filepath": str(path),
            "width": width,
            "height": height,
            "method": method,
        }

    def execute_code(self, code: str) -> dict:
        if not isinstance(code, str):
            raise TypeError("code must be a string")
        output = StringIO()
        namespace = {"bpy": bpy, "__name__": "__kova_bridge__"}
        with redirect_stdout(output):
            exec(compile(code, "<kova-bridge>", "exec"), namespace)
        return {"executed": True, "result": output.getvalue()}
