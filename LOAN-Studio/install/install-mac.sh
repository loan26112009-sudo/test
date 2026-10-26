#!/bin/bash
# LOAN Studio (+ Reframe 360) - installation macOS (les panneaux sont multiplateformes)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$HOME/Library/Application Support/Adobe/CEP/extensions"
rm -rf "$EXT/com.reframe360.pro"
DEST="$EXT/com.loanstudio"
rm -rf "$DEST" && mkdir -p "$DEST" && cp -R "$ROOT/extension/." "$DEST/"
for v in 9 10 11 12 13 14 15; do defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1; done
if ! command -v ffmpeg >/dev/null; then echo "Installe FFmpeg : brew install ffmpeg"; fi
echo "Installe. Premiere Pro > Fenetre > Extensions > LOAN Studio"
