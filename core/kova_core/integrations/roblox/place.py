"""Build Roblox .rbxlx place files without Rojo.

The builder is intentionally small: it serializes a tree of instances with the
properties Kova needs for scripts, parts and MeshParts. Studio fills every
other property with its defaults when the place is opened.
"""
from __future__ import annotations

import argparse
import html
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable


class ProtectedSource(str):
    """Script source serialized as ProtectedString/CDATA."""


class ContentValue(str):
    """Roblox Content property, for example a MeshId."""


class Color3Value(tuple):
    """Color3 with float components in 0..1."""


class Color3Uint8Value(tuple):
    """Part.Color serialized as a 32-bit ARGB integer."""


class TokenValue(int):
    """Enum token value."""


class Vector3Value(tuple):
    """Vector3 property."""


class CFrameValue(tuple):
    """CFrame position (and optional Euler rotation in degrees)."""


@dataclass
class Node:
    class_name: str
    name: str
    properties: dict[str, Any] = field(default_factory=dict)
    children: list["Node"] = field(default_factory=list)
    referent: str = ""

    def add(self, *children: "Node") -> "Node":
        self.children.extend(children)
        return self


def _xml_text(value: str) -> str:
    return html.escape(value, quote=False)


def _float(value: float) -> str:
    text = f"{float(value):.9g}"
    return "0" if text == "-0" else text


def _serialize(name: str, value: Any) -> str:
    if isinstance(value, ProtectedSource):
        source = str(value).replace("]]>", "]]]]><![CDATA[>")
        return f'<ProtectedString name="{name}"><![CDATA[{source}]]></ProtectedString>'
    if isinstance(value, ContentValue):
        if not value:
            return f'<Content name="{name}"><null></null></Content>'
        return f'<Content name="{name}"><url>{_xml_text(str(value))}</url></Content>'
    if isinstance(value, Color3Value):
        red, green, blue = value
        return (
            f'<Color3 name="{name}">'
            f"<R>{_float(red)}</R><G>{_float(green)}</G><B>{_float(blue)}</B>"
            f"</Color3>"
        )
    if isinstance(value, Color3Uint8Value):
        red, green, blue = (max(0, min(255, int(channel))) for channel in value)
        packed = (255 << 24) | (red << 16) | (green << 8) | blue
        return f'<Color3uint8 name="{name}">{packed}</Color3uint8>'
    if isinstance(value, TokenValue):
        return f'<token name="{name}">{int(value)}</token>'
    if isinstance(value, Vector3Value):
        x, y, z = value
        return (
            f'<Vector3 name="{name}">'
            f"<X>{_float(x)}</X><Y>{_float(y)}</Y><Z>{_float(z)}</Z>"
            f"</Vector3>"
        )
    if isinstance(value, CFrameValue):
        x, y, z = value[:3]
        rx, ry, rz = value[3:6] if len(value) >= 6 else (0.0, 0.0, 0.0)
        import math

        cx, sx = math.cos(math.radians(rx)), math.sin(math.radians(rx))
        cy, sy = math.cos(math.radians(ry)), math.sin(math.radians(ry))
        cz, sz = math.cos(math.radians(rz)), math.sin(math.radians(rz))
        # R = Rz * Ry * Rx
        r00 = cz * cy
        r01 = cz * sy * sx - sz * cx
        r02 = cz * sy * cx + sz * sx
        r10 = sz * cy
        r11 = sz * sy * sx + cz * cx
        r12 = sz * sy * cx - cz * sx
        r20 = -sy
        r21 = cy * sx
        r22 = cy * cx
        return (
            f'<CoordinateFrame name="{name}">'
            f"<X>{_float(x)}</X><Y>{_float(y)}</Y><Z>{_float(z)}</Z>"
            f"<R00>{_float(r00)}</R00><R01>{_float(r01)}</R01><R02>{_float(r02)}</R02>"
            f"<R10>{_float(r10)}</R10><R11>{_float(r11)}</R11><R12>{_float(r12)}</R12>"
            f"<R20>{_float(r20)}</R20><R21>{_float(r21)}</R21><R22>{_float(r22)}</R22>"
            f"</CoordinateFrame>"
        )
    if isinstance(value, bool):
        return f'<bool name="{name}">{"true" if value else "false"}</bool>'
    if isinstance(value, int):
        return f'<int name="{name}">{value}</int>'
    if isinstance(value, float):
        return f'<float name="{name}">{_float(value)}</float>'
    return f'<string name="{name}">{_xml_text(str(value))}</string>'


def build_place(services: Iterable[Node]) -> str:
    all_nodes: list[Node] = []
    for service in services:
        all_nodes.append(service)
        all_nodes.extend(_walk(service))
    for index, node in enumerate(all_nodes):
        node.referent = f"RBX{index}"

    lines = [
        '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" '
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
        "\t<External>null</External>",
        "\t<External>nil</External>",
    ]
    for service in services:
        lines.extend(_render_node(service, 1))
    lines.append("</roblox>")
    return "\n".join(lines) + "\n"


def _walk(node: Node) -> Iterable[Node]:
    for child in node.children:
        yield child
        yield from _walk(child)


