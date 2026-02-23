const vm = require("vm");

function json(res, status, data) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body && typeof req.body === "object") return resolve(req.body);
    if (typeof req.body === "string") {
      try {
        return resolve(JSON.parse(req.body));
      } catch {
        return resolve({});
      }
    }

    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function getEnv() {
  const baseUrl = process.env.TUNEHUB_BASE_URL || "https://tunehub.sayqz.com/api";
  const apiKey = process.env.TUNEHUB_API_KEY || "";
  return { baseUrl, apiKey };
}

function replaceTemplate(str, vars) {
  if (typeof str !== "string") return str;
  let s = str;

  for (const [k, v] of Object.entries(vars)) {
    const val = String(v);

    s = s.replaceAll(`{{${k}}}`, val);
    s = s.replaceAll(`\`+i(r.${k})+\``, val);
    s = s.replaceAll(`\`+i(r.${k}||0)+\``, val);
    s = s.replaceAll(`\`+i(r.${k}||30)+\``, val);
  }

  return s;
}

function deepReplace(obj, vars) {
  if (obj == null) return obj;
  if (typeof obj === "string") return replaceTemplate(obj, vars);
  if (Array.isArray(obj)) return obj.map((x) => deepReplace(x, vars));
  if (typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = deepReplace(v, vars);
    }
    return out;
  }
  return obj;
}

function tryRunTransform(transformCode, responseData) {
  if (!transformCode || typeof transformCode !== "string") return null;
  try {
    const wrapped = `
      const __fn = (${transformCode});
      __fn(__input);
    `;
    const context = { __input: responseData };
    return vm.runInNewContext(wrapped, context, { timeout: 120 });
  } catch {
    return null;
  }
}

function pick(obj, paths) {
  for (const path of paths) {
    const keys = path.split(".");
    let cur = obj;
    let ok = true;
    for (const k of keys) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, k)) {
        cur = cur[k];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && cur != null) return cur;
  }
  return null;
}

function normalizeSongs(raw) {
  const arr = pick(raw, ["data.data", "data.list", "data.songs", "list", "songs", "data"]) || [];

  if (!Array.isArray(arr)) return [];

  return arr
    .map((item) => {
      const id =
        item.id ||
        item.songid ||
        item.mid ||
        item.rid ||
        item.musicrid ||
        item.MUSICRID ||
        item.hash ||
        "";

      const name = item.name || item.songname || item.title || item.musicName || "";
      const artist =
        item.artist ||
        item.singer ||
        item.artistname ||
        item.author ||
        (Array.isArray(item.artists) ? item.artists.map((a) => a.name || a).join("/") : "");
      const album = item.album || item.albumname || item.albumName || "";
      const cover = item.cover || item.pic || item.img || item.albumPic || "";

      return {
        id: String(id),
        name: String(name),
        artist: String(artist),
        album: String(album),
        cover: String(cover)
      };
    })
    .filter((x) => x.id && x.name);
}

function getCacheMap(name) {
  if (!globalThis.__TUNEHUB_CACHE__) globalThis.__TUNEHUB_CACHE__ = {};
  if (!globalThis.__TUNEHUB_CACHE__[name]) globalThis.__TUNEHUB_CACHE__[name] = new Map();
  return globalThis.__TUNEHUB_CACHE__[name];
}

function withCache(map, key, ttlMs, getter) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.time < ttlMs) return Promise.resolve({ fromCache: true, value: hit.value });
  return getter().then((value) => {
    map.set(key, { time: Date.now(), value });
    return { fromCache: false, value };
  });
}

module.exports = {
  json,
  readBody,
  toInt,
  getEnv,
  deepReplace,
  tryRunTransform,
  normalizeSongs,
  getCacheMap,
  withCache
};

