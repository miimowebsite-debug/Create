#!/usr/bin/env node
// design/tokens.json -> design/assets/tokens.js（window.ZTOKENS）
// テンプレートは file:// でも動くよう fetch を使わず <script> で tokens.js を読む。
const fs = require('fs');
const path = require('path');
const src = path.resolve(__dirname, '..', 'tokens.json');
const dst = path.resolve(__dirname, '..', 'assets', 'tokens.js');
const tokens = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.writeFileSync(
  dst,
  '/* generated from design/tokens.json by design/tools/build-tokens.js - do not edit */\n' +
    'window.ZTOKENS=' + JSON.stringify(tokens, null, 1) + ';\n'
);
console.log('wrote', path.relative(process.cwd(), dst));
