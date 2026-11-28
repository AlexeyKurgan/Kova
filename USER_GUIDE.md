# Kova Hub — User Guide

Kova Hub is a local-first desktop workspace for building a game project with AI
agents. Official installers are available for Windows 10/11 x64. macOS and Linux
are a source-build preview. The interface is available in Russian and English.

---

## 1. Installation

Open PowerShell and run one command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/AlexeyKurgan/Kova/main/install.ps1 | iex"
```

What happens:

1. Kova finds the highest published GitHub Release.
2. Downloads the installer.
3. Verifies SHA256 against `manifest.json`.
4. Installs the app.
5. Launches Kova Hub.

Python, Node.js, Visual Studio and certificates are not required.

Installers are also available manually:
<https://github.com/AlexeyKurgan/Kova/releases/latest>

The installer is not code-signed yet. Windows SmartScreen may ask you to confirm —
this is normal for an unsigned build.

---

## 2. First launch

1. Create a project or open an existing folder.
2. Pick an engine: Roblox, Godot, Unity, Unreal, Blender, RPG Maker, Web or “No engine”.
3. Open **Agents** and add an AI provider.
4. Create your first task — manually or from a template.
5. Import assets and link them to the task.
6. Run checks or a Blender inspection.
7. Prepare a capsule, run an agent, or paste a response from Clipboard mode.
8. Review the result in **Review**.
9. Accept it, rework it, or roll back to a snapshot.

A project is a regular folder. Kova creates `.hub/` inside it with tasks, assets,
history and snapshots.

---

## 3. Interface

- **Left sidebar** — Overview, Projects, Tasks, Chat, Team, Assets, Skills,
  Packages, Review, Snapshots, Memory, Diary, Agents, Night Shift, Doctor, Editor.
- **Top bar** — breadcrumbs, global search, Core status and icons.
- **Right side** — project inspector: connections, issues, memory and tips.
- **Ctrl+K** — global project search.

Navigation counters show active tasks and items waiting in Review.

---

## 4. Tasks

A task contains:

- a goal;
- acceptance criteria;
- constraints;
- type and engine;
- skills;
- linked assets;
- checks;
- workflow steps.

Task tabs:

- **Brief** — goal, criteria, context, “Why did this happen?”.
- **Work** — agent run, queue, handoff, live output.
- **Checks** — check commands and results.
- **Result** — artefacts, assets and responses.
- **History** — task events.

Templates: a Roblox model, sword, hit animation, UV fix, LOD, VFX, Roblox export
and a code feature.

---

## 5. Capsule and Clipboard

Clipboard mode is intended for free browser-based AI:

1. Open a task.
2. Press **Capsule**.
3. Kova builds the prompt and copies it.
4. Paste the prompt into any AI chat.
5. Copy the response.
6. Press **Paste response** → **From clipboard**.
7. The response is saved as an artefact and goes to Review.

Nothing is applied to the project automatically.

---

## 6. Assets

An asset is a passport:

- file and current version;
- hash and size;
- preview and 3D viewer;
- Blender metrics;
- checks per version;
- origin and licence;
- linked tasks;
- dependencies;
- engine contract;
- export profiles.

Versions can be compared:

- **Metrics** — objects, triangles, materials, textures, size.
- **Scene** — added/removed/modified objects, transforms, materials and triangles.

Importing an asset copies the file into `<project>/assets`.

### Engine contract

Kova checks format, axes, scale, pivot and budgets for the selected engine.
Findings are shown in the asset passport.

### Import into engine

For Godot, Unity, Unreal, RPG Maker and Web:

1. Install the engine package in **Packages**.
2. Open an asset.
3. Find the **Import into engine** card.
4. Press **Import current version**.

The file is placed in the engine folder. For Godot, Unity and Unreal there is also
**Reimport in engine**, which runs a headless/batchmode import.

---

## 7. Blender

1. Install Blender 4.2+ and open it once.
2. Kova installs the `kova_bridge` add-on.
3. A **Kova** panel appears in Blender.
4. In Kova, press **Inspect in Blender** in the asset passport.

Kova can:

- open and inspect an asset;
- calculate metrics;
- render previews;
- capture viewport screenshots;
- run QA;
- convert `.blend`/`.fbx`/`.obj` to GLB for the 3D viewer.

If Blender is not detected, set `KOVA_BLENDER` to the full path of `blender.exe`
(or the Blender binary on macOS/Linux).

---

## 8. AI providers

Section **Agents**. Modes:

- **CLI** — Codex, Claude Code, Gemini CLI, OpenCode or a custom command.
- **API** — OpenAI-compatible, Anthropic, Gemini, local servers.
- **Clipboard** — no API, using copied prompts and responses.
- **Local connector** — Ollama/LM Studio on localhost.

API keys are stored in the OS keyring — DPAPI on Windows, Keychain on macOS,
Secret Service on Linux — and are never returned by the local API.

Tool policies:

- **Read only**.
- **Workspace** — read/write/delete inside the project.
- **Auto** — also run commands.

Writes, deletions and commands require approval.

### Limits and roles

- The project token budget counts only real usage reported by the provider.
- Each provider can have its own token limit; Kova warns at 80%.
- If a provider does not report usage, the run is marked `unknown`, not “0”.
- Routing rules map task tags to providers.
- Roles add a name and instructions to the prompt.

---

## 8.1. Check replay

Every check has a **Replay** button. Kova records the environment
(OS, Python, git commit), reruns the command and compares status and output.

## 9. Review

Review shows:

- previews of linked assets;
- pins and comments on a version;
- a version comparison slider;
- file changes and patches;
- check results;
- stale checks;
- **Accept**, **Rework** and **Second opinion** buttons.

Pins:

1. Press **Add pin**.
2. Click the problem area on the image.
3. Write a comment.
4. The pin is linked to the review, asset and version.

For video, Review shows a player and a timeline. **Pin at 0:00** places a comment
on the current frame; timeline markers jump the player to the right time. Older
pins without a timestamp remain regular spatial pins.

For Blender animations, after **Inspect in Blender** Kova renders up to 7 frames.
Review shows a frame slider, a **Pin on frame N** button and per-frame pin markers.
Pins are linked to the version and frame number.

**Second opinion** builds a prompt for an independent critic and copies it.

The Review archive is available through the **Inbox / Archive** switch.

---

## 10. Memory and Diary

**Memory** searches tasks, assets, chats, decisions and events, and understands
Russian/English synonyms such as “pivot” and “material”. Search uses a SQLite FTS
index in `.hub/.local/search.sqlite3`; the index is refreshed from file
fingerprints. There is an activity chart by hour/day/month/year and a memory
breakdown.

**Diary** shows a summary for 7/14/30 days:

- events;
- created and closed tasks;
- assets;
- accepted results;
- snapshots;
- a calendar of active days.

---

## 10.1. Project sharing

In **Projects** you can export a project as `.kovaproj` and import it on another
machine.

- In the project menu, choose **Export** and pick a file.
- To import, press **Import**, choose the destination folder and the `.kovaproj`.
- The archive contains project files and `.hub`; it excludes `.git`, `node_modules`,
  virtual environments, caches, `build/release`, `.hub/.local`, `.env` and keys.
- Limits: 20,000 files and 2 GB. Archives with unsafe paths or symlinks are rejected.
- History and ledger paths may contain local paths — review the archive before
  sharing it outside your team.

---

## 10.2. Team spaces

The **Team** section lets several machines work on one project without a Kova
server.

1. Open the project and the **Team** section.
2. Pick a transport:
   - **Shared folder** — OneDrive, Dropbox, iCloud Drive, Nextcloud, a NAS or a
     network folder;
   - **GitHub / Git** — a dedicated branch (default `kova-team`); the token is
     stored in the system keyring and is not saved in `.git/config`.
3. Press **Connect**. An empty folder becomes a new space; a folder containing
   `kova-team.json` becomes an existing one.
4. **Publish** sends a project bundle: `.kovaproj` plus author, message and
   SHA256. Secrets, caches, `.git` and `.hub/team` never enter the bundle.
5. On another machine, import the first bundle via **Projects → Import**, open the
   project and connect the same space.
6. **Check for changes** lists other members' bundles. Open a bundle, inspect the
   file list and press **Apply**.
7. If a file changed both here and in the team, Kova reports a conflict. For each
   file choose **Mine** or **From team** — nothing is overwritten silently.
8. **Roll back apply** returns files to the state before the last apply.
   Published bundles stay in the space.

Limits: 20,000 files and 2 GB per bundle; the three most recent incoming bundles
are cached. This is bundle-level collaboration with explicit review. Real-time
pair programming and live co-editing are optional and outside the current scope.
Let the cloud folder finish syncing before checking for changes.

---

## 11. Packages

In **Packages** you can:

- install a package;
- enable/disable it;
- remove it;
- inspect permissions, tools, checks and templates;
- import a local `.zip` with `kova-package.json` via **Import package**;
- open the **Marketplace** tab, set an HTTPS index URL and install a package.

A package can add declarative task templates to the task library. Package code is
not executed; templates are only text briefs and criteria.

The marketplace verifies the archive SHA256 and does not execute package code: the
manifest goes through the same checks as a local import. Built-in index:
`https://raw.githubusercontent.com/AlexeyKurgan/Kova/main/packages/index.json`.

