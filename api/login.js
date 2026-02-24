const crypto = require("crypto");
const { json, readBody } = require("./_utils");
const {
  safeEqualString,
  createSessionToken,
  setSessionCookie,
  applyRateLimit,
  getClientIp
} = require("./_security");

const FAIL_WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const MAX_FAIL_COUNT = 5;

function getLoginFailMap() {
  if (!globalThis.__LOGIN_FAIL_MAP__) globalThis.__LOGIN_FAIL_MAP__ = new Map();
  return globalThis.__LOGIN_FAIL_MAP__;
}

function purgeExpiredFails(map) {
  const now = Date.now();
  for (const [key, item] of map.entries()) {
    if (!item) {
      map.delete(key);
      continue;
    }
    if (item.lockUntil && item.lockUntil > now) continue;
    if (!item.lastAt || now - item.lastAt > FAIL_WINDOW_MS) {
      map.delete(key);
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { code: -1, message: "Method Not Allowed" });

  const loginMax = Number(process.env.RATE_LIMIT_LOGIN || 10);
  if (!applyRateLimit(req, res, { keyPrefix: "login", windowMs: 60000, max: loginMax })) return;

  const appPassword = process.env.APP_PASSWORD || "";
  const sessionSecret = process.env.SESSION_SECRET || "";
  if (!appPassword || !sessionSecret) {
    return json(res, 500, { code: -1, message: "服务端未配置 APP_PASSWORD/SESSION_SECRET" });
  }

  const body = await readBody(req);
  const password = body.password || "";
  const ip = getClientIp(req);

  const failMap = getLoginFailMap();
  purgeExpiredFails(failMap);
  const failRecord = failMap.get(ip);
  const now = Date.now();

  if (failRecord?.lockUntil && failRecord.lockUntil > now) {
    const remainSec = Math.ceil((failRecord.lockUntil - now) / 1000);
    return json(res, 429, {
      code: 429,
      message: `登录失败次数过多，请 ${remainSec} 秒后重试`
    });
  }

  if (!safeEqualString(password, appPassword)) {
    const prev = failRecord?.lastAt && now - failRecord.lastAt <= FAIL_WINDOW_MS ? failRecord.count || 0 : 0;
    const count = prev + 1;
    const next = {
      count,
      lastAt: now,
      lockUntil: count >= MAX_FAIL_COUNT ? now + LOCK_MS : 0
    };
    failMap.set(ip, next);

    if (next.lockUntil > now) {
      const remainSec = Math.ceil((next.lockUntil - now) / 1000);
      return json(res, 429, {
        code: 429,
        message: `密码错误次数过多，请 ${remainSec} 秒后重试`
      });
    }

    return json(res, 401, { code: 401, message: "密码错误" });
  }

  failMap.delete(ip);
  const uid = crypto.createHash("sha1").update(ip).digest("hex").slice(0, 12);
  const token = createSessionToken({ uid, role: "user" }, sessionSecret, 7 * 24 * 3600);
  setSessionCookie(res, token, 7 * 24 * 3600);

  return json(res, 200, { code: 0, message: "登录成功" });
};
