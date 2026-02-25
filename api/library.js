const { json, readBody } = require("./_utils");
const { requireAuth, applyRateLimit } = require("./_security");
const { getMode, getLibrary, setLibrary } = require("./_store");

const MAX_FAVORITES = 300;
const MAX_HISTORY = 120;

function normalizeText(value, maxLen = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLen);
}

function normalizeSong(item) {
  if (!item || typeof item !== "object") return null;

  const id = normalizeText(item.id, 120);
  const platform = normalizeText(item.platform || "netease", 20);
  const name = normalizeText(item.name, 180);

  if (!id || !name) return null;

  return {
    id,
    platform,
    name,
    artist: normalizeText(item.artist, 180),
    album: normalizeText(item.album, 180),
    cover: normalizeText(item.cover, 500)
  };
}

function dedupeSongs(list, maxCount) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();

  for (const item of list) {
    const song = normalizeSong(item);
    if (!song) continue;
    const key = `${song.platform}|${song.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(song);
    if (out.length >= maxCount) break;
  }

  return out;
}

module.exports = async function handler(req, res) {
  const session = requireAuth(req, res);
  if (!session) return;

  const rateMax = Number(process.env.RATE_LIMIT_LIBRARY || 120);
  if (!applyRateLimit(req, res, { keyPrefix: `library:${session.uid}`, windowMs: 60000, max: rateMax })) return;

  if (req.method === "GET") {
    try {
      const stored = (await getLibrary(session.uid)) || {};
      const favorites = dedupeSongs(stored.favorites || [], MAX_FAVORITES);
      const history = dedupeSongs(stored.history || [], MAX_HISTORY);
      const updatedAt = Number(stored.updatedAt || 0) || 0;

      return json(res, 200, {
        code: 0,
        message: "ok",
        data: {
          favorites,
          history,
          updatedAt,
          store: getMode()
        }
      });
    } catch (error) {
      return json(res, 500, {
        code: -1,
        message: `读取云同步数据失败：${error?.message || "unknown"}`,
        data: { store: getMode() }
      });
    }
  }

  if (req.method === "POST") {
    try {
      const body = await readBody(req);
      const favorites = dedupeSongs(body.favorites || [], MAX_FAVORITES);
      const history = dedupeSongs(body.history || [], MAX_HISTORY);
      const updatedAt = Number(body.updatedAt || Date.now()) || Date.now();

      await setLibrary(session.uid, {
        favorites,
        history,
        updatedAt
      });

      return json(res, 200, {
        code: 0,
        message: "ok",
        data: {
          saved: true,
          updatedAt,
          store: getMode(),
          count: {
            favorites: favorites.length,
            history: history.length
          }
        }
      });
    } catch (error) {
      return json(res, 500, {
        code: -1,
        message: `保存云同步数据失败：${error?.message || "unknown"}`,
        data: { store: getMode() }
      });
    }
  }

  return json(res, 405, { code: -1, message: "Method Not Allowed" });
};
