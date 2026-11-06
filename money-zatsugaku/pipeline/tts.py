"""TTS クライアント（VOICEVOX Engine HTTP API / ダミー）。

出力はすべて 24000Hz・モノラル・16bit の WAV に揃える。
音声は (テキスト, 話者, パラメータ) のハッシュで pipeline/.cache/audio にキャッシュする。
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 24000

# 抑揚は控えめ（intonationScale < 1.0）
VOICE_PARAMS = {
    "regular": {"speedScale": 1.0, "intonationScale": 0.85, "pitchScale": 0.0, "volumeScale": 1.0},
    "sleep": {"speedScale": 0.88, "intonationScale": 0.7, "pitchScale": 0.0, "volumeScale": 0.9},
}


class TTSError(RuntimeError):
    pass


def _wav_bytes(samples: bytes, rate: int = SAMPLE_RATE) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(samples)
    return buf.getvalue()


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


class BaseTTS:
    name = "base"

    def __init__(self, cache_dir: Path, fmt: str):
        self.cache_dir = cache_dir / "audio"
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.params = dict(VOICE_PARAMS[fmt])

    def cache_key(self, text: str) -> str:
        raise NotImplementedError

    def _synthesize(self, text: str) -> bytes:
        raise NotImplementedError

    def synth(self, text: str) -> Path:
        key = hashlib.sha256(self.cache_key(text).encode("utf-8")).hexdigest()[:24]
        out = self.cache_dir / f"{key}.wav"
        if out.exists() and out.stat().st_size > 44:
            return out
        data = self._synthesize(text)
        tmp = out.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(out)
        return out


class DummyTTS(BaseTTS):
    """文字数に比例した長さの小さなトーン音（BGMの音量調整も確認できるように無音ではなく音を出す）。"""

    name = "dummy"
    SEC_PER_CHAR = 0.13  # VOICEVOX 速さ1.0で だいたい 7〜8 文字/秒

    def __init__(self, cache_dir: Path, fmt: str, speaker_name: str = "dummy"):
        super().__init__(cache_dir, fmt)
        self.speaker_name = speaker_name

    def cache_key(self, text: str) -> str:
        return json.dumps(["dummy", 2, text, self.params], ensure_ascii=False, sort_keys=True)

    def _synthesize(self, text: str) -> bytes:
        chars = len([c for c in text if not c.isspace()])
        dur = max(0.5, chars * self.SEC_PER_CHAR / self.params["speedScale"]) + 0.2
        n = int(dur * SAMPLE_RATE)
        freq = 220.0 + (int(hashlib.md5(text.encode()).hexdigest()[:2], 16) % 8) * 20
        amp = 0.12 * 32767
        frames = bytearray()
        for i in range(n):
            t = i / SAMPLE_RATE
            env = min(1.0, t / 0.05, (dur - t) / 0.05)
            # 文字ごとに区切れる「話し声っぽい」振幅変調
            syl = 0.55 + 0.45 * math.sin(2 * math.pi * 7.5 * t) ** 2
            v = amp * env * syl * math.sin(2 * math.pi * freq * t)
            frames += struct.pack("<h", int(v))
        return _wav_bytes(bytes(frames))


class VoicevoxTTS(BaseTTS):
    """VOICEVOX Engine (アプリ版でも Engine 単体でも可) の HTTP API クライアント。"""

    name = "voicevox"

    def __init__(self, cache_dir: Path, fmt: str, url: str = "http://localhost:50021",
                 speaker_name: str = "青山龍星", style_name: str = "ノーマル", timeout: float = 120,
                 fallback_id: int | None = None):
        super().__init__(cache_dir, fmt)
        import requests  # 遅延 import（dummy だけなら不要）

        self.requests = requests
        self.url = url.rstrip("/")
        self.timeout = timeout
        self.speaker_name = speaker_name
        self.style_name = style_name
        self.fallback_id = fallback_id
        self.speaker_id, self.engine_version = self._find_speaker(speaker_name, style_name)

    def _get(self, path: str):
        try:
            r = self.requests.get(self.url + path, timeout=10)
            r.raise_for_status()
            return r
        except self.requests.RequestException as e:
            raise TTSError(
                f"VOICEVOX Engine ({self.url}) に接続できません: {e}\n"
                "  → VOICEVOX アプリを起動してから再実行してください。"
                " 動作確認だけなら --tts dummy を付けて実行できます。"
            ) from e

    def _find_speaker(self, name: str, style: str):
        try:
            version = self._get("/version").text.strip().strip('"')
        except TTSError:
            raise
        speakers = self._get("/speakers").json()
        cand = [s for s in speakers if s.get("name") == name]
        if not cand:
            cand = [s for s in speakers if name in s.get("name", "")]
        if not cand and self.fallback_id is not None:
            # 名前で見つからないとき（表記ゆれ等）は予備の話者IDを使う
            for sp in speakers:
                for st in sp.get("styles", []):
                    if st.get("id") == self.fallback_id:
                        self.style_used = f"{sp.get('name')}/{st.get('name')}"
                        return int(st["id"]), version
        if not cand:
            names = ", ".join(s.get("name", "?") for s in speakers)
            raise TTSError(f"話者「{name}」が見つかりません。利用可能: {names}")
        styles = cand[0].get("styles", [])
        st = (next((s for s in styles if s.get("name") == style), None)
              or next((s for s in styles if s.get("name") == "ノーマル"), None)
              or (styles[0] if styles else None))
        if st is None:
            raise TTSError(f"話者「{name}」にスタイルがありません")
        self.style_used = st.get("name")
        return int(st["id"]), version

    def cache_key(self, text: str) -> str:
        return json.dumps(["voicevox", self.engine_version, self.speaker_id, text, self.params],
                          ensure_ascii=False, sort_keys=True)

    def _synthesize(self, text: str) -> bytes:
        rq = self.requests
        try:
            q = rq.post(f"{self.url}/audio_query", params={"text": text, "speaker": self.speaker_id},
                        timeout=self.timeout)
            q.raise_for_status()
            query = q.json()
            query.update(self.params)
            query["outputSamplingRate"] = SAMPLE_RATE
            query["outputStereo"] = False
            query["prePhonemeLength"] = 0.1
            query["postPhonemeLength"] = 0.1
            s = rq.post(f"{self.url}/synthesis", params={"speaker": self.speaker_id},
                        data=json.dumps(query), headers={"Content-Type": "application/json"},
                        timeout=self.timeout)
            s.raise_for_status()
        except rq.RequestException as e:
            raise TTSError(f"VOICEVOX 合成に失敗しました（{text[:20]}…）: {e}") from e
        return s.content


# 既定の声: 青山龍星。名前とスタイル名で /speakers から探し、IDは予備
DEFAULT_SPEAKER = "青山龍星"
DEFAULT_STYLE = {"regular": "ノーマル", "sleep": "しっとり"}
FALLBACK_ID = {("青山龍星", "ノーマル"): 13, ("青山龍星", "しっとり"): 84}


def make_tts(kind: str, cache_dir: Path, fmt: str, url: str, speaker: str, style: str) -> BaseTTS:
    if kind == "dummy":
        return DummyTTS(cache_dir, fmt, speaker)
    if kind == "voicevox":
        return VoicevoxTTS(cache_dir, fmt, url=url, speaker_name=speaker, style_name=style,
                           fallback_id=FALLBACK_ID.get((speaker, style)))
    raise ValueError(f"unknown tts: {kind}")
