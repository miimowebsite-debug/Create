// マップのデータ構造と、ノード本文（太字だけを許すHTML）の扱い

export const uid = () =>
  Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export function createNode(text = '') {
  return { id: uid(), text, children: [], collapsed: false };
}

export function createMap(root) {
  if (!root) {
    root = createNode('中心トピック');
    root.children = [1, 2, 3].map((i) => createNode(`メイントピック ${i}`));
  }
  const now = Date.now();
  return { id: uid(), root, createdAt: now, updatedAt: now };
}

export function locate(root, id) {
  let found = null;
  const visit = (node, parent, index, depth) => {
    if (found) return;
    if (node.id === id) {
      found = { node, parent, index, depth };
      return;
    }
    node.children.forEach((c, i) => visit(c, node, i, depth + 1));
  };
  visit(root, null, -1, 0);
  return found;
}

export function contains(node, id) {
  return node.id === id || node.children.some((c) => contains(c, id));
}

export function countNodes(node) {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0);
}

// 共有URL・JSON用のコンパクトな形式（idを持たない）
export function pack(node) {
  const o = { t: node.text };
  if (node.children.length) o.c = node.children.map(pack);
  if (node.collapsed) o.x = 1;
  return o;
}

export function unpack(o) {
  if (!o || typeof o !== 'object') throw new Error('invalid node');
  return {
    id: uid(),
    text: sanitize(String(o.t ?? '')),
    children: Array.isArray(o.c) ? o.c.map(unpack) : [],
    collapsed: !!o.x,
  };
}

// ---- 本文 ----
// 本文は「太字かどうか」のついた文字の並び（runs）として解釈し、
// <b> と <br> だけのHTMLに書き戻す。貼り付けや共有URLからの入力もここを通す。

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE']);

function toRuns(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const runs = [];
  const push = (text, bold) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === bold) last.text += text;
    else runs.push({ text, bold });
  };
  const endsWithBreak = () => !runs.length || runs[runs.length - 1].text.endsWith('\n');
  const visit = (parent, bold) => {
    for (const n of parent.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) {
        push(n.data.replace(/\r/g, ''), bold);
        continue;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const tag = n.tagName;
      if (tag === 'BR') {
        push('\n', bold);
        continue;
      }
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      let b = bold;
      if (tag === 'B' || tag === 'STRONG') b = true;
      const fw = n.style && n.style.fontWeight;
      if (fw) b = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600;
      if (BLOCK_TAGS.has(tag) && !endsWithBreak()) push('\n', bold);
      visit(n, b);
    }
  };
  visit(tpl.content, false);
  // contenteditable が末尾に足す改行を落とす
  while (runs.length) {
    const last = runs[runs.length - 1];
    last.text = last.text.replace(/\n+$/, '');
    if (last.text) break;
    runs.pop();
  }
  return runs;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function fromRuns(runs) {
  return runs
    .map((r) => {
      const t = escapeHtml(r.text).replace(/\n/g, '<br>');
      return r.bold && r.text.trim() ? `<b>${t}</b>` : t;
    })
    .join('');
}

export const sanitize = (html) => fromRuns(toRuns(html));

export const plainText = (html) => toRuns(html).map((r) => r.text).join('');

export function toggleBold(html) {
  const runs = toRuns(html);
  const allBold = runs.every((r) => r.bold || !r.text.trim());
  return fromRuns(runs.map((r) => ({ text: r.text, bold: !allBold })));
}

// ---- 配色 ----
export const BRANCHES = [
  { main: '#EF7571', soft: '#FCE4E3', line: '#E9827E', ink: '#4A1D1B' },
  { main: '#F3A46F', soft: '#FCEDE2', line: '#EFA778', ink: '#4A2A12' },
  { main: '#A6D4BA', soft: '#EBF5EF', line: '#9FCBB3', ink: '#1C3A27' },
  { main: '#9FDCD6', soft: '#E8F6F4', line: '#95D2CB', ink: '#163936' },
  { main: '#AEBDEB', soft: '#ECF0FB', line: '#A5B4E2', ink: '#1F2A4D' },
  { main: '#D3B0E6', soft: '#F5ECFA', line: '#C8A5DC', ink: '#36204A' },
];
