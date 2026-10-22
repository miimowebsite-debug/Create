// 共有URL: マップを deflate で圧縮し、base64url にして URL の # 以降に入れる

import { pack, unpack } from './model.js';

const VERSION = '1';

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function encodeTree(root) {
  const json = new TextEncoder().encode(JSON.stringify(pack(root)));
  const compressed = await pipe(json, new CompressionStream('deflate-raw'));
  return `${VERSION}.${toBase64Url(compressed)}`;
}

export async function decodeTree(code) {
  const [version, data] = code.split('.');
  if (version !== VERSION || !data) throw new Error('unsupported');
  const json = await pipe(fromBase64Url(data), new DecompressionStream('deflate-raw'));
  return unpack(JSON.parse(new TextDecoder().decode(json)));
}
