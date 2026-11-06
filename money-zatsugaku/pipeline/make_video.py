#!/usr/bin/env python3
"""台本JSON → YouTube 動画一式（mp4 / サムネ / SRT / 概要欄）を作る。

  python3 pipeline/make_video.py content/scripts/ep001.json            # 本番（VOICEVOX アプリを起動しておく）
  python3 pipeline/make_video.py content/scripts/ep001.json --tts dummy  # 声なしで流れだけ確認

仕様は CONTRACT.md と pipeline/README.md を参照。
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import wave
from dataclasses import dataclass, field
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
ROOT = PIPELINE_DIR.parent
sys.path.insert(0, str(PIPELINE_DIR))

from tts import DEFAULT_SPEAKER, DEFAULT_STYLE, SAMPLE_RATE, TTSError, load_config, make_tts, wav_duration  # noqa: E402

CHANNEL_NAME = "聞くだけでお金持ちになる雑学"
FFMPEG = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/usr/bin/ffprobe"
W, H = 1920, 1080

# 既定値は pipeline/config.json に1か所でまとめている
CONFIG = load_config()
TIMING = {k: v for k, v in CONFIG["timing"].items() if not k.startswith("$")}  # 「間」「演出」（秒）
BGM_GAIN_DB = float(CONFIG["bgm"].get("gain_db", -25.0))

SUB_MAX_LINE = 26   # 1行の最大文字数
SUB_MAX_LINES = 2


def log(msg: str) -> None:
    print(msg, flush=True)


def sha(*parts) -> str:
    h = hashlib.sha256()
    for p in parts:
        if isinstance(p, bytes):
            h.update(p)
        else:
            h.update(json.dumps(p, ensure_ascii=False, sort_keys=True).encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()[:24]


def run(cmd: list[str], cwd: Path | None = None) -> None:
    r = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"コマンド失敗: {' '.join(map(str, cmd))[:300]}\n{r.stderr[-3000:]}")


# --------------------------------------------------------------------------- 台本

def load_script(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    warn = []
    for k in ("id", "title", "items"):
        if k not in data:
            raise SystemExit(f"台本に必須キー '{k}' がありません: {path}")
    data.setdefault("format", "regular")
    if data["format"] not in ("regular", "sleep"):
        raise SystemExit(f"format は regular か sleep: {data['format']}")
    th = data.get("thumbnail") or {}
    if len(th.get("main", "")) > 10:
        warn.append(f"thumbnail.main が10字超: {th.get('main')}")
    if len(th.get("sub", "")) > 20:
        warn.append(f"thumbnail.sub が20字超: {th.get('sub')}")
    for it in data["items"]:
        if len(it.get("heading", "")) > 18:
            warn.append(f"item {it.get('id')}: heading が18字超")
        cap = (it.get("visual") or {}).get("caption", "")
        if len(cap) > 25:
            warn.append(f"item {it.get('id')}: caption が25字超")
        if not any(it.get(k) for k in ("hook", "body", "rich_point")):
            warn.append(f"item {it.get('id')}: 読み上げ文が空")
    for w in warn:
        log(f"  [警告] {w}")
    return data


def split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s*\n\s*", "\n", (text or "").strip())
    parts = re.split(r"(?<=[。！？!?])|\n", text)
    out: list[str] = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        if out and len(p) <= 2 and not re.search(r"[ぁ-んァ-ン一-龥a-zA-Z0-9]", p):
            out[-1] += p  # 「」」などの残りかすは前に付ける
        else:
            out.append(p)
    return out


# --------------------------------------------------------------------------- シーン

@dataclass
class Sentence:
    text: str
    wav: Path | None = None
    start: float = 0.0   # シーン先頭からの秒
    dur: float = 0.0


@dataclass
class Scene:
    kind: str                 # title | item
    template: str             # scene | title
    data: dict
    chapter: str
    parts: list[list[Sentence]] = field(default_factory=list)
    image: Path | None = None
    image_base: Path | None = None   # 見出しだけ隠した画像（見出しを素早く出す演出用）
    frames: int = 0
    start: float = 0.0        # 動画先頭からの秒
    narr_end: float = 0.0     # シーン内でナレーションが終わる秒

    @property
    def sentences(self) -> list[Sentence]:
        return [s for p in self.parts for s in p]


def build_scenes(script: dict) -> list[Scene]:
    mode = script["format"]
    items = script["items"]
    total = f"{len(items):02d}"
    th = script.get("thumbnail") or {}
    scenes: list[Scene] = []

    def parts_of(*texts):
        return [[Sentence(t) for t in split_sentences(x)] for x in texts if x and split_sentences(x)]

    intro_sub = th.get("sub") or CHANNEL_NAME
    scenes.append(Scene("title", "title", {"mode": mode, "title": script["title"], "sub": intro_sub},
                        "オープニング", parts_of((script.get("intro") or {}).get("text", ""))))
    for i, it in enumerate(items, 1):
        idx = f"{i:02d}"
        scenes.append(Scene("item", "scene", {
            "mode": mode, "heading": it.get("heading", ""), "visual": it.get("visual") or {},
            "index": idx, "total": total, "channel": CHANNEL_NAME,
        }, f"{idx} {it.get('heading', '')}", parts_of(it.get("hook"), it.get("body"), it.get("rich_point"))))
    outro_text = (script.get("outro") or {}).get("text", "")
    if outro_text:
        end_title = "おやすみなさい" if mode == "sleep" else "ご視聴ありがとうございました"
        scenes.append(Scene("title", "title", {"mode": mode, "title": end_title, "sub": CHANNEL_NAME},
                            "エンディング", parts_of(outro_text)))
    return scenes


# --------------------------------------------------------------------------- テンプレート・画像

class Templates:
    NAMES = {"scene": (W, H, "SCENE"), "title": (W, H, "SCENE"), "thumbnail": (1280, 720, "THUMB")}

    def __init__(self, force_fallback: bool = False):
        self.design_dir = ROOT / "design" / "templates"
        self.fallback_dir = PIPELINE_DIR / "fallback_templates"
        self.paths: dict[str, Path] = {}
        for name in self.NAMES:
            p = self.design_dir / f"{name}.html"
            self.paths[name] = p if p.exists() and not force_fallback else self.fallback_dir / f"{name}.html"
        self._fp: dict[Path, str] = {}

    def describe(self) -> str:
        return ", ".join(f"{n}={'design' if p.parent == self.design_dir else 'fallback'}"
                         for n, p in self.paths.items())

    def fingerprint(self, name: str) -> str:
        """テンプレートのフォルダと design/assets・tokens.json の中身が変わったらキャッシュを無効化する。"""
        d = self.paths[name].parent
        if d not in self._fp:
            h = hashlib.sha256()
            roots = [d]
            if d == self.design_dir:
                roots += [ROOT / "design" / "assets", ROOT / "design" / "tokens.json"]
            for r in roots:
                files = [r] if r.is_file() else sorted(x for x in r.rglob("*") if x.is_file()) if r.exists() else []
                for f in files:
                    h.update(str(f.relative_to(ROOT)).encode())
                    h.update(f.read_bytes())
            self._fp[d] = h.hexdigest()
        return self._fp[d]


def render_images(requests_: list[tuple], tpl: Templates, cache_dir: Path) -> None:
    """requests_ = [(template_name, data, out_png[, hide_text, out_base_png])]。
    キャッシュに無いものだけ Playwright で描画する。hide_text があれば、その文字だけ隠した版も撮る。"""
    img_cache = cache_dir / "images"
    img_cache.mkdir(parents=True, exist_ok=True)
    jobs, links = [], []
    for req in requests_:
        name, data, out = req[:3]
        hide, out_base = (req[3], req[4]) if len(req) > 3 else (None, None)
        w, h, var = tpl.NAMES[name]
        key = sha("img", 1, tpl.fingerprint(name), name, data, w, h)
        cached = img_cache / f"{key}.png"
        links.append((cached, out))
        job = {"template": str(tpl.paths[name]), "varName": var, "data": data,
               "width": w, "height": h, "out": str(cached)}
        need = not cached.exists()
        if hide:
            base = img_cache / f"{key}_hide.png"
            links.append((base, out_base))
            job.update(hideText=hide, outHidden=str(base))
            need = need or not (base.exists() or Path(str(base) + ".none").exists())
        if need and not any(j["out"] == str(cached) for j in jobs):
            jobs.append(job)
    if jobs:
        log(f"  画像を描画: {len(jobs)} 件（キャッシュ済み {len(requests_) - len(jobs)} 件）")
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
            json.dump(jobs, f, ensure_ascii=False)
            jf = f.name
        try:
            r = subprocess.run(["node", str(PIPELINE_DIR / "render.js"), jf], cwd=PIPELINE_DIR,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            if r.stderr.strip():
                log(r.stderr.strip())
            if r.returncode != 0:
                raise RuntimeError("テンプレートの描画に失敗しました（上のログを確認）")
        finally:
            os.unlink(jf)
    else:
        log(f"  画像: すべてキャッシュ済み（{len(requests_)} 件）")
    for cached, out in links:
        if out is None or cached == out:
            continue
        if cached.exists():
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(cached, out)
        elif out.exists():
            out.unlink()  # 見出しが見つからず隠し版が無い場合


# --------------------------------------------------------------------------- 字幕

def find_font() -> tuple[str, Path]:
    """(フォントのファミリー名, fontsdir)。design/assets を優先し、無ければシステムの日本語フォント。"""
    assets = ROOT / "design" / "assets"
    if assets.exists():
        cands = sorted([p for p in assets.rglob("*") if p.suffix.lower() in (".ttf", ".otf", ".ttc")],
                       key=lambda p: (0 if re.search(r"bold|black|heavy|w[6-9]", p.name, re.I) else 1, p.name))
        for p in cands:
            fam = subprocess.run(["fc-scan", "--format", "%{family[0]}", str(p)],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True).stdout.strip()
            if fam:
                return fam, p.parent
    prefer = ["Noto Sans CJK JP", "Noto Sans JP", "Source Han Sans JP", "BIZ UDPGothic", "IPAexGothic",
              "IPAPGothic", "IPAGothic", "TakaoPGothic", "VL PGothic", "Hiragino Sans", "Yu Gothic", "Meiryo"]
    out = subprocess.run(["fc-list", ":lang=ja", "family", "file"], stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, text=True).stdout if shutil.which("fc-list") else ""
    fams: dict[str, Path] = {}
    for line in out.splitlines():
        if ":" not in line:
            continue
        f, fam = line.split(":", 1)
        for name in fam.strip().split(","):
            fams.setdefault(name.strip(), Path(f.strip()).parent)
    for name in prefer:
        if name in fams:
            return name, fams[name]
    for name, d in fams.items():
        if "unifont" not in name.lower():
            return name, d
    log("  [警告] 日本語フォントが見つかりません。字幕が文字化けする可能性があります")
    return "sans-serif", Path("/usr/share/fonts")


def wrap_sub(text: str, max_line: int = SUB_MAX_LINE) -> list[str]:
    """字幕1枚分を均等な長さの行に折り返す（句読点の後ろ・かなの切れ目を優先）。"""
    lines, rest = [], text
    while len(rest) > max_line:
        k = math.ceil(len(rest) / max_line)
        target = math.ceil(len(rest) / k)
        best, best_score = target, None
        lo = max(2, target - 8, len(rest) - (k - 1) * max_line)  # 残りが k-1 行に収まる位置より前では切らない
        for i in range(lo, min(len(rest) - 1, max_line) + 1):
            prev, nxt = rest[i - 1], rest[i]
            score = abs(i - target)
            if prev in "、。，！？」）』…":
                score -= 10
            elif nxt in "、。，！？」）』…ゃゅょっャュョッー":
                score += 20  # 行頭に句読点・小書き文字が来ないように
            elif re.match(r"[一-龥]", prev) and re.match(r"[一-龥]", nxt):
                score += 6   # 漢字の熟語の途中はなるべく切らない
            elif prev in "をにはがでともへや" and nxt not in "をにはがでともへやのしてた":
                score -= 4   # 助詞の後ろは文節の切れ目になりやすい
            elif re.match(r"[ぁ-ん]", prev) and re.match(r"[一-龥ァ-ン]", nxt):
                score -= 2
            if best_score is None or score < best_score:
                best, best_score = i, score
        lines.append(rest[:best])
        rest = rest[best:]
    if rest:
        lines.append(rest)
    return lines


def sub_chunks(text: str) -> list[str]:
    """長い文を字幕何枚かに分ける（1枚は最大2行）。"""
    limit = SUB_MAX_LINE * SUB_MAX_LINES - 8  # 少し余裕を持たせ、読点で切れるようにする
    if len(text) <= limit:
        return [text]
    pieces = re.split(r"(?<=[、，])", text)
    chunks, cur = [], ""
    for p in pieces:
        while len(p) > limit:
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.append(p[:limit])
            p = p[limit:]
        if len(cur) + len(p) > limit:
            chunks.append(cur)
            cur = p
        else:
            cur += p
    if cur:
        chunks.append(cur)
    return [c for c in chunks if c]


def cues_for_scene(sc: Scene) -> list[tuple[float, float, str]]:
    """シーン内の字幕 (start, end, text)。"""
    cues = []
    for s in sc.sentences:
        chunks = sub_chunks(s.text)
        total = sum(len(c) for c in chunks)
        t = s.start
        for c in chunks:
            d = s.dur * len(c) / total
            cues.append((t, t + d, "\n".join(wrap_sub(c))))
            t += d
    return cues


def fmt_srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def fmt_ass_time(t: float) -> str:
    cs = int(round(max(t, 0) * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def make_ass(cues, font: str) -> str:
    # 画面下部18%（194px）に収まるサイズ: 60px × 2行 + 下余白40px
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font},60,&H00FFFFFF,&H000000FF,&H00101010,&H96000000,-1,0,0,0,100,100,1,0,1,5,2,2,120,120,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = []
    for a, b, text in cues:
        t = text.replace("\\", "＼").replace("{", "｛").replace("}", "｝").replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{fmt_ass_time(a)},{fmt_ass_time(b)},Default,,0,0,0,,{t}")
    return head + "\n".join(lines) + "\n"


# --------------------------------------------------------------------------- 映像

def ff_escape(p: str) -> str:
    return p.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'").replace(",", "\\,")


def encode_clip(sc: Scene, i: int, cfg: dict, font: str, fontsdir: Path, cache_dir: Path, burn: bool) -> Path:
    fps, n = cfg["fps"], sc.frames
    dur = n / fps
    cues = cues_for_scene(sc) if burn else []
    ass = make_ass(cues, font) if cues else ""
    zoom = float(cfg.get("zoom") or 0)
    zoom_dir = (i % 2 == 0)
    h_in, h_delay = float(cfg.get("heading_in") or 0), float(cfg.get("heading_delay") or 0)
    base = sc.image_base if (h_in > 0 and sc.image_base and sc.image_base.exists()) else None
    img_hash = hashlib.sha256(sc.image.read_bytes()).hexdigest()
    base_hash = hashlib.sha256(base.read_bytes()).hexdigest() if base else None
    key = sha("clip", 4, img_hash, base_hash, n, fps, zoom, cfg["fade"], h_in, h_delay, zoom_dir, ass, font)
    out = cache_dir / "clips" / f"{key}.mp4"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    k = min(n, int(math.ceil((h_delay + h_in) * fps)) + 2)  # 見出しを隠した画像を使うフレーム数

    def src(idx: int, frames: int) -> str:
        if zoom > 0:
            # 2倍に拡大してから zoompan（ガタつき防止）。1→1+zoom か 1+zoom→1 のズーム（シーン全体で一定速度）
            z = (f"1+{zoom}*on/{max(n - 1, 1)}" if zoom_dir else f"{1 + zoom}-{zoom}*on/{max(n - 1, 1)}")
            return (f"[{idx}:v]scale={W * 2}:{H * 2}:flags=lanczos,"
                    f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={frames}:s={W}x{H}:fps={fps}")
        return f"[{idx}:v]scale={W}:{H},fps={fps},trim=end_frame={frames}"

    if zoom > 0:
        inputs = ["-i", str(sc.image)] + (["-i", str(base)] if base else [])
    else:
        inputs = ["-loop", "1", "-framerate", str(fps), "-i", str(sc.image)]
        if base:
            inputs += ["-loop", "1", "-framerate", str(fps), "-i", str(base)]
    graph = src(0, n) + "[full];"
    if base:
        # 見出し無しの画像を上に重ね、0.3秒ほどでフェードアウト → 見出しが素早く現れる
        graph += (src(1, k) + f",format=yuva420p,fade=t=out:st={h_delay:.3f}:d={h_in:.3f}:alpha=1[hb];"
                  "[full][hb]overlay=eof_action=pass:format=auto[v0];")
    else:
        graph += "[full]null[v0];"
    chain = "[v0]"
    with tempfile.TemporaryDirectory(dir=cache_dir) as td:
        td = Path(td)
        filters = []
        if ass:
            (td / "s.ass").write_text(ass, encoding="utf-8")
            filters.append(f"ass=s.ass:fontsdir='{ff_escape(str(fontsdir))}'")
        f = min(cfg["fade"], dur / 4)
        filters.append(f"fade=t=in:st=0:d={f:.3f},fade=t=out:st={dur - f:.3f}:d={f:.3f},format=yuv420p")
        graph += chain + ",".join(filters) + "[v]"
        tmp = td / "clip.mp4"
        run([FFMPEG, "-hide_banner", "-y", *inputs, "-filter_complex", graph, "-map", "[v]",
             "-frames:v", str(n), "-r", str(fps), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
             "-tune", "stillimage", "-g", str(fps * 4), "-pix_fmt", "yuv420p", "-an", str(tmp)], cwd=td)
        shutil.move(str(tmp), out)
    return out


# --------------------------------------------------------------------------- 音声

def build_timeline(scenes: list[Scene], cfg: dict) -> float:
    fps = cfg["fps"]
    t_video = 0.0
    total_frames = 0
    for sc in scenes:
        t = cfg["lead"]
        for pi, part in enumerate(sc.parts):
            if pi:
                t += cfg["part_gap"]
            for si, s in enumerate(part):
                if si:
                    t += cfg["sentence_gap"]
                s.start, s.dur = t, wav_duration(s.wav)
                t += s.dur
        sc.narr_end = t
        sc.frames = max(int(math.ceil((t + cfg["item_gap"]) * fps)), int(fps * 2))
        sc.start = total_frames / fps
        total_frames += sc.frames
        t_video = total_frames / fps
    return t_video


def write_narration(scenes: list[Scene], cfg: dict, out: Path) -> None:
    fps = cfg["fps"]
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        for sc in scenes:
            n_total = sc.frames * SAMPLE_RATE // fps
            written = 0
            for s in sc.sentences:
                pos = int(round(s.start * SAMPLE_RATE))
                if pos > written:
                    w.writeframes(b"\0\0" * (pos - written))
                    written = pos
                with wave.open(str(s.wav), "rb") as r:
                    if r.getframerate() != SAMPLE_RATE or r.getnchannels() != 1 or r.getsampwidth() != 2:
                        raise RuntimeError(f"想定外のWAV形式: {s.wav}")
                    data = r.readframes(r.getnframes())
                w.writeframes(data)
                written += len(data) // 2
            if written > n_total:
                raise RuntimeError("内部エラー: シーンの音声がシーン長を超えました")
            w.writeframes(b"\0\0" * (n_total - written))


def pick_bgm(fmt: str, explicit: str | None, script_id: str) -> Path | None:
    """--bgm（ファイル / none） > config.json の bgm.<format> > bgm/<format>/*.mp3 > bgm/*.mp3 > なし"""
    if explicit:
        if explicit.lower() == "none":
            return None
        p = Path(explicit)
        if not p.exists():
            raise SystemExit(f"BGMファイルがありません: {p}")
        return p
    d = PIPELINE_DIR / "bgm"
    pattern = CONFIG["bgm"].get(fmt)
    if pattern:
        hits = sorted(PIPELINE_DIR.glob(pattern))
        if hits:
            return hits[0]
        log(f"  [注意] config.json の BGM（{pattern}）が見つかりません。ほかの BGM を探します")
    files = sorted((d / fmt).glob("*.mp3")) if (d / fmt).exists() else []
    files = files or sorted(d.glob("*.mp3"))
    if not files:
        return None
    return files[int(hashlib.md5(script_id.encode()).hexdigest(), 16) % len(files)]


NARRATION_LUFS = {fmt: float(TIMING[fmt].get("narration_lufs", -16.0)) for fmt in TIMING}


def measure_lufs(path: Path) -> float | None:
    r = subprocess.run([FFMPEG, "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128", "-f", "null", "-"],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
    return float(m[-1]) if m else None


def media_duration(path: Path) -> float:
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return float(r.stdout.strip())


def make_bgm_loop(bgm: Path, cache_dir: Path) -> Path:
    """曲の終わりと頭を crossfade でつないだ「ループ1周分」の WAV を作る（-stream_loop で継ぎ目なく回せる）。"""
    xf = float(CONFIG["bgm"].get("loop_crossfade", 1.5))
    key = sha("bgmloop", 3, hashlib.sha256(bgm.read_bytes()).hexdigest(), xf)
    out = cache_dir / "bgm" / f"{key}.wav"
    if out.exists():
        return out
    out.parent.mkdir(parents=True, exist_ok=True)
    d = media_duration(bgm)
    if xf <= 0 or d < xf * 4:
        run([FFMPEG, "-hide_banner", "-y", "-i", str(bgm), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(out)])
        return out
    # [末尾xf秒 → 先頭xf秒 を crossfade] + [xf 〜 D-xf] = 長さ約 D-xf の1周。並べると毎回 xf 秒の crossfade になる
    # （ffmpeg 6 では asplit した同じ流れ同士の acrossfade が空になるため、一度 WAV にしてから3回読み込む）
    full = out.with_suffix(".full.wav")
    run([FFMPEG, "-hide_banner", "-y", "-i", str(bgm), "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(full)])
    d = media_duration(full)
    fc = (f"[0:a][1:a]acrossfade=d={xf - 0.05:.4f}:c1=qsin:c2=qsin[x];"
          f"[x][2:a]concat=n=2:v=0:a=1[o]")
    tmp = out.with_suffix(".tmp.wav")
    run([FFMPEG, "-hide_banner", "-y",
         "-ss", f"{d - xf:.4f}", "-i", str(full),
         "-t", f"{xf:.4f}", "-i", str(full),
         "-ss", f"{xf:.4f}", "-t", f"{d - 2 * xf:.4f}", "-i", str(full),
         "-filter_complex", fc, "-map", "[o]", "-c:a", "pcm_s16le", str(tmp)])
    full.unlink()
    tmp.replace(out)
    return out


def mux(concat_list: Path, narration: Path, bgm: Path | None, total: float, out: Path, fmt: str) -> None:
    cmd = [FFMPEG, "-hide_banner", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-i", str(narration)]
    # ナレーションを目標ラウドネスに合わせる（YouTube は -14LUFS 基準。小さすぎる音は持ち上げてくれない）
    lufs = measure_lufs(narration)
    gain = 0.0 if lufs is None or lufs < -70 else max(-20.0, min(20.0, NARRATION_LUFS[fmt] - lufs))
    narr = f"[1:a]volume={gain:.2f}dB,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"
    if bgm:
        loop = make_bgm_loop(bgm, PIPELINE_DIR / ".cache")
        cmd += ["-stream_loop", "-1", "-i", str(loop)]
        fo = max(total - 4, 0)
        fc = (f"{narr},asplit=2[n1][n2];"
              f"[2:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,"
              f"atrim=0:{total:.3f},volume={BGM_GAIN_DB}dB,afade=t=in:d=2,afade=t=out:st={fo:.3f}:d=4[b];"
              # ナレーション中だけ BGM を数dB下げる（サイドチェイン・ダッキング）
              f"[b][n1]sidechaincompress=threshold=0.03:ratio=2:attack=150:release=900:knee=4[bd];"
              f"[n2][bd]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]")
    else:
        fc = f"{narr},alimiter=limit=0.95[a]"
    cmd += ["-filter_complex", fc, "-map", "0:v", "-map", "[a]", "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", f"{total:.3f}", "-movflags", "+faststart", str(out)]
    run(cmd)


# --------------------------------------------------------------------------- 書き出し

def fmt_chapter(t: float) -> str:
    s = int(t)
    return f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}" if s >= 3600 else f"{s // 60}:{s % 60:02d}"


def write_srt(scenes: list[Scene], out: Path) -> None:
    lines, n = [], 0
    for sc in scenes:
        for a, b, text in cues_for_scene(sc):
            n += 1
            lines += [str(n), f"{fmt_srt_time(sc.start + a)} --> {fmt_srt_time(sc.start + b)}", text, ""]
    out.write_text("\n".join(lines), encoding="utf-8")


def bgm_credit(bgm: Path | None) -> str | None:
    if not bgm:
        return None
    txt = bgm.with_suffix(".txt")
    if txt.exists():
        return txt.read_text(encoding="utf-8").strip()
    # config.json の bgm_credits（キーはファイル名の先頭: R1_xxx.mp3 → "R1"）
    for k, v in CONFIG.get("bgm_credits", {}).items():
        if bgm.name == k or bgm.name.startswith(k + "_") or bgm.stem == k:
            return v
    return None


CHAPTER_LINE = re.compile(r"^\s*(?:(?:\d{1,2}:)?\d{1,2}:\d{2}|\d{2})\s+\S")
HASHTAG_LINE = re.compile(r"^\s*#\S+(\s+#\S+)*\s*$")


def compute_chapters(scenes: list[Scene], total: float) -> list[tuple[float, str]]:
    """YouTube チャプターの条件: 0:00 から始まり、各10秒以上、3つ以上。"""
    chapters: list[tuple[float, str]] = []
    for sc in scenes:
        if not chapters:
            chapters.append((sc.start, sc.chapter))
        elif sc.start - chapters[-1][0] >= 10 and total - sc.start >= 10:
            chapters.append((sc.start, sc.chapter))
        elif len(chapters) == 1 and sc.kind == "item" and scenes[0].kind == "title":
            chapters[0] = (0.0, sc.chapter)  # オープニングが10秒未満なら、0:00 を最初のネタにする
    return chapters if len(chapters) >= 3 else []


def write_description(script: dict, scenes: list[Scene], total: float, speaker: str, bgm: Path | None,
                      out: Path) -> None:
    chapters = [f"{fmt_chapter(t)} {c}" for t, c in compute_chapters(scenes, total)]
    lines = (script.get("description") or "").strip().splitlines()
    # 台本側の概要欄に「00:00 オープニング / 01 見出し…」のような目次の下書きがあれば、実際の時刻に置き換える
    body, i, replaced = [], 0, False
    hashtags = []
    while i < len(lines):
        j = i
        while j < len(lines) and CHAPTER_LINE.match(lines[j]):
            j += 1
        if j - i >= 3:
            if chapters and not replaced:
                body += chapters
                replaced = True
            i = j
            continue
        if HASHTAG_LINE.match(lines[i]):
            hashtags.append(lines[i].strip())
        else:
            body.append(lines[i])
        i += 1
    parts = ["\n".join(body).strip()]
    if chapters and not replaced:
        parts.append("■ 目次\n" + "\n".join(chapters))
    srcs = []
    for it in script["items"]:
        for u in it.get("sources") or []:
            if u not in srcs:
                srcs.append(u)
    if srcs:
        parts.append("■ 参考・出典\n" + "\n".join(srcs))
    credit = [] if f"VOICEVOX:{speaker}" in "\n".join(lines) else [f"VOICEVOX:{speaker}"]
    bc = bgm_credit(bgm)
    if bc:
        credit.append(f"BGM: {bc}")
    if credit:
        parts.append("■ クレジット\n" + "\n".join(credit))
    if not hashtags:
        tags = script.get("tags") or []
        if tags:
            hashtags = [" ".join("#" + re.sub(r"\s+", "", t) for t in tags[:3])]
    parts += hashtags
    text = "\n\n".join(p for p in parts if p)
    text = re.sub(r"\n{3,}", "\n\n", text)
    out.write_text(text + "\n", encoding="utf-8")


# --------------------------------------------------------------------------- main

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="台本JSONから動画を作る")
    ap.add_argument("script", help="台本JSON（例: content/scripts/ep001.json）")
    ap.add_argument("--tts", choices=["voicevox", "dummy"], default="voicevox",
                    help="voicevox=本番（既定） / dummy=声の代わりにトーン音")
    ap.add_argument("--voicevox-url", default=os.environ.get("VOICEVOX_URL", "http://localhost:50021"))
    ap.add_argument("--speaker", default=DEFAULT_SPEAKER, help="VOICEVOX の話者名（/speakers の name）")
    ap.add_argument("--style", default=None,
                    help="話者のスタイル名（既定: regular=ノーマル / sleep=しっとり。無ければノーマル）")
    ap.add_argument("--bgm", default=None, help="BGM の mp3（既定: pipeline/bgm/ から自動。none で無し）")
    ap.add_argument("--out-dir", default=str(ROOT / "output"))
    ap.add_argument("--fallback-templates", action="store_true",
                    help="design/templates があっても pipeline/fallback_templates を使う（確認用）")
    ap.add_argument("--max-items", type=int, default=None, help="試し用: 先頭Nネタだけで作る")
    ap.add_argument("--jobs", type=int, default=max(1, min(4, (os.cpu_count() or 2) // 2)),
                    help="映像クリップの並列エンコード数")
    args = ap.parse_args(argv)

    script_path = Path(args.script)
    log(f"台本: {script_path}")
    script = load_script(script_path)
    if args.max_items:
        script["items"] = script["items"][: args.max_items]
    fmt = script["format"]
    cfg = TIMING[fmt]
    sid = script["id"]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_dir = PIPELINE_DIR / ".cache"
    cache_dir.mkdir(exist_ok=True)

    scenes = build_scenes(script)
    log(f"  format={fmt} / シーン {len(scenes)}（ネタ {len(script['items'])}）")

    # 1) 音声
    style = args.style or DEFAULT_STYLE[fmt]
    try:
        tts = make_tts(args.tts, cache_dir, fmt, args.voicevox_url, args.speaker, style)
    except TTSError as e:
        log(f"[エラー] {e}")
        return 2
    if args.tts == "voicevox":
        log(f"  TTS: VOICEVOX {tts.engine_version} / {args.speaker}（{tts.style_used}, id={tts.speaker_id}）"
            f" speed={tts.params['speedScale']}")
    else:
        log("  TTS: dummy（トーン音。本番は --tts を外して VOICEVOX で実行）")
    sents = [s for sc in scenes for s in sc.sentences]
    for k, s in enumerate(sents, 1):
        try:
            s.wav = tts.synth(s.text)
        except TTSError as e:
            log(f"[エラー] {e}")
            return 2
        if k % 25 == 0 or k == len(sents):
            log(f"  音声 {k}/{len(sents)}")
    total = build_timeline(scenes, cfg)
    log(f"  動画の長さ: {total:.1f} 秒（{total / 60:.1f} 分）")

    # 2) 画像
    tpl = Templates(force_fallback=args.fallback_templates)
    log(f"  テンプレート: {tpl.describe()}")
    img_dir = cache_dir / "work" / sid
    img_dir.mkdir(parents=True, exist_ok=True)
    reqs = []
    for i, sc in enumerate(scenes):
        sc.image = img_dir / f"scene{i:03d}.png"
        if sc.kind == "item" and cfg.get("heading_in") and sc.data.get("heading"):
            sc.image_base = img_dir / f"scene{i:03d}_base.png"
            reqs.append((sc.template, sc.data, sc.image, sc.data["heading"], sc.image_base))
        else:
            reqs.append((sc.template, sc.data, sc.image))
    th = script.get("thumbnail") or {}
    first_icon = next(((it.get("visual") or {}).get("icon") for it in script["items"]
                       if (it.get("visual") or {}).get("icon")), "coins")
    thumb_out = out_dir / f"{sid}_thumbnail.png"
    reqs.append(("thumbnail", {"main": th.get("main", script["title"][:10]), "sub": th.get("sub", ""),
                               "icon": th.get("icon", first_icon), "mode": fmt}, thumb_out))
    render_images(reqs, tpl, cache_dir)

    # 3) 映像クリップ
    burn = cfg["burn_subs"]
    font, fontsdir = find_font()
    if burn:
        log(f"  字幕フォント: {font}（{fontsdir}）")
    log(f"  映像クリップをエンコード（{len(scenes)} 本, 並列 {args.jobs}）…")
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        futs = [ex.submit(encode_clip, sc, i, cfg, font, fontsdir, cache_dir, burn) for i, sc in enumerate(scenes)]
        clips = [f.result() for f in futs]

    # 4) 音声ミックス・結合
    work = cache_dir / "work" / sid
    concat_list = work / "concat.txt"
    concat_list.write_text("".join(f"file '{c}'\n" for c in clips), encoding="utf-8")
    narration = work / "narration.wav"
    write_narration(scenes, cfg, narration)
    bgm = pick_bgm(fmt, args.bgm, sid)
    log(f"  BGM: {bgm.name if bgm else 'なし（pipeline/bgm/ に mp3 を置くと自動で使います）'}")
    mp4 = out_dir / f"{sid}.mp4"
    log("  結合・ミックス中…")
    mux(concat_list, narration, bgm, total, mp4, fmt)

    # 5) 字幕・概要欄
    srt = out_dir / f"{sid}.srt"
    write_srt(scenes, srt)
    desc = out_dir / f"{sid}_description.txt"
    write_description(script, scenes, total, args.speaker, bgm, desc)
    upload = out_dir / f"{sid}_upload.txt"
    upload.write_text(f"タイトル:\n{script['title']}\n\nタグ:\n{','.join(script.get('tags') or [])}\n",
                      encoding="utf-8")

    log("完了:")
    for p in (mp4, thumb_out, srt, desc, upload):
        log(f"  {p}")
    if not burn:
        log("  （sleep 形式のため字幕は焼き込まず、SRT を YouTube にアップロードしてください）")
    if args.tts == "dummy":
        log("  ※ dummy TTS で作成したため音声はトーン音です")
    return 0


if __name__ == "__main__":
    sys.exit(main())
