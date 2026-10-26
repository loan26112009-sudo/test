#!/bin/bash
# Reframe 360 Pro - installation macOS (le panneau est multiplateforme)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.reframe360.pro"
rm -rf "$DEST" && mkdir -p "$DEST" && cp -R "$ROOT/extension/." "$DEST/"
for v in 9 10 11 12 13; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
if ! command -v ffmpeg >/dev/null; then echo "Installe FFmpeg : brew install ffmpeg"; fi
echo "Installe. Premiere Pro > Fenetre > Extensions > Reframe 360 Pro"