def _render_node(node: Node, depth: int) -> list[str]:
    indent = "\t" * depth
    lines = [f'{indent}<Item class="{node.class_name}" referent="{node.referent}">']
    lines.append(f"{indent}\t<Properties>")
    properties = {"Name": node.name, **node.properties}
    for name, value in properties.items():
        lines.append(f"{indent}\t\t{_serialize(name, value)}")
    lines.append(f"{indent}\t</Properties>")
    for child in node.children:
        lines.extend(_render_node(child, depth + 1))
    lines.append(f"{indent}</Item>")
    return lines


def part(
    name: str,
    size: tuple[float, float, float],
    position: tuple[float, float, float],
    color: tuple[int, int, int] = (90, 96, 110),
    material: int = 272,
    anchored: bool = True,
    can_collide: bool = True,
    transparency: float = 0.0,
    shape: int | None = None,
    class_name: str = "Part",
    rotation: tuple[float, float, float] | None = None,
    extra: dict[str, Any] | None = None,
) -> Node:
    properties: dict[str, Any] = {
        "Anchored": anchored,
        "CanCollide": can_collide,
        "CanTouch": True,
        "CanQuery": True,
        "CastShadow": True,
        "Locked": True,
        "size": Vector3Value(size),
        "CFrame": CFrameValue((*position, *(rotation or (0.0, 0.0, 0.0)))),
        "Color3uint8": Color3Uint8Value(color),
        "Material": TokenValue(material),
        "Transparency": float(transparency),
    }
    if shape is not None:
        properties["shape"] = TokenValue(shape)
    if extra:
        properties.update(extra)
    return Node(class_name, name, properties)


def spawn_location(
    name: str,
    size: tuple[float, float, float],
    position: tuple[float, float, float],
    color: tuple[int, int, int] = (226, 174, 78),
) -> Node:
    return part(
        name,
        size,
        position,
        color=color,
        material=272,
        extra={
            "Duration": 0,
            "Enabled": True,
            "Neutral": True,
            "AllowTeamChangeOnTouch": False,
        },
        class_name="SpawnLocation",
    )


def mesh_part(
    name: str,
    asset_id: str,
    size: tuple[float, float, float],
    position: tuple[float, float, float],
    color: tuple[int, int, int] = (255, 255, 255),
    anchored: bool = True,
    can_collide: bool = False,
    transparency: float = 0.0,
) -> Node:
    return Node(
        "MeshPart",
        name,
        {
            "Anchored": anchored,
            "CanCollide": can_collide,
            "CanTouch": True,
            "CanQuery": True,
            "CastShadow": True,
            "DoubleSided": False,
            "size": Vector3Value(size),
            "CFrame": CFrameValue((*position, 0.0, 0.0, 0.0)),
            "Color3uint8": Color3Uint8Value(color),
            "Material": TokenValue(272),
            "Transparency": float(transparency),
            "MeshId": ContentValue(f"rbxassetid://{asset_id}"),
        },
    )


def script(name: str, source: str, script_type: str = "Script") -> Node:
    return Node(
        script_type,
        name,
        {"Source": ProtectedSource(source), "Disabled": False},
    )


def folder(name: str, *children: Node) -> Node:
    return Node("Folder", name, children=list(children))


def model(name: str, *children: Node) -> Node:
    return Node("Model", name, children=list(children))


def _read(project: Path, relative: str) -> str:
    path = project / relative
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return f"-- Kova: missing {relative}\n"


def _sword_fallback() -> Node:
    # A simple single-part placeholder until the Blender mesh asset is uploaded.
    return part(
        "KovaSword",
        (0.9, 6.0, 0.3),
        (0, 3, 0),
        color=(176, 190, 210),
        material=272,
        anchored=True,
        can_collide=False,
        extra={"Name": "KovaSword"},
    )


