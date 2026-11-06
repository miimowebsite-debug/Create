#!/usr/bin/env node
// チャンネルアイコン 4案を生成する（SVG を直接書き、Playwright で PNG に書き出す）
//   node design/icon/build.js
// 出力: design/icon/icon-{a,b,c,d}.svg / .png(800) / preview/icon-*-{98,48}.png / compare.png
//
// 「富」の字形は design/assets のフォント(woff2)からアウトライン化して SVG に埋め込む
// （SVG 単体でもフォント無しで同じ見た目になるように）。抽出には fontkit が必要だが、
// 一度抽出した結果は glyph-cache.json に保存するので、以降は fontkit なしで動く。
//   FONTKIT=/path/to/node_modules/fontkit node design/icon/build.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { chromium } = require('playwright');
// about:blank からは file:// を読めないので、一時HTMLに書いて goto する
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zicon-'));
let seq = 0;
async function show(page, html) {
  const f = path.join(TMP, `p${seq++}.html`);
  fs.writeFileSync(f, '<!doctype html><meta charset="utf-8">' + html);
  await page.goto('file://' + f);
}

const DIR = __dirname;
const ASSETS = path.resolve(DIR, '..', 'assets');
const S = 800, C = 400;

// ---- 色（navy 確定。アイコンなのでテンプレートより華やかに） ----
const NAVY = { center: '#1E3A70', mid: '#0F2147', edge: '#060E22' };
const defs = `
  <radialGradient id="bg" cx="50%" cy="46%" r="62%">
    <stop offset="0" stop-color="${NAVY.center}"/><stop offset=".55" stop-color="${NAVY.mid}"/><stop offset="1" stop-color="${NAVY.edge}"/>
  </radialGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0" stop-color="#FFF4C8"/><stop offset=".28" stop-color="#F2CF72"/>
    <stop offset=".55" stop-color="#D6A23E"/><stop offset=".78" stop-color="#F5D98A"/><stop offset="1" stop-color="#A9761F"/>
  </linearGradient>
  <linearGradient id="goldFlat" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#F6DC92"/><stop offset="1" stop-color="#C9963A"/>
  </linearGradient>
  <radialGradient id="halo" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#FFE7A0" stop-opacity=".55"/><stop offset=".45" stop-color="#E9B64F" stop-opacity=".18"/>
    <stop offset="1" stop-color="#E9B64F" stop-opacity="0"/>
  </radialGradient>
  <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity=".45"/>
  </filter>`;
const DARK = '#7A5418'; // 金の上に置く彫り線

