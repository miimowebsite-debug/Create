#!/usr/bin/env bash
# VOICEVOX Engine（Linux CPU版）を導入して起動する。新しいクラウドセッション/Linuxサーバー用。
# ローカルPCなら、この手順の代わりに VOICEVOX アプリを起動するだけでOK（README参照）。
#
#   bash pipeline/setup_voicevox.sh            # 導入して起動（フォアグラウンド）
#   VOICEVOX_DIR=~/voicevox bash pipeline/setup_voicevox.sh
set -euo pipefail

VERSION="${VOICEVOX_VERSION:-0.26.1}"
DIR="${VOICEVOX_DIR:-$HOME/voicevox}"
ARCHIVE="voicevox_engine-linux-cpu-x64-${VERSION}.7z.001"
URL="https://github.com/VOICEVOX/voicevox_engine/releases/download/${VERSION}/${ARCHIVE}"

mkdir -p "$DIR"
cd "$DIR"
if [ ! -x linux-cpu-x64/run ]; then
  if [ ! -f "$ARCHIVE" ]; then
    echo "ダウンロード: $URL"
    curl -fL -o "$ARCHIVE" "$URL"
  fi
  python3 -m pip install --quiet py7zr
  echo "展開中…"
  python3 - "$ARCHIVE" <<'PY'
import sys, py7zr
with py7zr.SevenZipFile(sys.argv[1], "r") as z:
    z.extractall(".")
PY
  chmod +x linux-cpu-x64/run
fi
echo "起動: http://127.0.0.1:50021 （止めるときは Ctrl+C）"
cd linux-cpu-x64
exec ./run --host 127.0.0.1 --port 50021
