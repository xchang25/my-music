const {
  json,
  readBody,
  getEnv,
  deepReplace,
  tryRunTransform,
  tryParseTextPayload,
  normalizeSongs,
  getCacheMap,
  withCache
} = require("./_utils");
const { requireAuth, applyRateLimit } = require("./_security");

const TTL = 3 * 60 * 1000;
const cache = getCacheMap("toplist");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { code: -1, message: "Method Not Allowed" });

  const session = requireAuth(req, res);
  if (!session) return;

  const rankMax = Number(process.env.RATE_LIMIT_RANK || process.env.RATE_LIMIT_SEARCH || 60);
  if (!applyRateLimit(req, res, { keyPrefix: `toplist:${session.uid}`, windowMs: 60000, max: rankMax })) return;

  try {
    const body = await readBody(req);
    const platform = body.platform;
    const id = (body.id || "").toString().trim();

    if (!["netease", "qq", "kuwo"].includes(platform)) {
      return json(res, 400, { code: -1, message: "platform must be netease/qq/kuwo" });
    }
    if (!id) {
      return json(res, 400, { code: -1, message: "id is required" });
    }

    const { baseUrl, apiKey } = getEnv();
    if (!apiKey) return json(res, 500, { code: -1, message: "TUNEHUB_API_KEY is missing" });

    const cacheKey = `${platform}|${id}`;
    const { fromCache, value } = await withCache(cache, cacheKey, TTL, async () => {
      const confResp = await fetch(`${baseUrl}/v1/methods/${platform}/toplist`, {
        method: "GET",
        headers: { "X-API-Key": apiKey }
      });
      const confData = await confResp.json();

      if (confData.code !== 0 || !confData.data) {
        return {
          status: 502,
          data: {
            code: -1,
            message: confData.message || "failed to get toplist method config"
          }
        };
      }

      const conf = confData.data;
      const method = (conf.method || "GET").toUpperCase();
      const headers = conf.headers || {};
      const vars = { id };
      const params = deepReplace(conf.params || {}, vars);
      const reqBody = deepReplace(conf.body || {}, vars);

      const url = new URL(conf.url);
      if (method === "GET") {
        url.search = new URLSearchParams(params).toString();
      }

      const upResp = await fetch(url.toString(), {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(reqBody) : undefined
      });

      const ct = upResp.headers.get("content-type") || "";
      const raw = ct.includes("application/json") ? await upResp.json() : await upResp.text();
      const parsedRaw = typeof raw === "string" ? tryParseTextPayload(raw) || raw : raw;
      const transformed =
        typeof parsedRaw === "object" ? tryRunTransform(conf.transform, parsedRaw) || parsedRaw : parsedRaw;

      let songs = typeof transformed === "object" ? normalizeSongs(transformed) : [];
      if ((!songs || songs.length === 0) && typeof parsedRaw === "object") {
        songs = normalizeSongs(parsedRaw);
      }

      return {
        status: 200,
        data: {
          code: 0,
          message: "ok",
          data: {
            platform,
            id,
            count: songs.length,
            songs
          }
        }
      };
    });

    return json(res, value.status || 200, { ...value.data, localCache: fromCache });
  } catch (err) {
    return json(res, 500, { code: -1, message: err?.message || "failed to load toplist songs" });
  }
};

