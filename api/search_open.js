const { json, readBody, toInt, getCacheMap, withCache } = require("./_utils");
const { requireAuth, applyRateLimit } = require("./_security");

const TTL = 5 * 60 * 1000;
const cache = getCacheMap("search_open");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { code: -1, message: "Method Not Allowed" });

  const session = requireAuth(req, res);
  if (!session) return;

  const searchMax = Number(process.env.RATE_LIMIT_SEARCH || 60);
  if (!applyRateLimit(req, res, { keyPrefix: `search-open:${session.uid}`, windowMs: 60000, max: searchMax })) return;

  try {
    const body = await readBody(req);
    const keyword = (body.keyword || "").toString().trim();
    const pageSize = Math.min(50, Math.max(1, toInt(body.pageSize, 20)));

    if (!keyword) return json(res, 400, { code: -1, message: "keyword 不能为空" });

    const key = `${keyword}|${pageSize}`;

    const { fromCache, value } = await withCache(cache, key, TTL, async () => {
      const url = new URL("https://itunes.apple.com/search");
      url.searchParams.set("term", keyword);
      url.searchParams.set("entity", "song");
      url.searchParams.set("media", "music");
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("country", "CN");
      url.searchParams.set("lang", "zh_cn");

      const resp = await fetch(url.toString());
      const raw = await resp.json();

      if (!resp.ok) {
        return {
          status: resp.status,
          data: { code: -1, message: raw?.errorMessage || `开放搜索失败（HTTP ${resp.status}）` }
        };
      }

      const songs = (Array.isArray(raw?.results) ? raw.results : [])
        .map((item) => {
          const id = item?.trackId || item?.collectionId || "";
          const name = item?.trackName || item?.collectionName || "";
          const artist = item?.artistName || "";
          const album = item?.collectionName || "";
          const coverRaw = item?.artworkUrl100 || item?.artworkUrl60 || "";
          const cover = typeof coverRaw === "string" ? coverRaw.replace("100x100bb", "600x600bb") : "";
          const directUrl = item?.previewUrl || "";

          return {
            id: String(id),
            name: String(name),
            artist: String(artist),
            album: String(album),
            cover: String(cover),
            directUrl: String(directUrl),
            platform: "itunes"
          };
        })
        .filter((song) => song.id && song.name && song.directUrl);

      return {
        status: 200,
        data: {
          code: 0,
          message: "ok",
          data: {
            platform: "itunes",
            keyword,
            count: songs.length,
            songs
          }
        }
      };
    });

    return json(res, value.status || 200, { ...value.data, localCache: fromCache });
  } catch (err) {
    return json(res, 500, { code: -1, message: err?.message || "开放搜索异常" });
  }
};

