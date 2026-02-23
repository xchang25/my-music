const crypto = require("crypto");
const { json, readBody } = require("./_utils");
const {
  safeEqualString,
  createSessionToken,
  setSessionCookie,
  applyRateLimit,
  getClientIp
} = require("./_security");

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

  if (!safeEqualString(password, appPassword)) {
    return json(res, 401, { code: 401, message: "密码错误" });
  }

  const ip = getClientIp(req);
  const uid = crypto.createHash("sha1").update(ip).digest("hex").slice(0, 12);
  const token = createSessionToken({ uid, role: "user" }, sessionSecret, 7 * 24 * 3600);
  setSessionCookie(res, token, 7 * 24 * 3600);

  return json(res, 200, { code: 0, message: "登录成功" });
};

