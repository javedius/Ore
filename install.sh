#!/bin/sh
# Ore installer for macOS (Apple Silicon). Downloads the latest release,
# installs the app into /Applications. Files fetched with curl carry no
# quarantine, so the app opens without Gatekeeper prompts.
set -e

REPO="javedius/Ore"

if [ "$(uname -m)" != "arm64" ]; then
  echo "Ore ships Apple Silicon builds only (Intel Macs are not supported)."
  exit 1
fi

echo "Fetching the latest Ore release…"
ASSET=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" |
  grep 'browser_download_url' | grep 'aarch64.dmg' | cut -d '"' -f 4 | head -1)
[ -n "$ASSET" ] || { echo "Could not find a release asset."; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fSL "$ASSET" -o "$TMP/Ore.dmg"

echo "Installing into /Applications…"
hdiutil attach "$TMP/Ore.dmg" -nobrowse -quiet
SRC=$(ls -d /Volumes/*/Ore.app 2>/dev/null | head -1)
[ -n "$SRC" ] || { echo "Ore.app not found inside the dmg."; hdiutil detach "/Volumes/$(basename "$(ls /Volumes | grep -i ore | head -1)")" -quiet || true; exit 1; }
cp -R "$SRC" /Applications/
hdiutil detach "$SRC" -quiet || true

echo "✅ Ore installed. Launch it from Applications."
