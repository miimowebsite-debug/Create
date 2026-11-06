# 受け渡し仕様（3チーム共通）

## 1. 台本JSON  content/scripts/epXXX.json  （台本チーム → パイプライン）
{
  "id": "ep001",
  "format": "regular",              // regular(〜10分) | sleep(1時間)
  "title": "YouTubeタイトル",
  "thumbnail": {"main": "メイン文字(10字以内)", "sub": "サブ文字(20字以内)"},
  "description": "概要欄",
  "tags": ["..."],
  "intro": {"text": "読み上げ文"},
  "items": [
    {
      "id": "01",
      "heading": "画面見出し(18字以内)",
      "hook": "読み上げ: 問いかけ",
      "body": "読み上げ: 本文",
      "rich_point": "読み上げ: お金持ち視点の一言",
      "visual": {
        "type": "icon | number | compare",
        "icon": "lucide のアイコン名 (例: coins, landmark, piggy-bank)",
        "number": "強調数字 (type=number時, 例: 約20円)",
        "compare": {"left": "A", "right": "B"},
        "caption": "画面に出す補足(25字以内)"
      },
      "sources": ["出典URL"]
    }
  ],
  "outro": {"text": "読み上げ文"}
}
読み上げ文は、VOICEVOXが誤読しやすい漢字・記号・英字をひらがな／カタカナに直しておく。

## 2. 画面テンプレート  design/templates/*.html  （デザインチーム → パイプライン）
- scene.html     1920x1080。window.SCENE = {mode:"regular|sleep", heading, visual:{...上と同じ}, index:"01", total:"10", channel:"チャンネル名"} を受け取り描画する
- title.html     1920x1080。window.SCENE = {mode, title, sub}
- thumbnail.html 1280x720。 window.THUMB = {main, sub, icon}
- 描画の約束: ページ読み込み前に、パイプラインが `<script>window.SCENE=...</script>` を差し込む（または ?data=<URLエンコードしたJSON> で渡す）。どちらでも動くようにする
- 描画が終わったら document.body.dataset.ready="1" を付ける（パイプラインはこれを待ってスクショする）
- 外部CDNは使わない。フォントやアイコンは design/assets/ にローカル保存する
- 配色などの値は design/tokens.json にも書き出す
