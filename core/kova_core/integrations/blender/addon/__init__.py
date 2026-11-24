"""Kova Blender Bridge - local transport between Kova Hub and Blender."""
from __future__ import annotations

import json
import os
from pathlib import Path

import bpy
from bpy.props import BoolProperty, IntProperty
from bpy.types import AddonPreferences, Operator, Panel

from .constants import ADDON_VERSION, DEFAULT_PORT, PROTOCOL_VERSION
from .server import BridgeServer, data_dir, discovery_path

bl_info = {
    "name": "Kova Blender Bridge",
    "author": "Kova Hub",
    "version": (1, 0, 0),
    "blender": (3, 6, 0),
    "location": "View3D > Sidebar > Kova",
    "description": "Local bridge between Kova Hub and Blender for AI-assisted 3D asset pipelines.",
    "category": "Interface",
}

_server: BridgeServer | None = None
_paused = False


def _prefs(context=None) -> AddonPreferences | None:
    context = context or bpy.context
    entry = context.preferences.addons.get(__package__)
    return entry.preferences if entry else None


def _server_instance() -> BridgeServer | None:
    return _server


def _start_server(context=None) -> bool:
    global _server, _paused
    prefs = _prefs(context)
    if prefs is None:
        return False
    if _server is None:
        _server = BridgeServer(port=prefs.port, require_token=prefs.require_token)
    if _server.running:
        return True
    _server.preferred_port = prefs.port
    _server.require_token = prefs.require_token
    _server.token = _server.token if prefs.require_token else ""
    if prefs.require_token and not _server.token:
        import secrets

        _server.token = secrets.token_urlsafe(24)
    _paused = False
    try:
        started = _server.start()
        if started:
            bpy.app.driver_namespace["KOVA_BRIDGE_SERVER"] = _server
        return started
    except Exception as exc:  # noqa: BLE001
        _server.last_error = f"start failed: {exc}"
        return False


def _stop_server() -> None:
    global _server
    if _server is not None:
        _server.stop()
        if bpy.app.driver_namespace.get("KOVA_BRIDGE_SERVER") is _server:
            bpy.app.driver_namespace.pop("KOVA_BRIDGE_SERVER", None)


def _auto_start():
    global _paused
    if bpy.app.background or _paused:
        return None
    prefs = _prefs()
    if prefs is None or not prefs.auto_start:
        return None
    if _server is None or not _server.running:
        if not _start_server():
            return 2.0
    return None


def _schedule_auto_start(delay: float = 0.5) -> None:
    if not bpy.app.timers.is_registered(_auto_start):
        bpy.app.timers.register(_auto_start, first_interval=delay, persistent=True)


@bpy.app.handlers.persistent
def _load_post(_unused) -> None:
    _schedule_auto_start()


class KovaBridgePreferences(AddonPreferences):
    bl_idname = __package__

    port: IntProperty(
        name="Port",
        description="Preferred local TCP port. The next free port is used when this one is busy.",
        default=DEFAULT_PORT,
        min=1024,
        max=65535,
    )
    auto_start: BoolProperty(
        name="Start server with Blender",
        description="Start the local bridge automatically when Blender opens.",
        default=True,
    )
    require_token: BoolProperty(
        name="Require local token",
        description="Reject clients that do not present the token written to the discovery file.",
        default=True,
    )
    show_token: BoolProperty(
        name="Show token",
        description="Show the local bridge token in the sidebar.",
        default=False,
    )

    def draw(self, context) -> None:
        layout = self.layout
        layout.prop(self, "port")
        layout.prop(self, "auto_start")
        layout.prop(self, "require_token")
        layout.prop(self, "show_token")


class Kova_OT_Start(Operator):
    bl_idname = "kova_bridge.start"
    bl_label = "Start Server"
    bl_description = "Start the local Kova Bridge server"

    def execute(self, context):
        global _paused
        _paused = False
        if _start_server(context):
            self.report({"INFO"}, f"Kova Bridge listening on {_server.host}:{_server.port}")
            return {"FINISHED"}
        self.report({"ERROR"}, _server.status() if _server else "cannot start server")
        return {"CANCELLED"}


class Kova_OT_Stop(Operator):
    bl_idname = "kova_bridge.stop"
    bl_label = "Stop Server"
    bl_description = "Stop the local Kova Bridge server (pause AI access)"

    def execute(self, context):
        global _paused
        _paused = True
        _stop_server()
        self.report({"INFO"}, "Kova Bridge stopped")
        return {"FINISHED"}


class Kova_OT_Restart(Operator):
    bl_idname = "kova_bridge.restart"
    bl_label = "Restart Server"
    bl_description = "Restart the local Kova Bridge server and apply the current port"

    def execute(self, context):
        global _paused
        _paused = False
        _stop_server()
        if _start_server(context):
            self.report({"INFO"}, f"Kova Bridge listening on {_server.host}:{_server.port}")
            return {"FINISHED"}
        self.report({"ERROR"}, _server.status() if _server else "cannot start server")
        return {"CANCELLED"}


