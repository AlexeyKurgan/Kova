#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
core="$root/core"
bin="$root/apps/desktop/src-tauri/binaries"
work="$root/build/pyinstaller"
mkdir -p "$bin" "$work"

skills="$core/kova_core/integrations/blender/skills"
blender="$core/kova_core/integrations/blender"

cd "$core"
python -m PyInstaller \
  --noconfirm \
  --clean \
  --onefile \
  --name kova-core \
  --distpath "$bin" \
  --workpath "$work" \
  --specpath "$work" \
  --add-data "$skills:kova_core/integrations/blender/skills" \
  --add-data "$blender/inspect_asset.py:kova_core/integrations/blender" \
  --add-data "$blender/addon:kova_core/integrations/blender/addon" \
  --collect-data certifi \
  sidecar.py

triple="$(rustc -vV | awk '/^host:/ {print $2}')"
if [[ -z "$triple" ]]; then
  echo "Could not determine Rust host triple" >&2
  exit 1
fi

source="$bin/kova-core"
target="$bin/kova-core-$triple"
if [[ ! -f "$source" ]]; then
  echo "PyInstaller did not produce kova-core" >&2
  exit 1
fi
mv -f "$source" "$target"
chmod +x "$target"
echo "Sidecar: $target"
