// 画面の切り替え（一覧・編集・共有の閲覧）とツールバー

import { MindMap } from './mindmap.js';
import { createMap, countNodes, plainText, unpack } from './model.js';
import * as store from './storage.js';
import { encodeTree, decodeTree } from './share.js';
import { exportPNG, exportJSON } from './export.js';

const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

const svg = (d) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const icon = {
  back: svg('<path d="M15 18l-6-6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  child: svg('<rect x="3" y="9" width="7" height="6" rx="1.5"/><path d="M10 12h3m0 0v-5h3m-3 5v5h3"/><rect x="16" y="4" width="5" height="5" rx="1"/><rect x="16" y="15" width="5" height="5" rx="1"/>'),
  sibling: svg('<rect x="6" y="3" width="12" height="7" rx="1.5"/><rect x="6" y="14" width="12" height="7" rx="1.5"/><path d="M12 10v4"/>'),
  trash: svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  undo: svg('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>'),
  bold: svg('<path d="M7 5h6a3.5 3.5 0 010 7H7zM7 12h7a3.5 3.5 0 010 7H7z"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  share: svg('<path d="M10 14a4 4 0 005.6 0l3-3a4 4 0 00-5.6-5.6l-1 1"/><path d="M14 10a4 4 0 00-5.6 0l-3 3a4 4 0 005.6 5.6l1-1"/>'),
  more: svg('<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>'),
  image: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  file: svg('<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>'),
  upload: svg('<path d="M12 16V4m0 0l-4 4m4-4l4 4"/><path d="M4 16v4h16v-4"/>'),
  keyboard: svg('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 011-1h10"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const titleOf = (root) => plainText(root.text).replace(/\s+/g, ' ').trim() || '無題のマップ';

const app = document.getElementById('app');
let cleanup = null;

window.addEventListener('hashchange', route);
route();

function route() {
  cleanup?.();
  cleanup = null;
  document.querySelectorAll('.modal-back, .menu').forEach((el) => el.remove());
  app.replaceChildren();
  const hash = location.hash.slice(1) || '/';
  const m = hash.match(/^\/m\/([\w-]+)$/);
  if (m) return showEditor(m[1]);
  if (hash.startsWith('/v/')) return showViewer(hash.slice(3));
  showHome();
}

// ---------- 共通 ----------

function toast(message) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.classList.add('is-hiding'), 2200);
  setTimeout(() => el.remove(), 2600);
}

function openModal(title, body) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" data-close title="閉じる">${icon.close}</button>
      </div>
      <div class="modal-body">${body}</div>
    </div>`;
  const close = () => {
    back.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => e.key === 'Escape' && close();
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) close();
  });
  window.addEventListener('keydown', onKey, true);
  document.body.append(back);
  return { el: back, close };
}

function openMenu(anchor, items) {
  document.querySelector('.menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.innerHTML = items
    .map((it, i) => `<button class="menu-item" data-i="${i}">${it.icon}<span>${esc(it.label)}</span></button>`)
    .join('');
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
  const dismiss = (e) => {
    if (menu.contains(e.target)) return;
    menu.remove();
    document.removeEventListener('pointerdown', dismiss, true);
  };
  setTimeout(() => document.addEventListener('pointerdown', dismiss, true));
  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    menu.remove();
    document.removeEventListener('pointerdown', dismiss, true);
    items[btn.dataset.i].run();
  });
}

function zoomControls() {
  return `
    <div class="zoom">
      <button class="icon-btn" data-zoom="out" title="縮小（${MOD} −）">${icon.minus}</button>
      <button class="zoom-label" data-zoom="reset" title="100%に戻す">100%</button>
      <button class="icon-btn" data-zoom="in" title="拡大（${MOD} +）">${icon.plus}</button>
      <span class="zoom-sep"></span>
      <button class="icon-btn" data-zoom="fit" title="全体を表示（${MOD} 0）">${icon.fit}</button>
    </div>`;
}

function bindZoom(screen, mm) {
  const label = screen.querySelector('.zoom-label');
  mm.onViewChange = (view) => (label.textContent = `${Math.round(view.scale * 100)}%`);
  mm.onViewChange(mm.view);
  const zoom = screen.querySelector('.zoom');
  zoom.addEventListener('mousedown', (e) => e.preventDefault());
  zoom.addEventListener('click', (e) => {
    const action = e.target.closest('[data-zoom]')?.dataset.zoom;
    if (action === 'in') mm.zoomBy(1.2);
    if (action === 'out') mm.zoomBy(1 / 1.2);
    if (action === 'fit') mm.fit();
    if (action === 'reset') mm.zoomBy(1 / mm.view.scale);
  });
}

async function savePNG(mm) {
  try {
    await exportPNG(mm, titleOf(mm.root));
  } catch {
    toast('画像を書き出せませんでした');
  }
}

// ---------- 一覧 ----------

function showHome() {
  document.title = 'マインドマップ';
  const maps = store.listMaps();
  const card = (map) => {
    const branches = map.root.children.slice(0, 4);
    const date = new Date(map.updatedAt).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
    return `
      <a class="map-card" href="#/m/${esc(map.id)}">
        <div class="map-card-preview">
          <span class="pv-root"></span>
          <span class="pv-branches">${branches.map((_, i) => `<span class="pv-b pv-b${i}"></span>`).join('')}</span>
        </div>
        <div class="map-card-body">
          <div class="map-card-title">${esc(titleOf(map.root))}</div>
          <div class="map-card-meta">${esc(date)} · ${countNodes(map.root)}トピック</div>
        </div>
        <button class="icon-btn map-card-del" data-del="${esc(map.id)}" title="削除">${icon.trash}</button>
      </a>`;
  };
  app.innerHTML = `
    <div class="home">
      <header class="home-head">
        <div class="brand"><span class="brand-mark"></span>マインドマップ</div>
        <div class="home-actions">
          <button class="btn" data-act="import">${icon.upload}<span>JSONを読み込む</span></button>
          <button class="btn btn-primary" data-act="new">${icon.plus}<span>新規作成</span></button>
        </div>
      </header>
      <main class="home-main">
        ${
          maps.length
            ? `<div class="map-grid">${maps.map(card).join('')}</div>`
            : `<div class="empty">
                 <div class="empty-art"><span class="pv-root"></span><span class="pv-branches"><span class="pv-b pv-b0"></span><span class="pv-b pv-b1"></span><span class="pv-b pv-b2"></span><span class="pv-b pv-b3"></span></span></div>
                 <p>まだマップがありません</p>
                 <button class="btn btn-primary" data-act="new">${icon.plus}<span>最初のマップを作る</span></button>
               </div>`
        }
        <p class="home-note">マップはこのブラウザの中に保存されます。ブラウザのデータを消すと消えるので、大事なマップは「JSONで保存」でバックアップしてください。</p>
      </main>
      <input type="file" accept=".json,application/json" hidden data-file>
    </div>`;

  const fileInput = app.querySelector('[data-file]');
  app.querySelector('.home').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.preventDefault();
      const map = store.loadMap(del.dataset.del);
      if (map && confirm(`「${titleOf(map.root)}」を削除しますか？\nこの操作は元に戻せません。`)) {
        store.deleteMap(map.id);
        route();
      }
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new') {
      const map = createMap();
      store.saveMap(map);
      location.hash = `#/m/${map.id}`;
    }
    if (act === 'import') fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'mindmap' || !data.map) throw new Error('format');
      const map = createMap(unpack(data.map));
      store.saveMap(map);
      location.hash = `#/m/${map.id}`;
    } catch {
      toast('このファイルは読み込めませんでした');
    }
  });
}

