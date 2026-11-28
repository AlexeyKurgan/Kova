#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${KOVA_SKIP_CORE_BUILD:-0}" != "1" ]]; then
  "$root/scripts/build-core.sh"
else
  triple="$(rustc -vV | awk '/^host:/ {print $2}')"
  if [[ ! -f "$root/apps/desktop/src-tauri/binaries/kova-core-$triple" ]]; then
    echo "Sidecar is missing and KOVA_SKIP_CORE_BUILD=1 was set" >&2
    exit 1
  fi
fi

cd "$root/apps/desktop"
npx tauri build
