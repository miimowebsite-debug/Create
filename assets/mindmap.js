// マインドマップ本体: 右方向への自動配置・描画・編集・ドラッグ・ズーム

import { BRANCHES, createNode, locate, contains, countNodes, sanitize, toggleBold } from './model.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COL_GAPS = [72, 32, 28]; // 列と列の間隔（深さ0→1, 1→2, 2以降）
const colGap = (depth) => COL_GAPS[Math.min(depth, COL_GAPS.length - 1)];
const sibGap = (depth) => (depth === 1 ? 32 : depth === 2 ? 12 : 8); // 兄弟の間隔
const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const HISTORY_LIMIT = 200;
const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function elbowPath(x0, y0, x1, y1, radius) {
  const xm = (x0 + x1) / 2;
  const dy = y1 - y0;
  if (Math.abs(dy) < 0.5) return `M${x0},${y0} H${x1}`;
  const s = Math.sign(dy);
  const r = Math.min(radius, Math.abs(dy) / 2, (x1 - x0) / 2);
  return (
    `M${x0},${y0} H${xm - r} Q${xm},${y0} ${xm},${y0 + s * r} ` +
    `V${y1 - s * r} Q${xm},${y1} ${xm + r},${y1} H${x1}`
  );
}

export class MindMap {
  constructor(viewport, { root, readOnly = false, onChange = () => {}, onViewChange = () => {} }) {
    this.viewport = viewport;
    this.root = root;
    this.readOnly = readOnly;
    this.onChange = onChange;
    this.onViewChange = onViewChange;
    this.selectedId = readOnly ? null : root.id;
    this.editingId = null;
    this.history = [];
    this.future = [];
    this.view = { x: 0, y: 0, scale: 1 };
    this.info = new Map();
    this.pointers = new Map();
    this.gesture = null;
    this.lastTap = null;

    viewport.classList.add('mm-viewport');
    viewport.classList.toggle('is-readonly', readOnly);
    this.world = document.createElement('div');
    this.world.className = 'mm-world';
    this.lines = document.createElementNS(SVG_NS, 'svg');
    this.lines.classList.add('mm-lines');
    this.layer = document.createElement('div');
    this.layer.className = 'mm-nodes';
    this.world.append(this.lines, this.layer);
    viewport.append(this.world);

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    viewport.addEventListener('pointerdown', this.onPointerDown);
    viewport.addEventListener('pointermove', this.onPointerMove);
    viewport.addEventListener('pointerup', this.onPointerUp);
    viewport.addEventListener('pointercancel', this.onPointerUp);
    viewport.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    this.layer.addEventListener('input', () => this.editingId && this.layout());
    this.layer.addEventListener('paste', (e) => {
      if (!this.editingId) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    this.layer.addEventListener('focusout', () => this.commitEdit());

    this.render();
    this.fit();
  }

  destroy() {
    window.removeEventListener('keydown', this.onKeyDown);
    this.viewport.replaceChildren();
  }

  // ---------- 描画 ----------

  render() {
    this.layer.replaceChildren();
    this.info.clear();
    const visit = (node, parent, depth, branch) => {
      const info = { node, parent, depth, branch };
      info.el = this.buildNode(info);
      this.layer.append(info.el);
      this.info.set(node.id, info);
      if (node.collapsed) return;
      node.children.forEach((child, i) =>
        visit(child, node, depth + 1, depth === 0 ? BRANCHES[i % BRANCHES.length] : branch),
      );
    };
    visit(this.root, null, 0, null);
    if (this.selectedId && !this.info.has(this.selectedId)) this.selectedId = this.readOnly ? null : this.root.id;
    this.info.get(this.selectedId)?.el.classList.add('is-selected');
    this.layout();
  }

  buildNode({ node, depth, branch }) {
    const el = document.createElement('div');
    el.className = `mm-node d${Math.min(depth, 2)}`;
    el.dataset.id = node.id;
    if (branch) {
      for (const key of ['main', 'soft', 'line', 'ink']) el.style.setProperty(`--${key}`, branch[key]);
    }
    const text = document.createElement('div');
    text.className = 'mm-text';
    text.innerHTML = node.text;
    el.append(text);
    if (depth > 0 && node.children.length) {
      const fold = document.createElement('button');
      fold.type = 'button';
      fold.tabIndex = -1;
      fold.className = 'mm-fold' + (node.collapsed ? ' is-collapsed' : '');
      fold.textContent = node.collapsed ? String(countNodes(node) - 1) : '−';
      fold.setAttribute('aria-label', node.collapsed ? '展開する' : '折りたたむ');
      el.append(fold);
    }
    return el;
  }

  layout() {
    const infos = [...this.info.values()];
    // 1) 自然な幅を測る → 2) 同じ深さの列は幅を揃える → 3) 高さを測る
    for (const i of infos) i.el.style.width = '';
    const colWidth = [];
    for (const i of infos) {
      i.naturalW = i.el.offsetWidth;
      colWidth[i.depth] = Math.max(colWidth[i.depth] || 0, i.naturalW);
    }
    for (const i of infos) {
      i.w = i.depth === 0 ? i.naturalW : colWidth[i.depth];
      if (i.depth > 0) i.el.style.width = `${i.w}px`;
    }
    for (const i of infos) i.h = i.el.offsetHeight;

    const colX = [0];
    for (let d = 1; d < colWidth.length; d++) colX[d] = colX[d - 1] + colWidth[d - 1] + colGap(d - 1);

    const visibleKids = (i) => (i.node.collapsed ? [] : i.node.children.map((c) => this.info.get(c.id)));
    const measure = (i) => {
      const kids = visibleKids(i);
      i.kidsH = kids.reduce((sum, k) => sum + measure(k), 0) + Math.max(0, kids.length - 1) * sibGap(i.depth + 1);
      i.subH = Math.max(i.h, i.kidsH);
      return i.subH;
    };
    const place = (i, top) => {
      i.x = colX[i.depth];
      i.y = top + (i.subH - i.h) / 2;
      let cy = top + (i.subH - i.kidsH) / 2;
      for (const k of visibleKids(i)) {
        place(k, cy);
        cy += k.subH + sibGap(i.depth + 1);
      }
    };
    const rootInfo = this.info.get(this.root.id);
    measure(rootInfo);
    place(rootInfo, 0);

    const paths = [];
    let maxX = 0;
    for (const i of infos) {
      i.el.style.left = `${i.x}px`;
      i.el.style.top = `${i.y}px`;
      maxX = Math.max(maxX, i.x + i.w + (i.node.children.length ? 20 : 0));
      if (!i.parent) continue;
      const p = this.info.get(i.parent.id);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute(
        'd',
        elbowPath(p.x + p.w, p.y + p.h / 2, i.x, i.y + i.h / 2, i.depth === 1 ? 44 : 10),
      );
      path.setAttribute('stroke', i.branch.line);
      path.setAttribute('stroke-width', i.depth === 1 ? '2' : '1.5');
      paths.push(path);
    }
    this.lines.replaceChildren(...paths);
    this.bounds = { minX: 0, minY: 0, maxX, maxY: rootInfo.subH };
  }

  // ---------- 表示位置 ----------

  applyView() {
    const { x, y, scale } = this.view;
    this.world.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.onViewChange(this.view);
  }

  fit() {
    const { minX, minY, maxX, maxY } = this.bounds;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const pad = 40;
    const bw = maxX - minX;
    const bh = maxY - minY;
    let scale = Math.min(1, (vw - pad * 2) / bw, (vh - pad * 2) / bh);
    // 幅の狭い画面（スマホ）では高さに合わせ、横はスワイプで見てもらう
    if (vw < 600 && scale < 0.6) scale = Math.max(scale, Math.min(0.6, (vh - pad * 2) / bh));
    scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    const left = vw < 600 ? 16 : pad;
    this.view = {
      scale,
      x: Math.max(left, (vw - bw * scale) / 2) - minX * scale,
      y: (vh - bh * scale) / 2 - minY * scale,
    };
    this.applyView();
  }

  zoomAt(cx, cy, scale) {
    scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    const { x, y, scale: s } = this.view;
    const wx = (cx - x) / s;
    const wy = (cy - y) / s;
    this.view = { scale, x: cx - wx * scale, y: cy - wy * scale };
    this.applyView();
  }

  zoomBy(factor) {
    this.zoomAt(this.viewport.clientWidth / 2, this.viewport.clientHeight / 2, this.view.scale * factor);
  }

  ensureVisible(id) {
    const i = this.info.get(id);
    if (!i) return;
    const { x, y, scale } = this.view;
    const vw = this.viewport.clientWidth;
    const vh = this.viewport.clientHeight;
    const m = 48;
    const sx = x + i.x * scale;
    const sy = y + i.y * scale;
    const ex = sx + i.w * scale;
    const ey = sy + i.h * scale;
    let dx = 0;
    let dy = 0;
    if (ex > vw - m) dx = vw - m - ex;
    if (sx + dx < m) dx = m - sx;
    if (ey > vh - m) dy = vh - m - ey;
    if (sy + dy < m) dy = m - sy;
    if (dx || dy) {
      this.view.x += dx;
      this.view.y += dy;
      this.applyView();
    }
  }

  // ---------- 編集操作 ----------

  pushHistory() {
    this.history.push(JSON.stringify(this.root));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
  }

  restore(from, to) {
    if (!from.length) return;
    to.push(JSON.stringify(this.root));
    this.root = JSON.parse(from.pop());
    if (!locate(this.root, this.selectedId)) this.selectedId = this.root.id;
    this.render();
    this.onChange(this.root);
  }

  undo() {
    this.commitEdit();
    this.restore(this.history, this.future);
  }

  redo() {
    this.commitEdit();
    this.restore(this.future, this.history);
  }

  changed() {
    this.render();
    this.onChange(this.root);
  }

  select(id) {
    if (this.readOnly || this.selectedId === id) return;
    this.info.get(this.selectedId)?.el.classList.remove('is-selected');
    this.selectedId = id;
    this.info.get(id)?.el.classList.add('is-selected');
  }

  addChild() {
    if (this.readOnly) return;
    this.commitEdit();
    const parent = locate(this.root, this.selectedId)?.node;
    if (!parent) return;
    this.pushHistory();
    const node = createNode('');
    parent.children.push(node);
    parent.collapsed = false;
    this.selectedId = node.id;
    this.changed();
    this.startEdit(node.id);
  }

  addSibling() {
    if (this.readOnly) return;
    this.commitEdit();
    const loc = locate(this.root, this.selectedId);
    if (!loc) return;
    if (!loc.parent) return this.addChild();
    this.pushHistory();
    const node = createNode('');
    loc.parent.children.splice(loc.index + 1, 0, node);
    this.selectedId = node.id;
    this.changed();
    this.startEdit(node.id);
  }

  deleteSelected() {
    if (this.readOnly) return;
    this.commitEdit();
    const loc = locate(this.root, this.selectedId);
    if (!loc || !loc.parent) return;
    this.pushHistory();
    const siblings = loc.parent.children;
    siblings.splice(loc.index, 1);
    this.selectedId = (siblings[loc.index] || siblings[loc.index - 1] || loc.parent).id;
    this.changed();
    this.ensureVisible(this.selectedId);
  }

  toggleFold(id) {
    const node = locate(this.root, id)?.node;
    if (!node || !node.children.length || node === this.root) return;
    this.commitEdit();
    node.collapsed = !node.collapsed;
    if (this.selectedId && !this.readOnly && node.collapsed && contains(node, this.selectedId)) {
      this.selectedId = id;
    }
    this.render();
    if (!this.readOnly) this.onChange(this.root);
  }

  toggleBoldSelected() {
    const node = locate(this.root, this.selectedId)?.node;
    if (!node) return;
    this.pushHistory();
    node.text = toggleBold(node.text);
    this.changed();
  }

  moveNode(id, targetId, zone) {
    const src = locate(this.root, id);
    if (!src || !src.parent || contains(src.node, targetId)) return;
    this.pushHistory();
    src.parent.children.splice(src.index, 1);
    const target = locate(this.root, targetId);
    if (zone === 'child' || !target.parent) {
      target.node.children.push(src.node);
      target.node.collapsed = false;
    } else {
      target.parent.children.splice(target.index + (zone === 'after' ? 1 : 0), 0, src.node);
    }
    this.selectedId = id;
    this.changed();
  }

  // ---------- 文字の編集 ----------

  startEdit(id = this.selectedId) {
    if (this.readOnly) return;
    const info = this.info.get(id);
    if (!info) return;
    this.select(id);
    this.editingId = id;
    this.editOriginal = info.node.text;
    const text = info.el.querySelector('.mm-text');
    info.el.classList.add('is-editing');
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.focus();
    const range = document.createRange();
    range.selectNodeContents(text);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    this.ensureVisible(id);
  }

  commitEdit() {
    const id = this.editingId;
    if (!id) return;
    this.editingId = null;
    const info = this.info.get(id);
    if (!info) return;
    const html = sanitize(info.el.querySelector('.mm-text').innerHTML);
    window.getSelection()?.removeAllRanges();
    if (html !== this.editOriginal) {
      this.pushHistory();
      info.node.text = html;
      this.changed();
    } else {
      this.render();
    }
  }

  // ---------- 入力 ----------

  onKeyDown(e) {
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea, select, .modal-back')) return;
    this.lastTap = null;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    const key = e.key;
    const lower = key.length === 1 ? key.toLowerCase() : key;

    if (this.editingId) {
      if (e.isComposing || e.keyCode === 229) return;
      if (key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.commitEdit();
      } else if (key === 'Tab') {
        e.preventDefault();
        this.commitEdit();
        this.addChild();
      } else if (key === 'Escape') {
        e.preventDefault();
        this.commitEdit();
      } else if (mod && lower === 'b') {
        e.preventDefault();
        document.execCommand('bold');
        this.layout();
      }
      return;
    }

    if (mod && (key === '=' || key === '+')) return e.preventDefault(), this.zoomBy(1.2);
    if (mod && key === '-') return e.preventDefault(), this.zoomBy(1 / 1.2);
    if (mod && key === '0') return e.preventDefault(), this.fit();
    if (this.readOnly) return;
    if (mod && lower === 'z') return e.preventDefault(), e.shiftKey ? this.redo() : this.undo();
    if (mod && lower === 'y') return e.preventDefault(), this.redo();
    if (!this.selectedId) return;
    if (mod && lower === 'b') return e.preventDefault(), this.toggleBoldSelected();
    if (mod && key === '/') return e.preventDefault(), this.toggleFold(this.selectedId);
    if (mod || e.altKey) return;

    const actions = {
      Tab: () => this.addChild(),
      Enter: () => this.addSibling(),
      Delete: () => this.deleteSelected(),
      Backspace: () => this.deleteSelected(),
      F2: () => this.startEdit(),
      ' ': () => this.startEdit(),
      ArrowLeft: () => this.navigate('left'),
      ArrowRight: () => this.navigate('right'),
      ArrowUp: () => this.navigate('up'),
      ArrowDown: () => this.navigate('down'),
    };
    if (actions[key]) {
      e.preventDefault();
      actions[key]();
    } else if (key.length === 1) {
      // 文字キーでそのまま書き換え開始
      e.preventDefault();
      this.startEdit();
      document.execCommand('insertText', false, key);
    } else if (key === 'Process') {
      // 日本語入力の最初のキー: 全選択で編集を始め、変換中の文字を受け取る
      this.startEdit();
    }
  }

  navigate(dir) {
    const cur = this.info.get(this.selectedId);
    if (!cur) return;
    const cy = cur.y + cur.h / 2;
    let next = null;
    if (dir === 'left') {
      next = cur.parent && this.info.get(cur.parent.id);
    } else if (dir === 'right') {
      if (cur.node.collapsed) return this.toggleFold(cur.node.id);
      let best = Infinity;
      for (const c of cur.node.children) {
        const k = this.info.get(c.id);
        const d = Math.abs(k.y + k.h / 2 - cy);
        if (d < best) (best = d), (next = k);
      }
    } else {
      let best = Infinity;
      for (const i of this.info.values()) {
        if (i.depth !== cur.depth || i === cur) continue;
        const d = i.y + i.h / 2 - cy;
        if ((dir === 'up' ? d < 0 : d > 0) && Math.abs(d) < best) (best = Math.abs(d)), (next = i);
      }
    }
    if (next) {
      this.select(next.node.id);
      this.ensureVisible(next.node.id);
    }
  }

  localPoint(e) {
    const r = this.viewport.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const fold = e.target.closest('.mm-fold');
    if (fold) {
      e.preventDefault();
      this.toggleFold(fold.parentElement.dataset.id);
      return;
    }
    const nodeEl = e.target.closest('.mm-node');
    if (nodeEl && nodeEl.dataset.id === this.editingId) return; // 編集中の文字の選択はブラウザに任せる
    e.preventDefault();
    this.commitEdit();
    this.viewport.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.localPoint(e));

    if (this.pointers.size === 2) {
      this.endDrag(false);
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        type: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: { ...this.view },
      };
      return;
    }
    if (this.pointers.size > 2) return;

    const id = nodeEl?.dataset.id || null;
    if (id) this.select(id);
    const p = this.pointers.get(e.pointerId);
    const canDrag = id && !this.readOnly && e.pointerType !== 'touch' && id !== this.root.id;
    this.gesture = { type: canDrag ? 'node' : 'pan', id, sx: p.x, sy: p.y, vx: this.view.x, vy: this.view.y, moved: false };
  }

  onPointerMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.localPoint(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;

    if (g.type === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clamp((g.view.scale * dist) / g.dist, MIN_SCALE, MAX_SCALE);
      const wx = (g.mid.x - g.view.x) / g.view.scale;
      const wy = (g.mid.y - g.view.y) / g.view.scale;
      this.view = { scale, x: mid.x - wx * scale, y: mid.y - wy * scale };
      this.applyView();
      return;
    }

    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    if (!g.moved && Math.hypot(dx, dy) < 5) return;
    g.moved = true;
    if (g.type === 'pan') {
      this.view.x = g.vx + dx;
      this.view.y = g.vy + dy;
      this.applyView();
    } else {
      this.updateDrag(e);
    }
  }

  onPointerUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch') {
      if (this.pointers.size === 0) this.gesture = null;
      return;
    }
    if (g.type === 'node' && g.moved) {
      this.endDrag(e.type === 'pointerup');
      return;
    }
    this.gesture = null;
    if (!g.moved && g.id) {
      const now = Date.now();
      if (this.lastTap && this.lastTap.id === g.id && now - this.lastTap.t < 400) {
        this.lastTap = null;
        this.startEdit(g.id);
      } else {
        this.lastTap = { id: g.id, t: now };
      }
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.localPoint(e);
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(p.x, p.y, this.view.scale * Math.exp(-e.deltaY * 0.01));
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.view.x -= e.deltaX * k;
      this.view.y -= e.deltaY * k;
      this.applyView();
    }
  }

  // ---------- ドラッグで付け替え ----------

  updateDrag(e) {
    const g = this.gesture;
    if (!g.ghost) {
      const src = this.info.get(g.id);
      g.ghost = src.el.cloneNode(true);
      g.ghost.classList.add('mm-ghost');
      g.ghost.classList.remove('is-selected');
      g.ghost.style.left = g.ghost.style.top = '0';
      g.ghost.style.transformOrigin = '0 0';
      document.body.append(g.ghost);
      src.el.classList.add('is-dragging');
    }
    g.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px) scale(${this.view.scale})`;

    this.clearDropMark();
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.mm-node');
    const target = under && this.layer.contains(under) ? this.info.get(under.dataset.id) : null;
    const src = locate(this.root, g.id).node;
    if (!target || contains(src, target.node.id)) {
      g.drop = null;
      return;
    }
    const r = under.getBoundingClientRect();
    const rel = (e.clientY - r.top) / r.height;
    const zone = !target.parent ? 'child' : rel < 0.28 ? 'before' : rel > 0.72 ? 'after' : 'child';
    g.drop = { id: target.node.id, zone, el: under };
    under.classList.add(`drop-${zone}`);
  }

  clearDropMark() {
    this.layer.querySelectorAll('.drop-child, .drop-before, .drop-after').forEach((el) => {
      el.classList.remove('drop-child', 'drop-before', 'drop-after');
    });
  }

  endDrag(apply) {
    const g = this.gesture;
    if (!g || g.type !== 'node') return;
    g.ghost?.remove();
    this.clearDropMark();
    this.info.get(g.id)?.el.classList.remove('is-dragging');
    if (apply && g.drop) this.moveNode(g.id, g.drop.id, g.drop.zone);
    this.gesture = null;
  }
}
