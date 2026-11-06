/* 聞くだけでお金持ちになる雑学 — テンプレート共通ランタイム
 * 依存: ../assets/tokens.js (window.ZTOKENS), ../assets/icons/lucide-icons.js (window.LUCIDE_ICONS)
 * データの優先順位: ?data=<URLエンコードJSON>  >  window.SCENE / window.THUMB  >  テンプレート内のサンプル
 * テーマ: ?theme=navy|black|green  >  data.theme  >  tokens.defaultTheme
 * 見出しフォント: ?font=noto|zen  >  data.font  >  tokens.defaultFont
 * モード: data.mode ("regular" | "sleep")  ?mode= でも上書き可
 * ガイド表示: ?guides=1 で字幕エリア（下部18%）を可視化（確認用）
 */
(function () {
  'use strict';
  var T = window.ZTOKENS || {};
  var params = new URLSearchParams(location.search);

  function parseJSON(s) {
    try { return JSON.parse(s); } catch (e) {
      try { return JSON.parse(decodeURIComponent(s)); } catch (e2) {
        console.error('[zd] ?data= を JSON として読めません', e2); return null;
      }
    }
  }

  function loadData(globalNames, sample) {
    var d = null;
    if (params.has('data')) d = parseJSON(params.get('data'));
    if (!d) {
      for (var i = 0; i < globalNames.length; i++) {
        if (window[globalNames[i]] && typeof window[globalNames[i]] === 'object') { d = window[globalNames[i]]; break; }
      }
    }
    if (!d) d = sample || {};
    return d;
  }

  function setup(data) {
    var themes = T.themes || {};
    var theme = params.get('theme') || data.theme || T.defaultTheme || 'navy';
    if (!themes[theme]) { console.warn('[zd] unknown theme', theme); theme = T.defaultTheme || Object.keys(themes)[0]; }
    var mode = params.get('mode') || data.mode || 'regular';
    if (mode !== 'sleep') mode = 'regular';
    var font = params.get('font') || data.font || T.defaultFont || 'noto';
    var serifs = (T.fonts && T.fonts.serif) || {};
    if (!serifs[font]) font = 'noto';

    var th = themes[theme] || { colors: {} };
    var colors = Object.assign({}, th.colors, mode === 'sleep' ? th.sleep : null);
    var root = document.documentElement.style;
    Object.keys(colors).forEach(function (k) {
      root.setProperty('--' + k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }), colors[k]);
    });
    root.setProperty('--font-serif', serifs[font] || 'serif');
    root.setProperty('--font-sans', (T.fonts && T.fonts.sans) || 'sans-serif');
    var w = (T.fonts && T.fonts.weights) || {};
    root.setProperty('--w-heading', mode === 'sleep' ? (font === 'zen' ? 700 : w.headingSleep || 500) : (w.heading || 700));
    root.setProperty('--w-display', w.display || 900);
    root.setProperty('--w-body', w.body || 400);
    root.setProperty('--w-caption', w.caption || 500);
    var ls = T.letterSpacing || {};
    root.setProperty('--ls-heading', ls.heading || '0.06em');
    root.setProperty('--ls-label', ls.label || '0.24em');
    root.setProperty('--ls-body', ls.body || '0.04em');

    var b = document.body;
    b.dataset.theme = theme;
    b.dataset.mode = mode;
    b.dataset.font = font;
    if (params.get('guides') === '1') b.classList.add('show-guides');
    return { theme: theme, mode: mode, font: font, colors: colors, sleep: mode === 'sleep' };
  }

  // Lucide アイコン（線画）を SVG 文字列で返す。未知の名前は coins にフォールバック。
  function icon(name, opt) {
    opt = opt || {};
    var lib = window.LUCIDE_ICONS || {};
    var key = String(name || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    if (!lib[key]) {
      // "PiggyBank" -> "piggy-bank"
      var kebab = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      if (lib[kebab]) key = kebab;
      else { if (name) console.warn('[zd] unknown lucide icon:', name); key = opt.fallback || 'coins'; }
    }
    var sw = opt.stroke || 1.25;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
      ' stroke-width="' + sw + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' +
      ' data-icon="' + key + '">' + (lib[key] || '') + '</svg>';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 要素がボックス（親 or 指定サイズ）に収まるまで font-size を下げる。
  // opts: {max, min, step, maxLines, box}
  function fit(el, opts) {
    if (!el) return;
    opts = opts || {};
    var max = opts.max, min = opts.min || Math.round(max * 0.5), step = opts.step || 2;
    var box = opts.box || el.parentElement;
    var maxLines = opts.maxLines || 1;
    var size = max;
    function overflow() {
      var lh = parseFloat(getComputedStyle(el).lineHeight) || size * 1.3;
      var lines = Math.round(el.scrollHeight / lh);
      var bw = opts.width || box.clientWidth;
      var bh = opts.height || box.clientHeight;
      return el.scrollWidth > bw + 0.5 || (bh && el.scrollHeight > bh + 0.5) || lines > maxLines;
    }
    el.style.fontSize = size + 'px';
    while (size > min && overflow()) { size -= step; el.style.fontSize = size + 'px'; }
    el.dataset.fitSize = size;
    return size;
  }

  // 使われている文字のフォントを確実に読み込んでから計測する
  function fontsReady() {
    document.body.offsetHeight; // レイアウトを確定させ unicode-range サブセットの読み込みを開始
    var specs = [];
    var families = (T.fonts && T.fonts.files) || {};
    var text = document.body.innerText || '';
    Object.keys(families).forEach(function (f) {
      families[f].forEach(function (w) { specs.push(w + ' 40px "' + f + '"'); });
    });
    var loads = specs.map(function (s) {
      return document.fonts.load(s, text).catch(function () {});
    });
    var timeout = new Promise(function (r) { setTimeout(r, 8000); });
    return Promise.race([Promise.all(loads).then(function () { return document.fonts.ready; }), timeout]);
  }

  function raf2() {
    return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  }

  // render(): DOM を作る。layout(): フォント読込後にサイズ調整する。最後に data-ready="1"
  function run(render, layout) {
    function go() {
      Promise.resolve()
        .then(render)
        .then(fontsReady)
        .then(function () { return layout && layout(); })
        .then(fontsReady)
        .then(raf2)
        .catch(function (e) { console.error('[zd] render error', e); document.body.dataset.error = String(e && e.message || e); })
        .then(function () { document.body.dataset.ready = '1'; });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }

  window.ZD = { tokens: T, params: params, loadData: loadData, setup: setup, icon: icon, esc: esc, fit: fit, fontsReady: fontsReady, run: run };
})();
