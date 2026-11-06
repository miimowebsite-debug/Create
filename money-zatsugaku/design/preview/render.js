#!/usr/bin/env node
// プレビュー書き出し: 各テンプレート × 各テーマ のPNGを design/preview/out/<theme>/ に出力する。
//   node design/preview/render.js            # 全テーマ
//   node design/preview/render.js navy       # テーマ指定
//   GUIDES=1 node design/preview/render.js   # 字幕エリアを赤で表示
//   FONT=zen node design/preview/render.js   # 見出しを Zen Old Mincho に
// window.SCENE 差し込み方式と ?data= 方式の両方を使って描画を確認する。
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const DESIGN = path.resolve(__dirname, '..');
const TPL = path.join(DESIGN, 'templates');
const OUT = path.join(__dirname, 'out');
execFileSync(process.execPath, [path.join(DESIGN, 'tools', 'build-tokens.js')], { stdio: 'inherit' });
const tokens = JSON.parse(fs.readFileSync(path.join(DESIGN, 'tokens.json'), 'utf8'));
const themes = process.argv[2] ? [process.argv[2]] : Object.keys(tokens.themes);
const extra = (process.env.GUIDES === '1' ? '&guides=1' : '') + (process.env.FONT ? `&font=${process.env.FONT}` : '');

const CH = '再生するだけでなぜか財布のお金が増えるチャンネル';
// 見出しはすべて上限の18字で試す
const scenes = {
  icon: { heading: '銀行の大金庫はなぜ地下深くにあるのか', index: '03', total: '10', channel: CH,
          visual: { type: 'icon', icon: 'landmark', caption: '地震や火事よりも怖いのは、実は「水」' } },
  number: { heading: '一万円札を一枚つくるのにかかる費用は', index: '07', total: '10', channel: CH,
            visual: { type: 'number', number: '約20円', caption: '原価は額面のわずか0.2%ほど' } },
  compare: { heading: 'お金持ちと普通の人で違う財布の使い方', index: '10', total: '10', channel: CH,
             visual: { type: 'compare', compare: { left: 'レシートでパンパン', right: 'お札の向きまで揃える' },
                       caption: '財布は「お金の家」と考えるのが共通点' } },
};
const title = { title: '知るだけで得する「お金持ちの習慣」雑学10選', sub: '聞き流すだけで、お金の見え方が変わる' };
const thumb = { main: 'お金持ちの財布', sub: '9割の人が知らない「お札の向き」', icon: 'wallet' };