Engine packages:

- Blender Core;
- Roblox Core;
- Godot Core;
- Unity Core;
- Unreal Core;
- RPG Maker Core;
- Web Core.

The package must be installed and enabled for engine import to work.

### Language

In **Settings → Language** you can switch to English. The whole interface is
translated, along with package descriptions, package task templates and Doctor
messages: the desktop client sends the language to the core with the
`X-Kova-Language` header.

### Sandbox

Kova detects Docker, WSL2 and Windows Sandbox, but **does not run the provider CLI
inside them**: the binary and its authorization would have to be installed in the
container. Instead, Kova uses a sandbox copy of the project and a Job Object (on
Windows) or a POSIX process group. This limitation is shown explicitly in Settings
and Doctor — the app does not pretend to have a full OS sandbox.

---

## 12. Style Guard

**Style Bible** in Settings contains:

- budgets for triangles, vertices, materials, textures and bones;
- a required licence;
- a regex name pattern;
- a palette.

Style checks appear in assets and Review.

The palette is checked against the asset preview: Kova warns when too few pixels
are close to the Style Bible colours.

---

## 13. Night Shift

1. Open **Night Shift**.
2. Select tasks.
3. Select a provider.
4. Set the time and task limit.
5. Enable the schedule or press **Run now**.

Kova runs tasks one by one, creates a snapshot before each run and leaves the
result in Review. Auto-apply is disabled.

