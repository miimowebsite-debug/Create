// PNG・JSON の書き出し

import { pack } from './model.js';

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeName = (title) => (title.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim() || 'mindmap').slice(0, 60);

export function exportJSON(root, title) {
  const data = { app: 'mindmap', version: 1, map: pack(root) };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${safeName(title)}.json`);
}

// 表示中のマップを SVG の foreignObject に写し、canvas で PNG にする
export async function exportPNG(mm, title) {
  const css = await (await fetch(new URL('./style.css', import.meta.url))).text();
  const { minX, minY, maxX, maxY } = mm.bounds;
  const pad = 48;
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);

  const clone = mm.world.cloneNode(true);
  clone.style.transform = `translate(${pad - minX}px, ${pad - minY}px)`;
  clone.querySelectorAll('.is-selected, .is-editing').forEach((el) => el.classList.remove('is-selected', 'is-editing'));
  clone.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));

  const html =
    `<div xmlns="http://www.w3.org/1999/xhtml" class="mm-export" style="width:${width}px;height:${height}px">` +
    `<style><![CDATA[${css}]]></style>` +
    new XMLSerializer().serializeToString(clone) +
    '</div>';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">${html}</foreignObject></svg>`;

  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();

  const ratio = Math.min(2, 16000 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(ratio, ratio);
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('png');
  download(blob, `${safeName(title)}.png`);
}
