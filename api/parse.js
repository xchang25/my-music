const { json, readBody, getEnv, getCacheMap, withCache } = require("./_utils");
const { requireAuth, applyRateLimit } = require("./_security");

const TTL = 10 * 60 * 1000;
const cache = getCacheMap("parse");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { code: -1, message: "Method Not Allowed" });

  const session = requireAuth(req, res);
  if (!session) return;

  const parseMax = Number(process.env.RATE_LIMIT_PARSE || 30);
  if (!applyRateLimit(req, res, { keyPrefix: `parse:${session.uid}`, windowMs: 60000, max: parseMax })) return;

  try {
    const { baseUrl, apiKey } = getEnv();
    if (!apiKey) return json(res, 500, { code: -1, message: "服务端未配置 TUNEHUB_API_KEY" });

    const body = await readBody(req);
    const platform = body.platform;
    const ids = (body.ids || "").toString().trim();
    const quality = (body.quality || "320k").toString();

    if (!["netease", "qq", "kuwo"].includes(platform)) {
      return json(res, 400, { code: -1, message: "platform 必须是 netease/qq/kuwo" });
    }
    if (!ids) return json(res, 400, { code: -1, message: "ids 不能为空" });

    const key = `${platform}|${ids}|${quality}`;

    const { fromCache, value } = await withCache(cache, key, TTL, async () => {
      const resp = await fetch(`${baseUrl}/v1/parse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey
        },
        body: JSON.stringify({ platform, ids, quality })
      });

      const data = await resp.json();
      return { status: resp.status, data };
    });

    return json(res, value.status || 200, { ...value.data, localCache: fromCache });
  } catch (err) {
    return json(res, 500, { code: -1, message: err?.message || "服务器错误" });
  }
};

