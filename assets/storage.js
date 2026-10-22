// マップはこのブラウザの localStorage に1件ずつ保存する

const PREFIX = 'mindmap.v1.map.';

export function listMaps() {
  const maps = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(PREFIX)) continue;
      try {
        maps.push(JSON.parse(localStorage.getItem(key)));
      } catch {
        // 壊れたデータは一覧に出さない
      }
    }
  } catch {
    return [];
  }
  return maps.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadMap(id) {
  try {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveMap(map) {
  map.updatedAt = Date.now();
  try {
    localStorage.setItem(PREFIX + map.id, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function deleteMap(id) {
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    // 何もしない
  }
}