const svg = (body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">
<title>${title}</title>
<defs>${defs}</defs>
<rect width="${S}" height="${S}" fill="url(#bg)"/>
${body}
</svg>
`;

const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
const f = (n) => Math.round(n * 10) / 10;
const poly = (pts) => pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ');

// n 芒星（外半径 ro、内半径 ri）
function star(n, ro, ri, rot = 0, cx = C, cy = C) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro, a = (rot + i * 180 / n - 90) * Math.PI / 180;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return poly(pts);
}
// きらめき（4芒の細い星）
const sparkle = (x, y, r) => `<polygon points="${star(4, r, r * 0.22, 0, x, y)}" fill="#FFF0B8"/>`;

// 外周の二重リング（主要素は直径80% = 半径320 以内）
const rings = (r = 300, w = 16) => `
  <circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="url(#gold)" stroke-width="${w}"/>
  <circle cx="${C}" cy="${C}" r="${r - w - 10}" fill="none" stroke="url(#goldFlat)" stroke-width="5" opacity=".85"/>`;

// ---- A: 日輪と小判 ----
function iconA() {
  let rays = '';
  for (let i = 0; i < 16; i++) {
    const deg = i * 22.5, long = i % 2 === 0, ro = long ? 300 : 248, w = long ? 13 : 10;
    rays += `<polygon points="${poly([pt(150, deg - w), pt(ro, deg), pt(150, deg + w)])}" fill="url(#goldFlat)" opacity="${long ? 1 : .8}"/>`;
  }
  // 小判: 縦長の楕円。横筋（ござ目）は太めに少数
  let ridges = '';
  for (let y = -96; y <= 96; y += 32) {
    const half = 92 * Math.sqrt(1 - (y / 142) ** 2);
    ridges += `<line x1="${f(C - half + 14)}" y1="${C + y}" x2="${f(C + half - 14)}" y2="${C + y}" stroke="${DARK}" stroke-width="6" stroke-linecap="round" opacity=".55"/>`;
  }
  return svg(`
  <circle cx="${C}" cy="${C}" r="300" fill="url(#halo)"/>
  <g filter="url(#glow)">${rays}</g>
  <g filter="url(#shadow)">
    <ellipse cx="${C}" cy="${C}" rx="128" ry="178" fill="url(#gold)" stroke="#B8842A" stroke-width="6"/>
    <ellipse cx="${C}" cy="${C}" rx="106" ry="156" fill="none" stroke="${DARK}" stroke-width="7" opacity=".75"/>
    ${ridges}
    <rect x="${C - 30}" y="${C - 46}" width="60" height="92" rx="10" fill="url(#goldFlat)" stroke="${DARK}" stroke-width="6"/>
    <ellipse cx="${C - 40}" cy="${C - 110}" rx="22" ry="42" fill="#FFF8DC" opacity=".35" transform="rotate(20 ${C - 40} ${C - 110})"/>
  </g>
  ${sparkle(C + 215, C - 205, 34)}${sparkle(C - 225, C + 190, 24)}`, 'A 日輪と小判');
}

// ---- B: 八芒星と円環 ----
function iconB() {
  return svg(`
  <circle cx="${C}" cy="${C}" r="280" fill="url(#halo)"/>
  ${rings(300, 16)}
  <g filter="url(#glow)">
    <polygon points="${star(8, 236, 104, 0)}" fill="url(#gold)" stroke="#B8842A" stroke-width="4" stroke-linejoin="round"/>
  </g>
  <circle cx="${C}" cy="${C}" r="62" fill="${NAVY.mid}" stroke="url(#gold)" stroke-width="10"/>
  <circle cx="${C}" cy="${C}" r="30" fill="url(#gold)"/>
  ${[22.5, 112.5, 202.5, 292.5].map((d) => { const [x, y] = pt(222, d); return sparkle(x, y, 26); }).join('')}`, 'B 八芒星と円環');
}

// ---- C: 「富」一文字（文字入り） ----
function iconC(glyph) {
  const { d, bbox, upm } = glyph;
  const size = 370; // 文字の高さ(px)の目安
  const s = size / upm;
  const gw = (bbox.maxX - bbox.minX) * s, gh = (bbox.maxY - bbox.minY) * s;
  const tx = C - gw / 2 - bbox.minX * s, ty = C + gh / 2 + bbox.minY * s + 6;
  let dots = '';
  for (let i = 0; i < 8; i++) { const [x, y] = pt(300, i * 45); dots += `<polygon points="${star(4, 22, 9, 0, x, y)}" fill="url(#goldFlat)" stroke="${NAVY.mid}" stroke-width="3"/>`; }
  return svg(`
  <circle cx="${C}" cy="${C}" r="270" fill="url(#halo)"/>
  ${rings(300, 16)}${dots}
  <g filter="url(#shadow)">
    <path d="${d}" transform="translate(${f(tx)} ${f(ty)}) scale(${s} ${-s})" fill="url(#gold)" stroke="#8A5F1C" stroke-width="${f(10 / s)}" paint-order="stroke"/>
  </g>`, 'C 富');
}

// ---- D: ご縁銭と稲穂 ----
function iconD() {
  // 稲穂: 円弧に沿って米粒を並べる（左右対称）
  function ear(side) {
    let g = '';
    const R = 238;
    const a0 = 200, a1 = 335; // 下 → 上（度、時計回り基準 0=上）
    const stalk = [];
    for (let a = a0; a <= a1; a += 5) stalk.push(pt(R, a));
    g += `<polyline points="${poly(stalk)}" fill="none" stroke="url(#goldFlat)" stroke-width="10" stroke-linecap="round"/>`;
    for (let i = 0, a = a0 + 30; a <= a1 + 4; a += 12, i++) {
      const t = (a - a0) / (a1 - a0);
      const ry = 30 - t * 8, rx = 13 - t * 3;
      for (const off of [-1, 1]) {
        const [x, y] = pt(R + off * 22, a + off * 1.5);
        const rot = a + off * 28;
        g += `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})" fill="url(#gold)" stroke="#A8761E" stroke-width="2"/>`;
      }
    }
    const [tx, ty] = pt(R, a1 + 9);
    g += `<ellipse cx="${f(tx)}" cy="${f(ty)}" rx="11" ry="24" transform="rotate(${a1 + 9} ${f(tx)} ${f(ty)})" fill="url(#gold)" stroke="#A8761E" stroke-width="2"/>`;
    return side < 0 ? g : `<g transform="translate(${S} 0) scale(-1 1)">${g}</g>`;
  }
  return svg(`
  <circle cx="${C}" cy="${C}" r="260" fill="url(#halo)"/>
  <g filter="url(#shadow)">${ear(-1)}${ear(1)}</g>
  <g filter="url(#shadow)">
    <circle cx="${C}" cy="${C - 6}" r="158" fill="url(#gold)" stroke="#B8842A" stroke-width="6"/>
    <circle cx="${C}" cy="${C - 6}" r="132" fill="none" stroke="${DARK}" stroke-width="7" opacity=".7"/>
    <rect x="${C - 40}" y="${C - 46}" width="80" height="80" rx="4" fill="${NAVY.mid}" stroke="${DARK}" stroke-width="8"/>
    <ellipse cx="${C - 70}" cy="${C - 90}" rx="40" ry="20" fill="#FFF8DC" opacity=".3" transform="rotate(-35 ${C - 70} ${C - 90})"/>
  </g>
  ${sparkle(C, C - 240, 36)}${sparkle(C - 120, C - 222, 16)}${sparkle(C + 120, C - 222, 16)}`, 'D ご縁銭と稲穂');
}

