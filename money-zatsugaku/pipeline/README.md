# 動画自動生成パイプライン

台本JSON（`content/scripts/epXXX.json`、形式は `CONTRACT.md`）から、YouTube に上げる一式を作ります。

```bash
python3 pipeline/make_video.py content/scripts/ep001.json
```

できるもの（`output/`）:

| ファイル | 中身 |
|---|---|
| `ep001.mp4` | 1920x1080 / H.264 / AAC 48kHz ステレオ |
| `ep001_thumbnail.png` | サムネ 1280x720 |
| `ep001.srt` | 字幕（YouTube にアップロード可） |
| `ep001_description.txt` | 概要欄（目次の時刻・出典・「VOICEVOX:青山龍星」のクレジット入り） |
| `ep001_upload.txt` | タイトルとタグ（コピペ用） |

`format: "sleep"` の台本は睡眠用になります（ゆっくり・暗めの画面・ネタ間3秒・字幕は焼き込まずSRTのみ）。

## 準備

```bash
# Python（3.9以上）
pip install -r pipeline/requirements.txt
# Node.js（18以上）と Playwright のブラウザ
cd pipeline && npm install && npx playwright install chromium && cd ..
# ffmpeg（libass 入り）
#   Windows: https://www.gyan.dev/ffmpeg/builds/ の full 版 / Mac: brew install ffmpeg / Ubuntu: sudo apt install ffmpeg
```

字幕用の日本語フォントは、`design/assets/` に `.ttf/.otf` があればそれを、無ければシステムの日本語フォント（Noto Sans CJK JP、IPAexゴシック、游ゴシック、メイリオ等）を自動で探します。

## 自分のPCで本番の声（VOICEVOX）を使う

