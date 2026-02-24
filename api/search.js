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
      const normalizeQQDirectSongs = (raw) => {
        const list =
          raw?.req?.data?.body?.song?.list ||
          raw?.req?.data?.body?.song?.itemlist ||
          raw?.req_1?.data?.body?.song?.list ||
          [];

        if (!Array.isArray(list)) return [];

        return list
          .map((item) => {
            const id = item?.mid || item?.songmid || item?.id || "";
            const name = item?.name || item?.songname || item?.title || "";
            const singerList = Array.isArray(item?.singer) ? item.singer : [];
            const artist = singerList
              .map((entry) => (typeof entry === "string" ? entry : entry?.name || entry?.title || ""))
              .filter(Boolean)
              .join("/");
            const albumMid = item?.album?.mid || item?.albummid || "";
            const album = item?.album?.name || item?.albumname || "";
            const cover = albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "";

            return {
              id: String(id),
              name: String(name),
              artist: String(artist),
              album: String(album),
              cover: String(cover)
            };
          })
          .filter((song) => song.id && song.name);
      };

      const runQQDirectSearchOnce = async (pageValue) => {
        const pageNum = Math.max(1, toInt(pageValue, 1));
        const payload = {
          comm: {
            ct: 11,
            cv: "1003006",
            v: "1003006",
            os_ver: "12",
            phonetype: "0",
            devicelevel: "31",
            tmeAppID: "qqmusiclight",
            nettype: "NETWORK_WIFI"
          },
          req: {
            module: "music.search.SearchCgiService",
            method: "DoSearchForQQMusicLite",
            param: {
              query: keyword,
              search_type: 0,
              num_per_page: pageSize,
              page_num: pageNum,
              nqc_flag: 0,
              grp: 1
            }
          }
        };

        const endpoint = "https://u.y.qq.com/cgi-bin/musicu.fcg";
        const upResp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; WOW64; Trident/5.0)"
          },
          body: JSON.stringify(payload)
        });

        const ct = upResp.headers.get("content-type") || "";
        const raw = ct.includes("application/json") ? await upResp.json() : await upResp.text();
        const parsedRaw = typeof raw === "string" ? tryParseTextPayload(raw) || raw : raw;
        const songs = typeof parsedRaw === "object" ? normalizeQQDirectSongs(parsedRaw) : [];

        return {
          upResp,
          ct,
          raw,
          parsedRaw,
          transformed: parsedRaw,
          songs,
          pageValue: pageNum,
          url: new URL(endpoint),
          method: "POST",
          source: "qq_direct"
        };
      };

      if (platform === "qq") {
        let directResult = await runQQDirectSearchOnce(page);
        if ((!directResult.songs || directResult.songs.length === 0) && page >= 1) {
          const alt = await runQQDirectSearchOnce(page - 1);
          if (alt.songs && alt.songs.length > 0) {
            directResult = alt;
          }
        }

        if (directResult.songs && directResult.songs.length > 0) {
          const { upResp, ct, raw, parsedRaw, transformed, songs, pageValue, url, method, source } = directResult;
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
                        method,
                        source
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
        }
      }

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