The scheduler runs while Kova is open.

---

## 14. Snapshots

- Manual creation.
- Automatic snapshot before applying a worktree.
- Timeline by day.
- Compare two snapshots.
- Diff against the current project before rollback.
- One-click restore.

Before a rollback, Kova creates an emergency snapshot.

---

## 15. Doctor

Doctor checks:

- `.hub`;
- the engine;
- Git;
- Blender;
- the project trash;
- snapshots;
- project packages and the package for the selected engine;
- write permissions for the project and `.hub`;
- ports 8765 / 47832 / 48620;
- agent isolation;
- local mode;
- the egress guard;
- process containment;
- the OS sandbox;
- the Core token;
- the secrets backend;
- free disk space.

**Repair** safely restores `.hub` folders and journals. `project.json` is never
created automatically.

Diagnostics export is a JSON file.

---

## 16. Settings

- Beginner / Pro mode.
- Comfortable / Compact density.
- Text size and chat width.
- Reduced motion.
- Language: Russian / English.
- Style Bible.
- Sandbox: Docker/WSL/Windows Sandbox status and the documented fallback.
- Backups: snapshots.
- About: version and update check.

---

## 17. Updates

In **Settings → About**:

1. Press **Check for updates**.
2. If a new version exists, download the installer.
3. Press **Install and close Kova**, or run the installer manually.

You can also repeat the one-line install command from section 1 — it always picks
the highest published release.

Self-update is available in the Windows build. On macOS/Linux, update the sources
and rebuild the app.

---

## 18. Where data lives

| Path | Contents |
| --- | --- |
| `<project>/` | Source files and `assets/` |
| `<project>/.hub/` | Tasks, assets, checks, Review, snapshots, ledger, style, packages |
| `<project>/.hub/team/` | Device-local team space config, sync state, cache and backups |
| `%APPDATA%\KovaHub\` / `~/Library/Application Support/KovaHub/` / `$XDG_DATA_HOME/KovaHub/` | Registry, providers, identity, secrets and owner token |
| `<app data>/secrets.json` | Secrets (DPAPI / Keychain / Secret Service; 0600 file fallback) |
| `<app data>/core-token.json` | Local owner token |
| `<app data>/worktrees/` | Temporary git worktrees |
| `%LOCALAPPDATA%\KovaHub\editor\` / `~/Library/Application Support/KovaHub/editor/` / `$XDG_DATA_HOME/KovaHub/editor/` | code-server and extensions |
| `%LOCALAPPDATA%\KovaHub\blender\bridge.json` / `~/Library/Caches/KovaHub/blender/` / `$XDG_CACHE_HOME/KovaHub/blender/` | Blender bridge discovery |

To move a project, copy `.hub/` and `assets/` together.

---

## 19. Security

- Core listens only on `127.0.0.1:8765`.
- The API requires an owner token.
- The Roblox bridge uses a separate bridge token.
- Secrets are encrypted by DPAPI on Windows, Keychain on macOS and Secret Service
  on Linux; the explicit fallback is a 0600 file.
- No telemetry is sent.
- The OS sandbox is detected in Settings; when unavailable, Kova uses a sandbox
  copy of the project plus a Job Object or a POSIX process group.
- Kova does not intercept commands that a CLI runs inside itself.

---

## 20. Troubleshooting

**Core: unavailable**
Check port 8765 and start the core:

```powershell
Get-NetTCPConnection -LocalPort 8765
powershell -ExecutionPolicy Bypass -File scripts/run-core.ps1
```

**Blank window**
Install or repair the WebView2 Runtime.

**Blender is not detected**
Open Blender once and refresh the Blender panel. If needed, set
`KOVA_BLENDER`.

**The 3D preview of `.blend`/`.fbx`/`.obj` does not load**
Blender is required. `.glb`/`.gltf` work without it.

**SmartScreen during installation**
The installer is not signed. Use the one-line installer (it verifies SHA256) or
build from source.

**The editor does not download**
Check the internet connection and antivirus rules for
`%LOCALAPPDATA%\KovaHub\editor`.
