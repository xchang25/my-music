const {
  json,
  readBody,
  getEnv,
  deepReplace,
  tryRunTransform,
  tryParseTextPayload,
  getCacheMap,
  withCache
} = require("./_utils");
const { requireAuth, applyRateLimit } = require("./_security");

const TTL = 5 * 60 * 1000;
const cache = getCacheMap("toplists");

function pick(obj, paths) {
  for (const path of paths) {
    const keys = path.split(".");
    let cur = obj;
    let ok = true;
    for (const key of keys) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, key)) {
        cur = cur[key];
      } else {
        ok = false;
        break;
      }
    }
    if (ok && cur != null) return cur;
  }
  return null;
}

function pickFirstArray(obj, paths) {
  for (const path of paths) {
    const value = pick(obj, [path]);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function normalizeToplists(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : pickFirstArray(raw, [
        "data.data",
        "data.list",
        "data.toplist",
        "data.toplists",
        "data.topList",
        "data",
        "list",
        "toplist",
        "toplists",
        "result.list"
      ]);

  return (arr || [])
    .map((item, index) => {
      const id =
        item.id ||
        item.topid ||
        item.topId ||
        item.listid ||
        item.sourceid ||
        item.rid ||
        item.rankid ||
        item.type ||
        String(index + 1);

      const name =
        item.name ||
        item.title ||
        item.topTitle ||
        item.listname ||
        item.top_name ||
        `榜单 ${index + 1}`;

      const cover = item.cover || item.pic || item.img || item.albumPic || item.picurl || "";
      const update =
        item.updateTime ||
        item.update_time ||
        item.period ||
        item.pubDate ||
        item.listenCount ||
        "";

      const desc = item.description || item.intro || item.info || item.comment || "";

      return {
        id: String(id),
        name: String(name),
        cover: String(cover),
        update: String(update),
        desc: String(desc)
      };
    })
    .filter((item) => item.id && item.name);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { code: -1, message: "Method Not Allowed" });

  const session = requireAuth(req, res);
  if (!session) return;

  const rankMax = Number(process.env.RATE_LIMIT_RANK || process.env.RATE_LIMIT_SEARCH || 60);
  if (!applyRateLimit(req, res, { keyPrefix: `toplists:${session.uid}`, windowMs: 60000, max: rankMax })) return;

  try {
    const body = await readBody(req);
    const platform = body.platform;

    if (!["netease", "qq", "kuwo"].includes(platform)) {
      return json(res, 400, { code: -1, message: "platform must be netease/qq/kuwo" });
    }

    const { baseUrl, apiKey } = getEnv();
    if (!apiKey) return json(res, 500, { code: -1, message: "TUNEHUB_API_KEY is missing" });

    const cacheKey = `${platform}`;
    const { fromCache, value } = await withCache(cache, cacheKey, TTL, async () => {
      const confResp = await fetch(`${baseUrl}/v1/methods/${platform}/toplists`, {
        method: "GET",
        headers: { "X-API-Key": apiKey }
      });
      const confData = await confResp.json();

      if (confData.code !== 0 || !confData.data) {
        return {
          status: 502,
          data: {
            code: -1,
            message: confData.message || "failed to get toplists method config"
          }
        };
      }

      const conf = confData.data;
      const method = (conf.method || "GET").toUpperCase();
      const headers = conf.headers || {};
      const params = deepReplace(conf.params || {}, {});
      const reqBody = deepReplace(conf.body || {}, {});

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

      let list = typeof transformed === "object" ? normalizeToplists(transformed) : [];
      if ((!list || list.length === 0) && typeof parsedRaw === "object") {
        list = normalizeToplists(parsedRaw);
      }

      return {
        status: 200,
        data: {
          code: 0,
          message: "ok",
          data: {
            platform,
            count: list.length,
            toplists: list
          }
        }
      };
    });

    return json(res, value.status || 200, { ...value.data, localCache: fromCache });
  } catch (err) {
    return json(res, 500, { code: -1, message: err?.message || "failed to load toplists" });
  }
};

