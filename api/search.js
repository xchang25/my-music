const {
  json,
  readBody,
  toInt,
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
    const debug = !!body.debug;

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
      const method = (conf.method || "GET").toUpperCase();
      const headers = conf.headers || {};

      let resolvedUrl = "";
      try {
        resolvedUrl = new URL(conf.url).toString();
      } catch {
        resolvedUrl = new URL(String(conf.url || ""), baseUrl).toString();
      }

      const runSearchOnce = async (pageValue) => {
        const vars = { keyword, page: pageValue, pageSize };
        const params = deepReplace(conf.params || {}, vars);
        const reqBody = deepReplace(conf.body || {}, vars);

        const url = new URL(resolvedUrl);
        Object.entries(params || {}).forEach(([key, value]) => {
          if (value === undefined || value === null || value === "") return;
          url.searchParams.set(key, String(value));
        });

        const reqHeaders = { ...(headers || {}) };
        const requestInit = {
          method,
          headers: reqHeaders
        };

        if (method === "POST") {
          const ctPair = Object.entries(reqHeaders).find(([k]) => k.toLowerCase() === "content-type");
          const ct = String(ctPair?.[1] || "").toLowerCase();

          if (typeof reqBody === "string") {
            requestInit.body = reqBody;
          } else if (ct.includes("application/x-www-form-urlencoded")) {
            requestInit.body = new URLSearchParams(reqBody || {}).toString();
          } else {
            if (!ct) reqHeaders["Content-Type"] = "application/json";
            requestInit.body = JSON.stringify(reqBody || {});
          }
        }

        const upResp = await fetch(url.toString(), requestInit);
        const ct = upResp.headers.get("content-type") || "";
        const raw = ct.includes("application/json") ? await upResp.json() : await upResp.text();
        const parsedRaw = typeof raw === "string" ? tryParseTextPayload(raw) || raw : raw;
        const transformed =
          typeof parsedRaw === "object" ? tryRunTransform(conf.transform, parsedRaw) || parsedRaw : parsedRaw;

        let songs = typeof transformed === "object" ? normalizeSongs(transformed) : [];
        if ((!songs || songs.length === 0) && typeof parsedRaw === "object") {
          songs = normalizeSongs(parsedRaw);
        }

        return { upResp, ct, raw, parsedRaw, transformed, songs, pageValue, url };
      };

      let result = await runSearchOnce(page);
      if ((!result.songs || result.songs.length === 0) && page >= 1) {
        const alt = await runSearchOnce(page - 1);
        if (alt.songs && alt.songs.length > 0) {
          result = alt;
        }
      }

      const { upResp, ct, raw, parsedRaw, transformed, songs, pageValue, url } = result;

      return {
        status: 200,
        data: {
          code: 0,
          message: "ok",
          data: {
            platform,
            keyword,
            page: pageValue,
            pageSize,
            count: songs.length,
            songs,
            ...(debug
              ? {
                  upstream: {
                    status: upResp.status,
                    contentType: ct,
                    url: url.toString(),
                    method
                  },
                  parseHint: {
                    rawType: typeof raw,
                    parsedType: typeof parsedRaw,
                    transformedType: typeof transformed
                  }
                }
              : {})
          }
        }
      };
    });

    return json(res, value.status || 200, { ...value.data, localCache: fromCache });
  } catch (err) {
    return json(res, 500, { code: -1, message: err?.message || "搜索失败" });
  }
};
