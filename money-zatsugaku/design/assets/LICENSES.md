# 同梱アセットのライセンス

すべて npm から取得し、`design/tools/copy-assets.js` で必要なファイルだけをコピーしています（2026-11-06 取得）。
動画・サムネイルへの利用（商用の YouTube 収益化を含む）はいずれも可能です。

| アセット | 配置先 | npm パッケージ | バージョン | ライセンス | 著作権者 |
|---|---|---|---|---|---|
| Noto Serif JP（500 / 700 / 900） | `fonts/noto-serif-jp/` | `@fontsource/noto-serif-jp` | 5.3.1 | SIL Open Font License 1.1 | Google Inc. |
| Zen Old Mincho（700 / 900） | `fonts/zen-old-mincho/` | `@fontsource/zen-old-mincho` | 5.3.1 | SIL Open Font License 1.1 | The Zen Old Mincho Project Authors |
| Noto Sans JP（400 / 500） | `fonts/noto-sans-jp/` | `@fontsource/noto-sans-jp` | 5.3.1 | SIL Open Font License 1.1 | Google Inc. |
| Lucide アイコン（全 2317 種） | `icons/lucide-icons.js` | `lucide-static` | 1.69.0 | ISC License | Lucide Icons and Contributors（一部 Feather: MIT, Cole Bemis） |

ライセンス全文は各フォルダの `LICENSE` にあります。

- `fonts/<family>/LICENSE` … OFL 1.1 全文
- `icons/LICENSE` … ISC（および Feather 由来部分の MIT）全文

## 注意点

- **OFL のフォント**: 動画やサムネイルに文字として焼き込む利用は自由です。フォントファイル自体を再配布する場合は LICENSE を同梱し、フォント単体での販売はしないこと。改変して再配布する場合は名前を変える必要があります（woff2 をサブセットのまま使うだけなら改変にあたりません）。
- **Lucide (ISC)**: 著作権表示とライセンス文を残せば、改変・商用利用とも自由です。`icons/lucide-icons.js` の先頭コメントと `icons/LICENSE` で表示しています。
- フォントは Fontsource 配布の woff2（Unicode 範囲ごとに分割されたサブセット）をそのまま使っています。woff 形式は不要なのでコピーしていません。
