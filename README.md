# Kova Hub

**Local-first desktop workspace for AI-assisted game development.**

Kova Hub keeps the brief, the assets, the checks, the Blender scene, the AI run and the review decision in one project folder. AI can work with the project, but it cannot silently overwrite it.

![Kova Hub overview](media/screenshots/overview.png)

<p>
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Platform: Windows" src="https://img.shields.io/badge/platform-Windows%2010%2F11-lightgrey">
  <img alt="Status: early preview" src="https://img.shields.io/badge/status-early%20preview-orange">
</p>

> Early preview. Windows 10/11 x64 is the supported platform today. The data model and UI can still change.

## Install

### One command

Open PowerShell on Windows 10/11:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/AlexeyKurgan/Kova/main/install.ps1 | iex"
```

The script:

1. takes the latest GitHub Release;
2. downloads the NSIS installer;
3. verifies SHA256 against `manifest.json`;
4. removes Mark-of-the-Web;
5. installs silently;
6. launches Kova Hub.

No Python, Node, Rust, Visual Studio or code-signing certificate is required.

Manual installers: [GitHub Releases](https://github.com/AlexeyKurgan/Kova/releases/latest).

The installer is not code-signed yet. Windows SmartScreen may ask you to confirm
an unsigned app; the SHA256 is checked by the install script.

## What Kova is

Kova is not a chat wrapper and not a cloud IDE. It is a local control room for a
game project:

- **Projects** are real folders. Kova does not hide project files in a database.
- **Tasks** are briefs with goals, criteria, constraints, skills and linked assets.
- **Assets** are passports: versions, hashes, previews, metrics, checks and usage.
- **AI runs** are isolated, snapshotted and reviewed before changes are applied.
- **Memory** lives in the project, in a readable `.hub/` folder and ledger.
- **Everything important is reversible**: snapshots, Review, archive and trash.

## Feature tour

### Projects and tasks

- Project cards with covers, engines, task counts and recent activity.
- Trash, restore and permanent purge.
- Tasks with goals, acceptance criteria, constraints, skills, templates and linked assets.
- Eight built-in task templates: Roblox prop, sword, hit animation, UV fix, LOD, VFX, Roblox export and code feature.
- Workflow steps that stop after each step until you approve the next one.
- Task tabs: Brief, Work, Checks, Result, History.
- “Why did this happen?” panel built from the ledger, not from AI guesses.

### Assets

- Asset library with previews, search, filters, list/grid views and pagination.
- Passport with versions, hashes, usage, provenance and export profiles.
- Per-version checks, Blender metrics and `.glb`/`.gltf` 3D viewer; Blender converts `.blend`/`.fbx`/`.obj`.
- Object-level scene diff between versions: added/removed objects, transforms, materials and triangle counts.
- Engine contracts for Blender, Roblox, Godot, Unity, Unreal, RPG Maker and Web.
- Engine importers and native project reimport for Godot and Unity.
- Dependency map with manual links between assets.

### Review

- Review Inbox and archive.
- Add/modify/delete file diffs with unified patches.
- Checks and stale-check detection.
- Replay a failed check, capture its environment and compare status/output.
- Image pins and comments tied to an asset version.
- Version comparison slider (A/B).
- “Second opinion” prompt for an independent critic.
- Accept, rework or archive; accepting with failed checks requires explicit confirmation.

### AI providers

- CLI providers: Codex CLI, Claude Code, Gemini CLI, OpenCode, or a custom command.
- OpenAI-compatible API providers; keys are encrypted with Windows DPAPI.
- Local connectors: Ollama, LM Studio and other localhost endpoints.
- Model catalog, manual models, default model per provider.
- Read-only, workspace and auto tool policies.
- Per-project run queue and git worktree/sandbox-copy isolation.
- Live output, cancellation, resume, handoff preview and interrupted-run recovery.
- Token budget based only on real provider-reported usage.
- Per-provider token budgets, usage breakdown and 80% warning.
- Routing rules by task tag and reusable agent roles.

### Clipboard mode

For free browser AIs:

- Kova prepares a task capsule and copies it to the clipboard.
- You paste it into any chat and bring the answer back with “Paste answer”.
- The response becomes an artefact and goes to Review.
- Nothing is applied without a snapshot and explicit approval.

### Blender

- Auto-installed `kova_bridge` add-on and live status.
- Headless inspection, QA, metrics, preview renders and viewport screenshots.
- 28 bundled Blender skills.
- Asset preview and glTF conversion through Blender.
- Custom `KOVA_BLENDER` path when auto-detection fails.

### Project memory

- File-based semantic-ish search across tasks, assets, chats, decisions and ledger events, with Russian/English asset synonyms and relevance scoring.
- Activity timeline with hours/days/months/years and type filters.
- Project diary with 7/14/30-day summaries and a calendar of active days.
- Ledger of every important action.

### Packages and engines

- Package catalog with permissions, tools, checks and engine coverage.
- Install, enable, disable and uninstall packages.
- Godot, Unity, Unreal, RPG Maker and Web packages detect the engine and project.
- Import assets into the right engine folder:
  - Godot: `assets/kova/`
  - Unity: `Assets/Kova/`
  - Unreal: `Content/Kova/Source/`
  - RPG Maker: `img/pictures/` or `audio/se/`
  - Web: `public/assets/`
- Godot/Unity native reimport runs the editor in batch/headless mode when available.

### Style Guard

- Project Style Bible in `.hub/style/bible.json`.
- Triangle, vertex, material, texture and bone budgets.
- License requirement and asset-name regex.
- Style warnings in the asset passport and Review.
- Palette check samples the asset preview and warns when too few pixels are close to the Style Bible palette.

### Night Shift

- Queue of tasks for unattended runs.
- Start time, provider, task limit and stop-on-error.
- Sequential runs through the existing AI runner.
- Snapshot before each run; results go to Review, never auto-applied.
- Morning report with per-task status and links.
- The scheduler runs while Kova is open.

### Doctor and notifications

- Environment checks: `.hub`, Git, Blender, engine, isolation, network guard, token, snapshots, disk.
- Safe “Fix” for `.hub` structure and journal files.
- JSON diagnostics export.
- Notification center with ranges and type filters.
- About screen with update check.

## Quick start

1. Install Kova and open it.
2. Create a project or open an existing folder.
3. Choose the engine (Roblox, Godot, Unity, Unreal, Blender, RPG Maker, Web or generic).
4. Add an AI provider in **Agents** — CLI, API or Clipboard.
5. Create a task, or start from a template.
6. Link assets to the task.
7. Run checks or a Blender inspection.
8. Prepare a capsule, run the agent, or paste a response.
9. Review the diff, pins and checks.
10. Apply worktree changes, accept the result, or send it back for rework.

A good first task is a small model with a clear budget, for example a Roblox prop
under 8,000 triangles with one material and a base pivot.

## AI provider notes

Open **Agents** in the sidebar. Presets exist for Codex, Claude Code, Gemini CLI
and OpenCode. Install and authenticate the CLI yourself; Kova never receives
your CLI login.

API providers support OpenAI-compatible, Anthropic Messages and Google Gemini
request formats. API keys are encrypted in `%APPDATA%\KovaHub\secrets.json` with
Windows DPAPI and are never returned by the local API.

Cloud-specific adapters:

- **Azure OpenAI** — resource URL, deployment, `api-key`.
- **Google Vertex AI** — project + region, token from `GOOGLE_ACCESS_TOKEN` or `gcloud`.
- **AWS Bedrock** — region + model, SigV4 from AWS environment variables.

Execution policies:

- **Read only** — list/read files.
- **Workspace** — read/write/delete inside the project.
- **Auto** — also run commands inside the project.

Writes and commands pause for approval. Worktree changes are applied only by an
explicit click, after a snapshot.

## Security and privacy

- The core listens only on `127.0.0.1:8765`.
- Owner token protects the local API; Roblox bridge endpoints use a separate bridge token.
- Blender bridge listens on `127.0.0.1:47832`.
- Provider secrets use Windows DPAPI.
- No telemetry is sent by Kova.
- OS sandbox backends (Docker/WSL/Windows Sandbox) are detected in Settings.
  When none is available, Kova reports the fallback: a sandbox project copy plus
  Windows Job Object containment.
- Kova does not intercept commands a CLI runs inside itself; read the provider’s
  own permission model.
- The editor port `48620` has authentication disabled by code-server. Do not expose it.

## Where data lives

| Path | Contents |
| --- | --- |
| `<project>/` | Source files and imported assets |
| `<project>/.hub/` | Project metadata, tasks, assets, checks, review, snapshots, ledger, previews, packages, style |
| `%APPDATA%\KovaHub\projects.json` | Project registry |
| `%APPDATA%\KovaHub\providers.json` | AI provider configuration |
| `%APPDATA%\KovaHub\secrets.json` | API keys encrypted with DPAPI |
| `%APPDATA%\KovaHub\core-token.json` | Local owner token |
| `%APPDATA%\KovaHub\worktrees\` | Temporary git worktrees |
| `%LOCALAPPDATA%\KovaHub\editor\` | code-server and extensions |
| `%LOCALAPPDATA%\KovaHub\blender\bridge.json` | Blender bridge discovery |

Back up `.hub/` and `assets/` together. `.hub/` is intentionally readable JSON/Markdown.

## Requirements

**To use the installed app**

- Windows 10/11 x64
- WebView2 Runtime (preinstalled on Windows 11)
- Optional: Blender 4.2+ (tested with 5.2 LTS)
- Optional: an AI CLI or API provider

**To build from source**

- Node.js 20+
- Python 3.11+
- Rust 1.77.2+ with MSVC toolchain
- Visual Studio Build Tools C++ workload
- Git
- PyInstaller for the core sidecar

## Build from source

Install prerequisites with `winget`:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.EdgeWebView2Runtime -e
rustup default stable-msvc
```