class Kova_OT_CopyInfo(Operator):
    bl_idname = "kova_bridge.copy_info"
    bl_label = "Copy Connection Info"
    bl_description = "Copy host, port, token and discovery path to the clipboard"

    def execute(self, context):
        prefs = _prefs(context)
        server = _server_instance()
        payload = {
            "host": server.host if server else "127.0.0.1",
            "port": server.port if server else (prefs.port if prefs else DEFAULT_PORT),
            "token": server.token if server and prefs and prefs.require_token else "",
            "addon_version": ".".join(str(part) for part in ADDON_VERSION),
            "discovery": str(discovery_path()),
            "running": bool(server and server.running),
        }
        context.window_manager.clipboard = json.dumps(payload, indent=2)
        self.report({"INFO"}, "Kova Bridge connection info copied")
        return {"FINISHED"}


class Kova_OT_CopyToken(Operator):
    bl_idname = "kova_bridge.copy_token"
    bl_label = "Copy Token"
    bl_description = "Copy the local bridge token to the clipboard"

    def execute(self, context):
        server = _server_instance()
        prefs = _prefs(context)
        if not server or not server.token or not prefs or not prefs.require_token:
            self.report({"WARNING"}, "Token is disabled")
            return {"CANCELLED"}
        context.window_manager.clipboard = server.token
        self.report({"INFO"}, "Kova Bridge token copied")
        return {"FINISHED"}


class Kova_OT_OpenData(Operator):
    bl_idname = "kova_bridge.open_data"
    bl_label = "Open Data Folder"
    bl_description = "Open the folder that contains the discovery file"

    def execute(self, context):
        path = data_dir()
        path.mkdir(parents=True, exist_ok=True)
        try:
            if os.name == "nt":
                os.startfile(str(path))  # type: ignore[attr-defined]
            elif sys_platform_is_mac():
                import subprocess

                subprocess.Popen(["open", str(path)])
            else:
                import subprocess

                subprocess.Popen(["xdg-open", str(path)])
        except Exception as exc:  # noqa: BLE001
            self.report({"ERROR"}, f"cannot open folder: {exc}")
            return {"CANCELLED"}
        return {"FINISHED"}


def sys_platform_is_mac() -> bool:
    import sys

    return sys.platform == "darwin"


class KOVA_PT_Bridge(Panel):
    bl_label = "Kova Bridge"
    bl_idname = "KOVA_PT_bridge"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Kova"

    def draw(self, context) -> None:
        layout = self.layout
        prefs = _prefs(context)
        server = _server_instance()
        running = bool(server and server.running)

        status = layout.box()
        row = status.row()
        row.label(
            text=f"Listening {server.host}:{server.port}" if running else "Offline",
            icon="CHECKMARK" if running else "ERROR",
        )
        if running:
            status.label(text=f"Protocol {PROTOCOL_VERSION}  ·  PID {os.getpid()}")
            status.label(text=f"Last agent: {server.last_agent or '-'}")
            status.label(text=f"Last command: {server.last_command or '-'}")
        else:
            status.label(text=(server.status() if server else "Server is stopped"), icon="INFO")

        if prefs is None:
            layout.label(text="Add-on preferences are unavailable", icon="ERROR")
            return

        column = layout.column(align=True)
        column.prop(prefs, "port")
        column.prop(prefs, "auto_start")
        column.prop(prefs, "require_token")

        buttons = layout.row(align=True)
        buttons.operator("kova_bridge.start", icon="PLAY")
        buttons.operator("kova_bridge.stop", icon="PAUSE")
        buttons.operator("kova_bridge.restart", icon="FILE_REFRESH")

        if running and prefs.port != server.port:
            layout.label(text=f"Port {prefs.port} is saved; restart to apply", icon="INFO")

        if prefs.require_token and running:
            token_row = layout.row(align=True)
            token_row.label(text=server.token if prefs.show_token else "Token: " + "•" * 12)
            token_row.prop(prefs, "show_token", text="", icon="HIDE_OFF" if prefs.show_token else "HIDE_ON")
            layout.operator("kova_bridge.copy_token", icon="COPYDOWN")

        layout.operator("kova_bridge.copy_info", icon="COPYDOWN")
        layout.operator("kova_bridge.open_data", icon="FILE_FOLDER")

        if not running:
            layout.label(text="Stop = pause AI access", icon="INFO")


classes = (
    KovaBridgePreferences,
    Kova_OT_Start,
    Kova_OT_Stop,
    Kova_OT_Restart,
    Kova_OT_CopyInfo,
    Kova_OT_CopyToken,
    Kova_OT_OpenData,
    KOVA_PT_Bridge,
)


def register() -> None:
    stale = bpy.app.driver_namespace.get("KOVA_BRIDGE_SERVER")
    if stale is not None and stale is not _server:
        try:
            stale.stop()
        except Exception:
            pass
    for cls in classes:
        bpy.utils.register_class(cls)
    if _load_post not in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.append(_load_post)
    _schedule_auto_start()


def unregister() -> None:
    global _server
    _stop_server()
    _server = None
    if _load_post in bpy.app.handlers.load_post:
        bpy.app.handlers.load_post.remove(_load_post)
    for cls in reversed(classes):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass


if __name__ == "__main__":
    register()
