#!/usr/bin/env python3
"""output/ にできた1本分を確認して納品フォルダ delivery/<id>/ にコピーする。

  python3 pipeline/deliver.py ep002            # 確認してコピー
  python3 pipeline/deliver.py ep002 --check    # 確認だけ

ファイル名は「<id>_<タイトルの先頭20字>」+ 種類ごとの末尾。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FFPROBE = shutil.which("ffprobe") or "/usr/bin/ffprobe"


def safe_title(title: str, n: int = 20) -> str:
    t = re.sub(r'[\\/:*?"<>|｜\s]+', "_", title).strip("_")
    return t[:n].rstrip("_")


def probe(mp4: Path) -> dict:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries",
                        "format=duration:stream=codec_type,width,height", "-of", "json", str(mp4)],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise SystemExit(f"ffprobe 失敗: {r.stderr}")
    j = json.loads(r.stdout)
    v = [s for s in j["streams"] if s["codec_type"] == "video"]
    a = [s for s in j["streams"] if s["codec_type"] == "audio"]
    return {"duration": float(j["format"]["duration"]), "width": v[0]["width"] if v else None,
            "height": v[0]["height"] if v else None, "audio": len(a)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("id")
    ap.add_argument("--script", help="台本JSON（既定: content/scripts/<id>.json）")
    ap.add_argument("--out-dir", default=str(ROOT / "output"))
    ap.add_argument("--delivery-dir", default=str(ROOT / "delivery"))
    ap.add_argument("--check", action="store_true", help="確認だけしてコピーしない")
    args = ap.parse_args(argv)

    sid = args.id
    script = Path(args.script) if args.script else ROOT / "content" / "scripts" / f"{sid}.json"
    title = json.loads(script.read_text(encoding="utf-8"))["title"]
    out = Path(args.out_dir)
    files = {
        ".mp4": out / f"{sid}.mp4",
        ".png": out / f"{sid}_thumbnail.png",
        ".srt": out / f"{sid}.srt",
        "_概要欄.txt": out / f"{sid}_description.txt",
        "_upload.txt": out / f"{sid}_upload.txt",
    }
    missing = [str(p) for p in files.values() if not p.exists()]
    if missing:
        print("足りないファイル: " + ", ".join(missing))
        return 1
    info = probe(files[".mp4"])
    ok = info["width"] == 1920 and info["height"] == 1080 and info["audio"] >= 1 and info["duration"] > 10
    print(f"{sid}: {info['duration']:.1f}秒 ({info['duration'] / 60:.1f}分) {info['width']}x{info['height']} "
          f"音声トラック{info['audio']} → {'OK' if ok else 'NG'}")
    if not ok:
        return 1
    if args.check:
        return 0
    base = f"{sid}_{safe_title(title)}"
    dest = Path(args.delivery_dir) / sid
    dest.mkdir(parents=True, exist_ok=True)
    for suffix, src in files.items():
        shutil.copy2(src, dest / f"{base}{suffix}")
    print(f"納品: {dest}/{base}.*")
    return 0


if __name__ == "__main__":
    sys.exit(main())
