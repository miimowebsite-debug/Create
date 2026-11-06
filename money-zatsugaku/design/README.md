# design/ — 画面テンプレート（再生するだけでなぜか財布のお金が増えるチャンネル）

仕様の原本は `../CONTRACT.md`。このフォルダはその「2. 画面テンプレート」を担当します。

## フォルダ構成

```
design/
  tokens.json            色・フォント・文字サイズ・余白の原本（テーマ3案を含む）
  templates/
    scene.html           本編シーン 1920x1080（visual.type = icon / number / compare）
    title.html           タイトル画面 1920x1080
    thumbnail.html       サムネイル 1280x720
    shared/base.css      共通スタイル（背景・飾り罫・金文字・睡眠モード）
    shared/runtime.js    共通処理（データ読込・テーマ適用・文字の自動縮小・data-ready）
  assets/
    tokens.js            tokens.json から生成（テンプレートはこちらを読む）
    fonts/               Noto Serif JP / Zen Old Mincho / Noto Sans JP（woff2）
    icons/lucide-icons.js  Lucide 全アイコン（線画）
    LICENSES.md          ライセンス一覧
  tools/
    copy-assets.js       npm からフォント・アイコンの必要分だけコピー
    build-tokens.js      tokens.json -> assets/tokens.js
  preview/
    render.js            プレビューPNG書き出し＋崩れチェック
    index.html           全テーマを並べた比較ページ（ブラウザで開く）
    out/<theme>/*.png    書き出した画像
```

外部 CDN は一切使っていません。`file://` で開いても、ローカルサーバー経由でも動きます（fetch を使わず `<script>` で読み込むため）。

## パイプラインからの使い方

### データの渡し方（どちらでも可）

1. `window.SCENE` を差し込む（サムネは `window.THUMB`）
   ```js
   await page.addInitScript(`window.SCENE = ${JSON.stringify(scene)}`);
   await page.goto('file:///…/design/templates/scene.html');
   ```
   HTML に `<script>window.SCENE=…</script>` を直接挿入しても OK（DOMContentLoaded 後に読みます）。
