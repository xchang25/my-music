const {
  json,
  readBody,
  toInt,
  getEnv,
  deepReplace,
  tryRunTransform,
  normalizeSongs,
  getCacheMap,
  withCache
} = require("./_utils");
const { requireAuth, applyRateLimit } = require("./_security");

const TTL = 3 * 60 * 1000;
const cache = getCacheMap("search");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { code: -1, message: "Method Not Allowed" });

  const session = requireAuth(req, res);
  if (!session) return;

  const searchMax = Number(process.env.RATE_LIMIT_SEARCH || 60);
  if (!applyRateLimit(req, res, { keyPrefix: `search:${session.uid}`, windowMs: 60000, max: searchMax })) return;

  try {
    const { baseUrl, apiKey } = getEnv();
    if (!apiKey) return json(res, 500, { code: -1, message: "服务端未配置 TUNEHUB_API_KEY" });

    const body = await readBody(req);
    const platform = body.platform;
    const keyword = (body.keyword || "").toString().trim();
    const page = toInt(body.page, 0);
    const pageSize = toInt(body.pageSize, 20);

    if (!["netease", "qq", "kuwo"].includes(platform)) {
      return json(res, 400, { code: -1, message: "platform 必须是 netease/qq/kuwo" });
    }
    if (!keyword) return json(res, 400, { code: -1, message: "keyword 不能为空" });

    const key = `${platform}|${keyword}|${page}|${pageSize}`;

    const { fromCache, value } = await withCache(cache, key, TTL, async () => {
      const confResp = await fetch(`${baseUrl}/v1/methods/${platform}/search`, {
        method: "GET",
        headers: { "X-API-Key": apiKey }
      });
      const confData = await confResp.json();

      if (confData.code !== 0 || !confData.data) {
        return { status: 502, data: { code: -1, message: confData.message || "获取方法配置失败" } };
      }

      const conf = confData.data;
      const vars = { keyword, page, pageSize };
      const method = (conf.method || "GET").toUpperCase();
      const headers = conf.headers || {};
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
      const transformed = typeof raw === "object" ? tryRunTransform(conf.transform, raw) || raw : raw;
      const songs = typeof transformed === "object" ? normalizeSongs(transformed) : [];

      return {
        status: 200,
        data: {
          code: 0,
          message: "ok",
          data: { platform, keyword, page, pageSize, count: songs.length, songs }
        }
      };
    });

    return json(res, value.status || 200, { ...value.data, localCache: fromCache });
  } catch (err) {
    return json(res, 500, { code: -1, message: err?.message || "搜索失败" });
  }
};