const jobs = [];
for (const theme of themes) {
  for (const [type, data] of Object.entries(scenes)) {
    for (const mode of ['regular', 'sleep']) {
      jobs.push({ theme, file: 'scene.html', name: `scene-${type}-${mode}`, data: { ...data, mode }, via: mode === 'regular' ? 'global' : 'query', size: [1920, 1080] });
    }
  }
  for (const mode of ['regular', 'sleep']) jobs.push({ theme, file: 'title.html', name: `title-${mode}`, data: { ...title, mode }, via: 'query', size: [1920, 1080] });
  jobs.push({ theme, file: 'thumbnail.html', name: 'thumbnail', data: thumb, via: 'global', global: 'THUMB', size: [1280, 720] });
}
// 追加の崩れチェック（navy のみ）: 長い数字・長い比較・長いサムネ
const stress = [
  { file: 'scene.html', name: 'stress-number-long', data: { heading: '日本で一番高い宝くじの一等賞金はいくら', index: '99', total: '99', channel: CH, visual: { type: 'number', number: '1億2000万円', caption: '二十五文字ちょうどのキャプションを入れて確かめる' } } },
  { file: 'scene.html', name: 'stress-compare-long', data: { heading: '短い見出し', channel: CH, index: '1', total: '3', visual: { type: 'compare', compare: { left: '毎月の給料をすぐに全部使い切ってしまう人', right: '先に貯金してから残りでやりくりする人' }, caption: '' } } },
  { file: 'scene.html', name: 'stress-icon-unknown', data: { heading: 'アイコン名が間違っていても大丈夫か確認', channel: CH, visual: { type: 'icon', icon: 'not-a-real-icon', caption: '不明なアイコンは coins で代替' } } },
  { file: 'title.html', name: 'stress-title-long', data: { title: '本当のお金持ちは絶対にやらない、普通の人がついやってしまうお金の使い方とその理由', sub: 'サブタイトルも少し長めにして崩れないか確認しておく' } },
  { file: 'thumbnail.html', name: 'stress-thumb-10', global: 'THUMB', data: { main: '年収一億円の朝習慣', sub: '二十文字ちょうどのサブ文字を入れてみる確認', icon: 'crown' } },
  { file: 'thumbnail.html', name: 'stress-thumb-break', global: 'THUMB', data: { main: '金庫は\n地下にある', sub: '改行指定のテスト', icon: 'vault' } },
];
for (const s of stress) jobs.push({ theme: 'navy', via: s.global ? 'global' : 'query', size: s.file === 'thumbnail.html' ? [1280, 720] : [1920, 1080], ...s });

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const j of jobs) {
    const page = await browser.newPage({ viewport: { width: j.size[0], height: j.size[1] } });
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`${j.theme}/${j.name}: console ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`${j.theme}/${j.name}: ${e.message}`));
    let url = 'file://' + path.join(TPL, j.file) + `?theme=${j.theme}${extra}`;
    if (j.via === 'global') {
      await page.addInitScript(`window.${j.global || 'SCENE'} = ${JSON.stringify(j.data)};`);
    } else {
      url += '&data=' + encodeURIComponent(JSON.stringify(j.data));
    }
    await page.goto(url);
    await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 });
    // はみ出し・重なりの自動チェック
    const issues = await page.evaluate(() => {
      const out = [];
      const W = innerWidth, H = innerHeight, subTop = H * 0.82;
      const isScene = W === 1920;
      document.querySelectorAll('h1, .caption, .number, .label, .sub, .main, .channel, .index').forEach((el) => {
        if (!el.textContent.trim() || getComputedStyle(el).display === 'none') return;
        const r = el.getBoundingClientRect();
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') out.push(`${el.className || el.tagName} overflows its box (${el.scrollWidth}>${el.clientWidth})`);
        if (r.left < 0 || r.right > W || r.top < 0 || r.bottom > H) out.push(`${el.className || el.tagName} outside canvas`);
        if (isScene && r.bottom > subTop) out.push(`${el.className || el.tagName} enters subtitle area (${Math.round(r.bottom)} > ${Math.round(subTop)})`);
        const p = el.parentElement.getBoundingClientRect();
        if (r.right > p.right + 1 || r.left < p.left - 1 || r.bottom > p.bottom + 1) out.push(`${el.className || el.tagName} exceeds parent`);
      });
      // 主要ブロック同士の重なり
      const blocks = [...document.querySelectorAll('.heading-box, .ornament, .visual > *, .caption-box, .top, .title-box, .sub-box, .channel, .emblem, .medal, .text')]
        .filter((e) => e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden');
      for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) {
        if (blocks[a].contains(blocks[b]) || blocks[b].contains(blocks[a])) continue;
        const x = blocks[a].getBoundingClientRect(), y = blocks[b].getBoundingClientRect();
        if (x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1)
          out.push(`overlap: ${blocks[a].className} / ${blocks[b].className}`);
      }
      if (document.body.dataset.error) out.push('render error: ' + document.body.dataset.error);
      const sizes = [...document.querySelectorAll('[data-fit-size]')].map((e) => `${e.id || e.className}=${e.dataset.fitSize}`).join(' ');
      return { out, sizes };
    });
    const dir = path.join(OUT, j.theme + (process.env.FONT ? '-' + process.env.FONT : ''));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${j.name}.png`);
    await page.screenshot({ path: file });
    console.log(`${path.relative(DESIGN, file)}  [${issues.sizes}]`);
    issues.out.forEach((o) => problems.push(`${j.theme}/${j.name}: ${o}`));
    await page.close();
  }
  await browser.close();
  writeGallery();
  if (problems.length) { console.log('\nPROBLEMS:\n' + problems.join('\n')); process.exitCode = 1; }
  else console.log('\nOK: はみ出し・重なり・字幕エリア侵入なし');
})();

// オーナーが見比べるための一覧ページ（design/preview/index.html）
function writeGallery() {
  const names = [...new Set(jobs.filter((j) => !j.name.startsWith('stress')).map((j) => j.name))];
  const all = Object.keys(tokens.themes);
  let rows = names.map((n) => `<tr><th>${n}</th>${all.map((t) => `<td><a href="out/${t}/${n}.png"><img src="out/${t}/${n}.png" loading="lazy"></a></td>`).join('')}</tr>`).join('\n');
  const stressImgs = stress.map((s) => `<figure><a href="out/navy/${s.name}.png"><img src="out/navy/${s.name}.png"></a><figcaption>${s.name}</figcaption></figure>`).join('');
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>デザイン案プレビュー</title>
<style>body{background:#111;color:#ddd;font:14px sans-serif;margin:24px}table{border-collapse:collapse}th{text-align:left;padding:8px;color:#cdaa5c;white-space:nowrap}
td{padding:6px}img{width:420px;display:block;border:1px solid #333}thead th{font-size:16px}figure{display:inline-block;margin:6px}figcaption{color:#999}</style>
<h1>再生するだけでなぜか財布のお金が増えるチャンネル — デザイン案</h1>
<table><thead><tr><th></th>${all.map((t) => `<th>${t}<br><small>${tokens.themes[t].label}</small></th>`).join('')}</tr></thead>
${rows}</table><h2>崩れチェック（navy）</h2>${stressImgs}</html>`;
  fs.writeFileSync(path.join(__dirname, 'index.html'), html);
}