// ---------- 編集 ----------

function showEditor(id) {
  const map = store.loadMap(id);
  if (!map) {
    location.replace('#/');
    return;
  }
  app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <a class="icon-btn" href="#/" title="一覧に戻る">${icon.back}</a>
        <div class="topbar-title" data-title></div>
        <div class="toolbar">
          <button class="tool" data-act="child" title="子トピックを追加（Tab）">${icon.child}<span>子</span></button>
          <button class="tool" data-act="sibling" title="同じ階層に追加（Enter）">${icon.sibling}<span>兄弟</span></button>
          <button class="tool tool-touch" data-act="edit" title="文字を編集（ダブルクリック / Space）">${icon.edit}<span>編集</span></button>
          <button class="tool" data-act="bold" title="太字（${MOD} B）">${icon.bold}<span>太字</span></button>
          <button class="tool" data-act="delete" title="削除（Delete）">${icon.trash}<span>削除</span></button>
          <span class="tool-sep"></span>
          <button class="tool" data-act="undo" title="元に戻す（${MOD} Z）">${icon.undo}</button>
          <button class="tool" data-act="redo" title="やり直し（${MOD} ⇧ Z）">${icon.redo}</button>
        </div>
        <div class="topbar-right">
          <button class="icon-btn" data-act="more" title="その他">${icon.more}</button>
          <button class="btn btn-primary" data-act="share">${icon.share}<span>共有</span></button>
        </div>
      </header>
      <div class="canvas" data-canvas></div>
      ${zoomControls()}
    </div>`;

  const screen = app.querySelector('.screen');
  const titleEl = screen.querySelector('[data-title]');
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!store.saveMap(map)) toast('保存できませんでした（ブラウザの保存容量がいっぱいです）');
  };
  const updateTitle = () => {
    titleEl.textContent = titleOf(map.root);
    document.title = `${titleOf(map.root)} - マインドマップ`;
  };

  const mm = new MindMap(screen.querySelector('[data-canvas]'), {
    root: map.root,
    onChange: (root) => {
      map.root = root;
      updateTitle();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(save, 300);
    },
  });
  updateTitle();
  bindZoom(screen, mm);

  const actions = {
    child: () => mm.addChild(),
    sibling: () => mm.addSibling(),
    edit: () => mm.startEdit(),
    delete: () => mm.deleteSelected(),
    undo: () => mm.undo(),
    redo: () => mm.redo(),
    bold: () => (mm.editingId ? document.execCommand('bold') : mm.toggleBoldSelected()),
    share: () => openShare(mm.root),
    more: (btn) =>
      openMenu(btn, [
        { icon: icon.image, label: 'PNG画像で保存', run: () => savePNG(mm) },
        { icon: icon.file, label: 'JSONで保存（バックアップ）', run: () => exportJSON(mm.root, titleOf(mm.root)) },
        { icon: icon.keyboard, label: 'ショートカット一覧', run: openShortcuts },
      ]),
  };
  const topbar = screen.querySelector('.topbar');
  // 編集中の文字選択を保ったままボタンを押せるよう、フォーカスを奪わない
  topbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.tool')) e.preventDefault();
  });
  topbar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (btn) actions[btn.dataset.act]?.(btn);
  });

  const onResize = () => mm.ensureVisible(mm.selectedId);
  window.addEventListener('resize', onResize);
  const onUnload = () => saveTimer && save();
  window.addEventListener('pagehide', onUnload);
  cleanup = () => {
    mm.commitEdit();
    if (saveTimer) save();
    mm.destroy();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pagehide', onUnload);
  };
}

async function openShare(root) {
  let url;
  try {
    url = `${location.origin}${location.pathname}#/v/${await encodeTree(root)}`;
  } catch {
    toast('このブラウザでは共有URLを作れません');
    return;
  }
  const { el } = openModal(
    '共有URL',
    `
    <p class="modal-text">このURLを開くと、誰でも<strong>閲覧専用</strong>でマップを見られます。ログインは不要です。</p>
    <div class="share-row">
      <input class="share-input" readonly value="${esc(url)}">
      <button class="btn btn-primary" data-copy>${icon.copy}<span>コピー</span></button>
    </div>
    <p class="modal-note">URLには<strong>今の時点の内容</strong>が入っています。あとでマップを直したら、もう一度「共有」からURLを発行し直してください。</p>
    <p class="modal-note">URLの長さ：${url.length.toLocaleString()}文字</p>`,
  );
  const input = el.querySelector('.share-input');
  input.addEventListener('focus', () => input.select());
  el.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    toast('URLをコピーしました');
  });
}