async function loadGlyph() {
  const cache = path.join(DIR, 'glyph-cache.json');
  const fontFile = path.join(ASSETS, 'fonts/noto-serif-jp/files/noto-serif-jp-107-900-normal.woff2');
  try {
    const fontkit = require(process.env.FONTKIT || 'fontkit');
    const font = fontkit.openSync(fontFile);
    const g = font.glyphForCodePoint(0x5BCC); // 富
    const out = { char: '富', source: path.relative(path.resolve(DIR, '..'), fontFile), upm: font.unitsPerEm, d: g.path.toSVG(), bbox: g.bbox };
    out.bbox = { minX: g.bbox.minX, minY: g.bbox.minY, maxX: g.bbox.maxX, maxY: g.bbox.maxY };
    fs.writeFileSync(cache, JSON.stringify(out));
    return out;
  } catch (e) {
    if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
    throw new Error('fontkit が見つからず glyph-cache.json もありません: ' + e.message);
  }
}

(async () => {
  const glyph = await loadGlyph();
  const icons = { a: iconA(), b: iconB(), c: iconC(glyph), d: iconD() };
  const PREV = path.join(DIR, 'preview');
  fs.mkdirSync(PREV, { recursive: true });
  for (const [k, s] of Object.entries(icons)) fs.writeFileSync(path.join(DIR, `icon-${k}.svg`), s);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: S, height: S } });
  const fileUrl = (k) => 'file://' + path.join(DIR, `icon-${k}.svg`);
  for (const k of Object.keys(icons)) {
    await show(page, `<style>*{margin:0}</style><img id="i" src="${fileUrl(k)}" width="800" height="800">`);
    await page.waitForFunction(() => document.getElementById('i').complete);
    await page.locator('#i').screenshot({ path: path.join(DIR, `icon-${k}.png`) });
  }
  // 縮小プレビュー: YouTube と同じく円形に切り抜き、明・暗の背景に置く
  const pngUrl = (k) => 'file://' + path.join(DIR, `icon-${k}.png`);
  for (const k of Object.keys(icons)) {
    for (const px of [98, 48]) {
      await page.setViewportSize({ width: px * 2 + 24, height: px + 16 });
      await show(page, `<style>*{margin:0}body{display:flex}div{padding:8px 4px;}div:first-child{background:#fff}div:last-child{background:#0f0f0f}
        img{display:block;border-radius:50%}</style><div><img src="${pngUrl(k)}" width="${px}" height="${px}"></div><div><img src="${pngUrl(k)}" width="${px}" height="${px}"></div>`);
      await page.waitForFunction(() => [...document.images].every((i) => i.complete));
      await page.screenshot({ path: path.join(PREV, `icon-${k}-${px}.png`) });
    }
  }
  // 比較画像: 各案の実寸(800, 円形)と 98px / 48px
  const names = { a: 'A 日輪と小判', b: 'B 八芒星と円環', c: 'C 「富」一文字', d: 'D ご縁銭と稲穂' };
  const fontCss = 'file://' + path.join(ASSETS, 'fonts/fonts.css');
  const cols = Object.keys(icons).map((k) => `<section><h2>${names[k]}</h2>
    <img class="big" src="${pngUrl(k)}" width="800" height="800">
    <div class="small"><img src="${pngUrl(k)}" width="98" height="98"><img src="${pngUrl(k)}" width="48" height="48">
      <span>98px / 48px（実寸）</span></div>
    <div class="small light"><img src="${pngUrl(k)}" width="98" height="98"><img src="${pngUrl(k)}" width="48" height="48"><span>白背景</span></div></section>`).join('');
  const W = 4 * 800 + 5 * 60, H = 1260;
  await page.setViewportSize({ width: W, height: H });
  await show(page, `<link rel="stylesheet" href="${fontCss}"><style>*{margin:0;box-sizing:border-box}
    body{background:#0f0f0f;color:#ddd;font-family:"Noto Sans JP";display:flex;gap:60px;padding:40px 60px}
    h2{font:700 44px "Noto Serif JP";color:#E8C871;margin-bottom:24px}
    img{display:block;border-radius:50%}.small{display:flex;align-items:center;gap:28px;margin-top:28px;padding:14px 20px;border-radius:12px}
    .small span{font-size:24px;color:#999}.light{background:#fff;margin-top:14px}.light span{color:#666}</style>${cols}`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete) && document.fonts.status === 'loaded');
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(DIR, 'compare.png') });
  await browser.close();
  console.log('done:', Object.keys(icons).map((k) => `icon-${k}`).join(', '), '+ compare.png');
})();