def build_uncharted_place(project: Path, asset_id: str | None = None) -> Path:
    project = project.resolve()
    config = _read(project, "src/ReplicatedStorage/KovaConfig.lua")
    bootstrap = _read(project, "src/ServerScriptService/KovaBootstrap.server.lua")
    client = _read(project, "src/StarterPlayer/StarterPlayerScripts/KovaClient.client.lua")

    dark = (23, 28, 37)
    stone = (52, 58, 68)
    slate = (74, 82, 96)
    grass = (38, 54, 40)
    gold = (226, 174, 78)
    steel = (150, 166, 190)

    workspace = Node("Workspace", "Workspace", {"StreamingEnabled": False})
    workspace.add(
        part("Baseplate", (160, 4, 160), (0, -2, 0), color=grass, material=1280, can_collide=True),
        part("Arena", (60, 1, 60), (0, 0.5, 0), color=stone, material=272),
        spawn_location("KovaSpawn", (10, 1, 10), (0, 1.5, 10), color=gold),
        part("SpawnPad", (12, 0.4, 12), (0, 0.9, 10), color=gold, material=288, can_collide=False),
        part("KovaSwordPedestal", (7, 1.5, 7), (0, 1.25, -6), color=dark, material=272),
        part("PedestalGlow", (7.6, 0.2, 7.6), (0, 2.05, -6), color=gold, material=288, can_collide=False),
    )

    # Corner pillars and arch.
    for x in (-24, 24):
        for z in (-24, 24):
            workspace.add(
                part(f"Pillar_{x}_{z}", (3, 14, 3), (x, 7, z), color=slate, material=800),
                part(f"PillarCap_{x}_{z}", (3.8, 0.6, 3.8), (x, 14.3, z), color=gold, material=288, can_collide=False),
            )
    for x in (-16, 16):
        workspace.add(part(f"ArchPillar_{x}", (2.5, 14, 2.5), (x, 7, -28), color=slate, material=800))
    workspace.add(
        part("ArchBeam", (34, 2, 2.5), (0, 14, -28), color=dark, material=272),
        part("ArchGlow", (30, 0.25, 2.7), (0, 13, -28), color=gold, material=288, can_collide=False),
    )

    # Torches around the arena.
    for x in (-20, 20):
        for z in (-20, 20):
            workspace.add(
                part(f"Torch_{x}_{z}", (0.8, 2.4, 0.8), (x, 3, z), color=gold, material=288, can_collide=False),
            )

    if asset_id:
        workspace.add(
            mesh_part("KovaSwordDisplay", asset_id, (1.8, 9, 1.8), (0, 2.2, -6), color=(255, 255, 255)),
        )
        sword_template: Node = mesh_part(
            "KovaSword", asset_id, (1.2, 6, 1.2), (0, 0, 0), color=(255, 255, 255)
        )
    else:
        sword_template = _sword_fallback()

    replicated = Node("ReplicatedStorage", "ReplicatedStorage")
    replicated.add(
        folder("Weapons", sword_template),
        script("KovaConfig", config, "ModuleScript"),
    )

    server_scripts = Node("ServerScriptService", "ServerScriptService")
    server_scripts.add(script("KovaBootstrap", bootstrap, "Script"))

    starter_player = Node("StarterPlayer", "StarterPlayer", {
        "CharacterWalkSpeed": 18.0,
        "CharacterJumpPower": 54.0,
        "CharacterUseJumpPower": True,
    })
    starter_scripts = Node("StarterPlayerScripts", "StarterPlayerScripts")
    starter_scripts.add(script("KovaClient", client, "LocalScript"))
    starter_player.add(
        starter_scripts,
        Node("StarterCharacterScripts", "StarterCharacterScripts"),
    )

    lighting = Node("Lighting", "Lighting", {
        "Ambient": Color3Value((0.12, 0.14, 0.18)),
        "OutdoorAmbient": Color3Value((0.28, 0.32, 0.40)),
        "Brightness": 2.2,
        "ClockTime": 14.5,
        "GlobalShadows": True,
        "EnvironmentDiffuseScale": 0.5,
        "EnvironmentSpecularScale": 0.5,
        "FogColor": Color3Value((0.62, 0.70, 0.80)),
        "FogStart": 220.0,
        "FogEnd": 900.0,
    })

    players = Node("Players", "Players", {"CharacterAutoLoads": True})
    starter_gui = Node("StarterGui", "StarterGui")
    starter_pack = Node("StarterPack", "StarterPack")
    sound = Node("SoundService", "SoundService")
    http = Node("HttpService", "HttpService", {"HttpEnabled": True})

    xml = build_place(
        [
            workspace,
            lighting,
            replicated,
            server_scripts,
            starter_player,
            players,
            starter_gui,
            starter_pack,
            sound,
            http,
        ]
    )
    output = project / "place" / "Uncharted3D.rbxlx"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(xml, encoding="utf-8")
    return output


def build_minimal_place(output: Path) -> Path:
    workspace = Node("Workspace", "Workspace", {"StreamingEnabled": False})
    workspace.add(
        part("Baseplate", (512, 16, 512), (0, -8, 0), color=(56, 64, 72), material=272),
        spawn_location("SpawnLocation", (12, 1, 12), (0, 0.5, 0)),
    )
    lighting = Node("Lighting", "Lighting", {
        "Brightness": 2.0,
        "ClockTime": 14.0,
        "GlobalShadows": True,
    })
    http = Node("HttpService", "HttpService", {"HttpEnabled": True})
    xml = build_place(
        [
            workspace,
            lighting,
            Node("Players", "Players"),
            Node("ServerScriptService", "ServerScriptService"),
            http,
        ]
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(xml, encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Kova Roblox places")
    parser.add_argument("--project", type=Path, help="Uncharted 3D project directory")
    parser.add_argument("--asset-id", default="", help="Roblox mesh asset id")
    parser.add_argument("--minimal", type=Path, help="Write a minimal baseplate place")
    parser.add_argument("--output", type=Path, help="Output path for --minimal")
    args = parser.parse_args()

    if args.minimal:
        output = build_minimal_place(args.minimal)
        print(output)
        return
    if not args.project:
        parser.error("--project or --minimal is required")
    output = build_uncharted_place(args.project, args.asset_id or None)
    print(output)


if __name__ == "__main__":
    main()