2. `?data=<URLエンコードしたJSON>`
   ```js
   await page.goto(`file:///…/scene.html?data=${encodeURIComponent(JSON.stringify(scene))}`);
   ```
   両方ある場合は `?data=` が優先です。

### 描画完了の待ち方

```js
await page.waitForSelector('body[data-ready="1"]');
await page.screenshot({ path: 'out.png' });   // viewport は 1920x1080（サムネは 1280x720）
```
`data-ready` はフォント（使われている文字のサブセット）の読み込みと文字サイズの自動調整が終わってから付きます。
エラー時も止まらないよう `data-ready="1"` は付け、`body[data-error]` に内容を入れ、console.error を出します。

### 入力データ

| テンプレート | 受け取る値 |
|---|---|
| scene.html | `{mode:"regular|sleep", heading, visual:{type, icon, number, compare:{left,right}, caption}, index:"01", total:"10", channel}` |
| title.html | `{mode, title, sub}`（任意で `channel`、`icon`。channel 省略時はチャンネル名を表示、`""` で非表示） |
| thumbnail.html | `{main, sub, icon}`。`main` に `\n` を入れると好きな位置で改行できます |

- `visual.type` を省略した場合は、`number` があれば number、`compare` があれば compare、それ以外は icon として描画します。
- `icon` は Lucide の名前（`coins`, `landmark`, `piggy-bank` など。`PiggyBank` 表記も可）。存在しない名前は `coins` で代替し、console に警告を出します。アイコン一覧: https://lucide.dev/icons
- `number` は数字部分を大きく、「約」「円」「万」などの単位を小さく自動で組みます（例: `1億2000万円`）。

### テーマ・フォントの切り替え

| 指定方法 | 例 | 優先順 |
|---|---|---|
| URL | `scene.html?theme=black&font=zen` | 1（最優先） |
| データ | `window.SCENE = {theme:"green", font:"noto", …}` | 2 |
| tokens.json | `"defaultTheme": "navy"`, `"defaultFont": "noto"` | 3 |

採用テーマが決まったら `tokens.json` の `defaultTheme` を変えて `node design/tools/build-tokens.js` を実行すれば、パイプライン側は何も変えずに全画面が切り替わります。

`?guides=1` を付けると字幕用エリア（下部 18% = 195px）が赤く表示されます（確認用）。

## プレビューの作り方

```bash
node design/preview/render.js            # 全テーマ → design/preview/out/<theme>/
node design/preview/render.js black      # テーマ1つだけ
FONT=zen node design/preview/render.js   # 見出しを Zen Old Mincho で → out/<theme>-zen/
GUIDES=1 node design/preview/render.js   # 字幕エリアを可視化
```
書き出し時に、文字のはみ出し・要素の重なり・字幕エリアへの侵入を自動チェックし、問題があれば `PROBLEMS:` として表示します。
`window.SCENE` 方式と `?data=` 方式の両方で描画しています。見比べは `design/preview/index.html` をブラウザで開いてください。

## デザイン意図

**「知的・上品・お金持ち」＝ 静けさと余白。** 派手さではなく、高級ホテルのラウンジや老舗銀行の案内板のような落ち着きを狙いました。

- **色**: 深い地色（濃紺・黒・深緑）に、金は「線」と「主役の1要素」にだけ使う。文字の基本はアイボリー（純白より柔らかく、目に優しい）。金はグラデーションで金属らしさを出すのは大きな数字・サムネだけに限定。
- **書体**: 見出しは明朝（Noto Serif JP。代替として筆の味が強い Zen Old Mincho も用意）。キャプションはゴシック（Noto Sans JP）で、明朝との対比で読みやすく。和文はプロポーショナル詰め（palt）で締まった印象に。
- **アイコン**: Lucide の線画を細め（線幅 1.25）で金色に。二重の細い円に収めて「メダル／刻印」のように見せ、いらすとや的な親しみやすさではなく格式を出す。
- **余白**: 左右 160px 以上、要素は「見出し → 飾り罫 → ビジュアル → キャプション」の縦一列に絞り、1画面1メッセージ。装飾は四隅の細いコーナー罫とひし形の飾り罫だけ。
- **字幕エリア**: 下部 195px（18%）には何も置かない。背景のみが続くので、どんな字幕デザインを重ねても干渉しません。
- **長い文字への対応**: 見出しは 18 字でも 1 行に収まるよう設計（84px）。それを超えると自動で縮小 → それでも収まらなければ 2 行に。改行位置は文節単位（`word-break: auto-phrase`）。比較カードの左右は同じ文字サイズにそろえます。
- **睡眠モード (`mode:"sleep"`)**: 地色をさらに暗く、金とアイボリーの明度・彩度を落としてコントラストを下げ、文字は約 86% に縮小、見出しは細め（500）に。光彩・金グラデーション・影は使いません。1時間見続けても眩しくない画面を目指しました。
- **サムネイル**: 小さく表示されても読めるよう、メイン文字は太い明朝（900）＋金グラデーション＋影。右にアイコンのメダル。YouTube の再生時間表示が重なる右下には何も置いていません。

## カラー案（tokens.json の themes）

| テーマ | 印象 | 向いている場面 |
|---|---|---|
| `navy` 濃紺×金 | 銀行・証券会社のような信頼感。3案の中で最も「知的」。金との補色関係で金が一番映える | 標準のおすすめ。通常回・睡眠回どちらにも |
| `black` 黒×金 | 高級ブランド・ラグジュアリー感が最も強い。コントラストが高く、サムネで目立つ | サムネ重視、「富裕層」を前面に出す回 |
| `green` 深緑×金 | 英国紳士のクラブ・書斎・紙幣を思わせる落ち着き。他チャンネルと被りにくい | 差別化したい場合、睡眠用の穏やかさ重視 |

## アセットの更新

```bash
mkdir /tmp/dl && cd /tmp/dl && npm init -y && npm i @fontsource/noto-serif-jp @fontsource/zen-old-mincho @fontsource/noto-sans-jp lucide-static
node design/tools/copy-assets.js /tmp/dl/node_modules
```
使うウェイトは `tools/copy-assets.js` の `FONTS` で指定しています（増やした場合は `tokens.json` の `fonts.files` にも追記）。