Clone and set up:

```powershell
git clone https://github.com/AlexeyKurgan/Kova.git
cd Kova
powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
```

Development:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1
```

Production build:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
powershell -ExecutionPolicy Bypass -File scripts/run-app.ps1
```

The build creates a self-contained core sidecar, the Tauri app and MSI/NSIS
installers in `apps/desktop/src-tauri/target/release/bundle/`.

Useful commands:

| Script | Purpose |
| --- | --- |
| `scripts/setup.ps1` | Check prerequisites and install dependencies |
| `scripts/dev.ps1` | Start core + `tauri dev` |
| `scripts/build.ps1` | Build core, app, MSI and NSIS |
| `scripts/run-core.ps1` | Start only the Python core |
| `scripts/run-app.ps1` | Start core + built app |
| `scripts/release.ps1` | Build, hash and write `release/manifest.json` |

`KOVA_SKIP_CORE_BUILD=1` rebuilds only the shell when the sidecar is current.

## Repository layout

```text
apps/desktop/                 Tauri shell + React UI
core/kova_core/               FastAPI core, domain, storage, checks, integrations
core/kova_core/integrations/blender/
                              Blender bridge, add-on, skills
core/kova_core/integrations/engines/
                              Godot, Unity, Unreal, RPG Maker, Web adapters
core/tests/                   Python tests
scripts/                      setup, dev, build, release, diagnostics
media/screenshots/            README screenshots
.github/workflows/            CI and release workflows
USER_GUIDE.md                 Russian end-user guide
docs/                         Internal notes (gitignored)
```