function openShortcuts() {
  const rows = [
    ['Tab', '子トピックを追加'],
    ['Enter', '同じ階層にトピックを追加'],
    ['ダブルクリック / Space / F2', '文字を編集'],
    ['Enter（編集中）', '編集を確定'],
    ['Shift + Enter（編集中）', '改行'],
    [`${MOD} + B`, '太字（編集中は選んだ文字だけ）'],
    ['Delete / Backspace', '削除'],
    ['↑ ↓ ← →', '選択を移動'],
    [`${MOD} + /`, '折りたたむ / 展開する'],
    [`${MOD} + Z`, '元に戻す'],
    [`${MOD} + Shift + Z`, 'やり直し'],
    [`${MOD} + ホイール / ピンチ`, '拡大・縮小'],
    ['ドラッグ（背景）', '画面を移動'],
    ['ドラッグ（トピック）', '別のトピックへ付け替え'],
  ];
  openModal(
    'ショートカット',
    `<dl class="shortcuts">${rows.map(([k, v]) => `<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join('')}</dl>`,
  );
}

// ---------- 共有の閲覧 ----------

async function showViewer(code) {
  let root;
  try {
    root = await decodeTree(code);
  } catch {
    document.title = 'マインドマップ';
    app.innerHTML = `
      <div class="empty empty-page">
        <p>このURLのマップを開けませんでした。<br>URLが途中で切れていないか確認してください。</p>
        <a class="btn" href="#/">マインドマップのトップへ</a>
      </div>`;
    return;
  }
  document.title = `${titleOf(root)} - マインドマップ`;
  app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <div class="topbar-title"><span>${esc(titleOf(root))}</span><span class="badge">閲覧専用</span></div>
        <div class="topbar-right">
          <button class="icon-btn" data-act="png" title="PNG画像で保存">${icon.image}</button>
          <button class="btn" data-act="copy">${icon.copy}<span>自分のマップにコピー</span></button>
        </div>
      </header>
      <div class="canvas" data-canvas></div>
      ${zoomControls()}
    </div>`;
  const screen = app.querySelector('.screen');
  const mm = new MindMap(screen.querySelector('[data-canvas]'), { root, readOnly: true });
  bindZoom(screen, mm);
  screen.querySelector('.topbar').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'png') savePNG(mm);
    if (act === 'copy') {
      const map = createMap(JSON.parse(JSON.stringify(mm.root)));
      store.saveMap(map);
      location.hash = `#/m/${map.id}`;
    }
  });
  cleanup = () => mm.destroy();
}
