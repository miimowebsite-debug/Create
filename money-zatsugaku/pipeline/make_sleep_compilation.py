#!/usr/bin/env python3
"""複数の regular 台本のネタをまとめて、睡眠用（format:"sleep"）の台本JSONを作る。

  python3 pipeline/make_sleep_compilation.py ep001 ep002 ep003 ep004 ep005
  python3 pipeline/make_sleep_compilation.py ep001 ep002 --target-minutes 60 -o output/scripts/sleep01.json

できた台本はそのまま make_video.py に渡せる:
  python3 pipeline/make_video.py output/scripts/sleep_ep001-ep005.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent

# 長さの見積もり用（VOICEVOX 青山龍星・速さ1.0 でおよそ 0.13 秒/文字）
SEC_PER_CHAR = 0.13
SLEEP_SPEED = 0.88
SLEEP_ITEM_OVERHEAD = 1.0 + 3.0 + 1.2 * 2 + 0.5 * 4  # 頭の間 + ネタ間 + 段落間 + 文の間（make_video.py の TIMING と揃える）


def resolve(name: str) -> Path:
    p = Path(name)
    if p.suffix == ".json" and p.exists():
        return p
    for d in (ROOT / "content" / "scripts", PIPELINE_DIR / "samples", ROOT / "output" / "scripts"):
        q = d / f"{name}.json"
        if q.exists():
            return q
    raise SystemExit(f"台本が見つかりません: {name}（content/scripts/{name}.json を探しました）")


def est_seconds(text: str) -> float:
    return len("".join(text.split())) * SEC_PER_CHAR / SLEEP_SPEED


def item_seconds(it: dict) -> float:
    return sum(est_seconds(it.get(k) or "") for k in ("hook", "body", "rich_point")) + SLEEP_ITEM_OVERHEAD


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="regular 台本を束ねて睡眠用1時間版の台本を作る")
    ap.add_argument("episodes", nargs="+", help="ep001 のようなID、または台本JSONのパス")
    ap.add_argument("--id", help="出力する台本のID（既定: sleep_<最初>-<最後>）")
    ap.add_argument("--title", help="YouTubeタイトル（既定は自動）")
    ap.add_argument("--target-minutes", type=float, default=None,
                    help="この長さ（分）に達したらネタの追加をやめる（既定: 全ネタを入れる）")
    ap.add_argument("-o", "--output", help="出力先（既定: output/scripts/<id>.json）")
    args = ap.parse_args(argv)

    srcs = [(n, json.loads(resolve(n).read_text(encoding="utf-8"))) for n in args.episodes]
    first, last = srcs[0][1].get("id", srcs[0][0]), srcs[-1][1].get("id", srcs[-1][0])
    sid = args.id or (f"sleep_{first}" if len(srcs) == 1 else f"sleep_{first}-{last}")

    intro = ("こんばんは。聞くだけでお金持ちになる雑学です。"
             "この動画では、お金にまつわる雑学を、ゆっくりとお話ししていきます。"
             "部屋の明かりを落として、目を閉じたまま、楽な姿勢でお聞きください。")
    outro = ("今夜のお話は、ここまでです。最後まで聞いてくださり、ありがとうございました。"
             "あしたも、すこしずつ、豊かな一日になりますように。おやすみなさい。")
    total = est_seconds(intro) + est_seconds(outro) + 10
    items, tags, seen_tags, sources_eps = [], [], set(), []
    for name, sc in srcs:
        if sc.get("format", "regular") != "regular":
            print(f"  [注意] {name} は format={sc.get('format')} ですが、そのまま使います", file=sys.stderr)
        for t in sc.get("tags") or []:
            if t not in seen_tags:
                seen_tags.add(t)
                tags.append(t)
        added = 0
        for it in sc.get("items", []):
            if args.target_minutes and total >= args.target_minutes * 60:
                break
            new = json.loads(json.dumps(it, ensure_ascii=False))
            new["id"] = f"{len(items) + 1:02d}"
            new["from"] = f"{sc.get('id', name)}-{it.get('id', '')}"
            items.append(new)
            total += item_seconds(it)
            added += 1
        if added:
            sources_eps.append(sc.get("title", name))

    if not items:
        raise SystemExit("ネタが1つもありません")
    n = len(items)
    title = args.title or f"【睡眠用・聞き流し】聞くだけでお金持ちになる雑学{n}選【約{round(total / 60)}分】"
    desc_lines = [
        "眠る前や作業中に、聞き流すだけでお金の知識が身につく雑学をまとめました。",
        "画面を見なくても内容がわかるように、ゆっくり読み上げています。",
        "",
        "■ 収録元の動画",
        *[f"・{t}" for t in sources_eps],
    ]
    out = {
        "id": sid,
        "format": "sleep",
        "title": title,
        "thumbnail": {"main": "聞き流し睡眠用", "sub": f"お金の雑学{n}選"},
        "description": "\n".join(desc_lines),
        "tags": (["睡眠用", "聞き流し", "作業用"] + [t for t in tags if t not in ("睡眠用", "聞き流し", "作業用")])[:20],
        "intro": {"text": intro},
        "items": items,
        "outro": {"text": outro},
    }
    out_path = Path(args.output) if args.output else ROOT / "output" / "scripts" / f"{sid}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"台本を作成: {out_path}")
    print(f"  ネタ {n} 本 / 推定 {total / 60:.0f} 分")
    if total < 50 * 60:
        print(f"  [注意] 1時間に足りません（あと約 {(60 * 60 - total) / 60:.0f} 分）。台本を追加してください。")
    print(f"  次: python3 pipeline/make_video.py {out_path.relative_to(ROOT) if out_path.is_relative_to(ROOT) else out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