## Tests

```powershell
cd core
python -m pytest -q
cd ..
npm run typecheck
```

Current suite: **132 Python tests**, plus TypeScript typecheck.

## Troubleshooting

**Core: недоступен**
Check that port `8765` is free and start the core:

```powershell
Get-NetTCPConnection -LocalPort 8765
powershell -ExecutionPolicy Bypass -File scripts/run-core.ps1
```

**App opens blank**
Install or repair the WebView2 Runtime.

**Rust build fails with missing `link.exe`**
Install Visual Studio Build Tools C++ workload and run `rustup default stable-msvc`.

**Blender is installed but not detected**
Open Blender once, then refresh the Blender panel. Set `KOVA_BLENDER` to the full path if needed.

**3D preview does not load for `.blend`/`.fbx`/`.obj`**
Those formats need Blender. `.glb`/`.gltf` work without it. Check the cache in `<project>/.hub/artifacts/viewer`.

**Installer shows SmartScreen**
The current installer is unsigned. Use the one-line installer with SHA256 check,
or build from source. A trusted certificate is not required for local use.

**Editor cannot download code-server**
Check internet access and antivirus rules for `%LOCALAPPDATA%\KovaHub\editor`.

## Documentation

- [Russian user guide](USER_GUIDE.md)
- [MIT License](LICENSE)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Kova Hub is released under the [MIT License](LICENSE). The Blender add-on is
GPL-3.0-or-later because it runs inside Blender. Blender itself is not bundled.
code-server is downloaded at runtime and is not redistributed. Brand names and
logos belong to their owners.
