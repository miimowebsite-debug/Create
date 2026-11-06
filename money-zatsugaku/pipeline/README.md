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
| regular | 青山龍星 | ノーマル | 13 | 1.0 | 0.85（控えめ） |
| sleep | 青山龍星 | しっとり | 84 | 0.88 | 0.7 |

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

`pipeline/bgm/` に mp3 を置くと自動でループ再生します（無ければBGMなしで作ります）。

- 音量は約 −25dB。ナレーション中はさらに数dB（約6dB）自動で下がり、話していない間に戻ります
- `pipeline/bgm/regular/`・`pipeline/bgm/sleep/` を作ると format ごとに使い分けます。複数あるときは台本IDごとに1曲を選びます
- `--bgm ファイル.mp3` で指定、`--bgm none` でBGMなし
- 曲名と同じ名前の `.txt`（例: `calm.mp3` → `calm.txt`）にクレジットを書いておくと、概要欄に「BGM: …」として入ります

入手先（どちらも商用・収益化OK。利用規約は各サイトで確認してください）:

- **YouTube オーディオライブラリ**（YouTube Studio → オーディオライブラリ）: 「帰属表示は不要」の曲を選ぶのが楽です
- **DOVA-SYNDROME**（https://dova-s.jp/）: 落ち着いた「ピアノ」「ヒーリング」「Lo-Fi」の曲が睡眠用に向きます。クレジット表記は任意ですが、書く場合は `.txt` に「曲名 by 作者名 (DOVA-SYNDROME)」

## 画面テンプレート

`design/templates/{scene,title,thumbnail}.html` を Playwright で描画してスクショします（`window.SCENE` / `window.THUMB` を読み込み前に差し込み、`?data=` でも渡す。`document.body.dataset.ready==="1"` を待つ）。
デザインのテンプレートが無いときは `pipeline/fallback_templates/` の仮テンプレートを使います。
画面下部18%（194px）は字幕用です。

## 動画の作り

- 1ネタ＝1シーン（冒頭はタイトル画面、最後はエンディング画面）
- regular: ゆっくりズーム（1.00⇔1.06）＋短いフェード、ネタ間 0.6秒、字幕を焼き込み（下部18%）、30fps
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
| `tts.py` | VOICEVOX クライアント（/speakers → /audio_query → /synthesis）と dummy |
| `render.js` | テンプレートのスクショ（Playwright） |
| `make_sleep_compilation.py` | 睡眠用まとめ台本の作成 |
| `setup_voicevox.sh` | Linux 用 Engine 導入スクリプト |
| `fallback_templates/` | デザイン未着時の仮テンプレート |
| `samples/sample_ep.json` | テスト用台本（3ネタ） |
| `bgm/` | BGM置き場 |