1. [VOICEVOX](https://voicevox.hiroshiba.jp/) をインストールして **アプリを起動したままにする**（アプリが裏で Engine を `http://localhost:50021` で動かします）
2. そのまま実行するだけ:
   ```bash
   python3 pipeline/make_video.py content/scripts/ep001.json
   ```
3. 別のPCやポートの Engine を使うとき: `--voicevox-url http://192.168.0.10:50021`（環境変数 `VOICEVOX_URL` でも可）

声の既定値（名前で `/speakers` から探し、見つからないときだけ予備のIDを使う）:

| format | 話者 | スタイル | 予備ID | 速さ | 抑揚 |
|---|---|---|---|---|---|
| regular | 青山龍星 | ノーマル | 13 | 1.12 | 0.9（控えめ） |
| sleep | 青山龍星 | しっとり | 84 | 0.88 | 0.7 |

これらの値・間の長さ・BGMの既定は **`pipeline/config.json` の1か所** にまとめてあります（話速は `voice.regular.speedScale`、文の前後の無音は `prePhonemeLength` / `postPhonemeLength`）。

`--speaker 名前 --style スタイル名` で変更できます。概要欄のクレジットは話者名から自動で `VOICEVOX:青山龍星` と入ります（VOICEVOX・青山龍星の利用規約でクレジット表記が必要です）。

### Linux サーバー / 新しいクラウドセッションで Engine を動かす場合

```bash
bash pipeline/setup_voicevox.sh
```

中身は次の手順です（手でやっても同じ）:

1. GitHub releases から `voicevox_engine-linux-cpu-x64-0.26.1.7z.001` をダウンロード
   （`https://github.com/VOICEVOX/voicevox_engine/releases/download/0.26.1/voicevox_engine-linux-cpu-x64-0.26.1.7z.001`）
2. `pip install py7zr` して py7zr で展開
3. `cd linux-cpu-x64 && ./run --host 127.0.0.1 --port 50021`

CPU版の速さの目安: 4.5秒の音声が約1.4秒で生成（10分の動画の音声で数分）。

## 声なしで流れだけ確認する（dummy）

```bash
python3 pipeline/make_video.py pipeline/samples/sample_ep.json --tts dummy
```

声の代わりに、文字数に比例した長さのトーン音を入れます。画面・字幕・BGM・長さの確認用です。

## 睡眠用1時間版をまとめて作る

```bash
python3 pipeline/make_sleep_compilation.py ep001 ep002 ep003 ep004 ep005
python3 pipeline/make_video.py output/scripts/sleep_ep001-ep005.json
```

- 複数の regular 台本のネタをつなげて `format:"sleep"` の台本JSONを `output/scripts/` に書き出します（睡眠用の導入・締めの文も自動で付けます）
- 推定の長さを表示します。1時間に足りないときは注意が出ます。`--target-minutes 60` でその長さに達したらネタの追加を止めます
- `--id` `--title` `-o` で ID・タイトル・出力先を変更できます

## BGM

既定の曲は `pipeline/config.json` の `bgm` で決めます（今は regular＝R1「夜明け」、sleep＝S2「光差し込む森」）。

- 候補曲は `pipeline/bgm/candidates/`、出典とライセンスは `pipeline/bgm/CREDITS.md`。**mp3 は再配布禁止なので Git に入れていません**。新しい環境では CREDITS.md の URL（OpenTracks／旧 DOVA-SYNDROME）から再ダウンロードして同じファイル名で置いてください
- 曲は短いので、終わりと頭を 1.5秒のクロスフェードでつないでループします（`bgm.loop_crossfade`）
- 音量は約 −25dB（`bgm.gain_db`）。ナレーション中はさらに約6dB自動で下がり、話していない間に戻ります
- `--bgm ファイル.mp3` でその回だけ別の曲、`--bgm none` でBGMなし。config の曲が無ければ `bgm/<format>/*.mp3` → `bgm/*.mp3` の順に探し、どれも無ければBGMなしで作ります
- 概要欄に「BGM: 曲名 / 作曲者（OpenTracks）」を自動で入れます（`bgm_credits`。キーはファイル名の先頭 `R1` など。OpenTracks ではクレジットは任意）。曲と同じ名前の `.txt` があればそちらを優先します

ほかの入手先（どちらも商用・収益化OK。利用規約は各サイトで確認してください）:

- **YouTube オーディオライブラリ**（YouTube Studio → オーディオライブラリ）: 「帰属表示は不要」の曲を選ぶのが楽です
- **DOVA-SYNDROME / OpenTracks**（https://dova-s.jp/ ・ https://opentracks.com/）: 落ち着いた「ピアノ」「ヒーリング」の曲が睡眠用に向きます

## 画面テンプレート

`design/templates/{scene,title,thumbnail}.html` を Playwright で描画してスクショします（`window.SCENE` / `window.THUMB` を読み込み前に差し込み、`?data=` でも渡す。`document.body.dataset.ready==="1"` を待つ）。
デザインのテンプレートが無いときは `pipeline/fallback_templates/` の仮テンプレートを使います。
画面下部18%（194px）は字幕用です。

## 動画の作り

- 1ネタ＝1シーン（冒頭はタイトル画面、最後はエンディング画面）
- regular（テンポ重視）: 話速 1.12、文の間 0.05秒・パートの間 0.2秒・ネタ間 0.25秒。ネタの頭で見出しを約0.3秒で出し（見出しだけ隠した画像を撮って重ね、フェードで消す）、ズームは 1.00⇔1.09、切り替えは0.12秒の短いフェード。字幕は焼き込み（下部18%）、30fps
- sleep: 静止画＋ゆっくりフェード、ネタ間 3秒、字幕は SRT のみ、24fps、ナレーションは少し小さめ（-20LUFS、regular は -16LUFS に自動調整）

## キャッシュ

`pipeline/.cache/` に、音声（文・話者・パラメータのハッシュ）、画像（テンプレートと design 一式・データのハッシュ）、シーンごとの映像クリップを保存します。台本の一部だけ直した場合、変わったところだけ作り直します。容量が気になったら消してかまいません。

## オプション一覧

```
python3 pipeline/make_video.py SCRIPT.json
  --tts voicevox|dummy      既定 voicevox
  --voicevox-url URL        既定 http://localhost:50021
  --speaker 名前 --style スタイル名
  --bgm FILE|none
  --out-dir DIR             既定 output/
  --max-items N             試し用: 先頭Nネタだけ
  --fallback-templates      仮テンプレートで作る（確認用）
  --jobs N                  映像の並列エンコード数
```

## ファイル

| パス | 役割 |
|---|---|
| `make_video.py` | 本体 |
| `config.json` | 既定値（声・間・演出・BGM・BGMクレジット） |
| `tts.py` | VOICEVOX クライアント（/speakers → /audio_query → /synthesis）と dummy |
| `render.js` | テンプレートのスクショ（Playwright） |
| `make_sleep_compilation.py` | 睡眠用まとめ台本の作成 |
| `setup_voicevox.sh` | Linux 用 Engine 導入スクリプト |
| `fallback_templates/` | デザイン未着時の仮テンプレート |
| `samples/sample_ep.json` | テスト用台本（3ネタ） |
| `bgm/` | BGM置き場 |
