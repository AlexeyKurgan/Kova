# Third-party notices

Kova Hub is licensed under the MIT License (see [LICENSE](LICENSE)). It uses the following third-party software, assets, and services.

## Editor

- **code-server 4.146.0** — MIT License, Copyright (c) Coder Technologies, Inc.
  <https://github.com/coder/code-server>
  Kova downloads code-server from the official GitHub releases at runtime. It is not bundled in this repository or in the desktop installer.
- code-server is built from the open-source VS Code codebase. Kova does **not** bundle Microsoft-branded VS Code builds, Microsoft Marketplace access, or Microsoft extensions. Extensions are installed by the user from the code-server registry and keep their own licenses.

## Blender

- **Kova Blender Bridge add-on** — GPL-3.0-or-later.
  `core/kova_core/integrations/blender/addon/blender_manifest.toml`
- **Blender** — GPL. Blender is not bundled; Kova launches a locally installed copy.
- **Bundled Blender skills** — MIT License, Copyright (c) 2026 EL4CTEO.
  `core/kova_core/integrations/blender/skills/LICENSE`

## Runtime components

- **Python** — PSF-2.0
- **FastAPI** — MIT
- **Uvicorn** — BSD-3-Clause
- **Pydantic** — MIT
- **Tauri** and official Tauri plugins — MIT or Apache-2.0
- **React** and **React DOM** — MIT
- **Three.js** — MIT
- **Lucide** — ISC
- **Inter** (via `@fontsource/inter`) — SIL Open Font License 1.1

## Build and development tools

- **Vite**, **TypeScript**, **esbuild**, and related packages — MIT / Apache-2.0
- **Rust** toolchain and crates — MIT / Apache-2.0 unless stated otherwise
- **pytest**, **httpx**, and related Python test tools — MIT / BSD

The exact dependency tree is defined by `package.json`, `package-lock.json`, `core/pyproject.toml`, and `apps/desktop/src-tauri/Cargo.lock`.

## Brand assets and trademarks

Engine and AI logos are embedded SVG paths derived from [Simple Icons](https://simpleicons.org/) (CC0 1.0) and [LobeHub icons](https://github.com/lobehub/lobe-icons) (MIT). The logos themselves are trademarks of their owners:

- Roblox — Roblox Corporation
- Unity — Unity Technologies
- Godot — Godot Engine contributors
- Unreal Engine — Epic Games
- Blender — Blender Foundation
- OpenAI / ChatGPT — OpenAI
- Claude — Anthropic
- Gemini — Google
- OpenCode — OpenCode contributors
- GitHub — GitHub, Inc.
- Microsoft and Visual Studio Code — Microsoft Corporation

They are used only to identify the tools and file formats Kova works with. Kova Hub is not affiliated with, sponsored by, or endorsed by these companies. Do not use these marks in a way that suggests endorsement.

Editor extension icons in `apps/desktop/public/ext-icons/` belong to their respective extension publishers and are used only to identify the extensions listed in the catalog.

## AI providers

Kova does not include AI models. It runs AI CLIs that you install and authenticate yourself:

- OpenAI Codex CLI — <https://github.com/openai/codex>
- Claude Code — <https://claude.com/product/claude-code>
- Gemini CLI — <https://github.com/google-gemini/gemini-cli>
- OpenCode — <https://opencode.ai>

Your use of those tools and the data you send to them are governed by their own terms and privacy policies. Kova stores provider configuration locally in `%APPDATA%\KovaHub\providers.json`.

## User content

Projects, assets, renders, models, textures, audio, and generated outputs belong to their respective authors. Kova does not claim ownership of user content. Importing an asset does not grant a license to use it — check the asset's own license before shipping.

## Before distributing binaries

This file is a summary, not a complete license report. Before publishing a release build:

1. Run a license report for npm, Cargo, and Python dependencies.
2. Include the full license texts and copyright notices required by those licenses.
3. Keep the GPL notice for the Blender add-on.
4. Do not add Microsoft VS Code binaries, the Microsoft Marketplace, or proprietary engine assets to the build.

This document is not legal advice.
