const crypto = require("crypto");
const { json } = require("./_utils");

const SESSION_COOKIE = "th_session";

function parseCookies(req) {
  const cookieHeader = req.headers.cookie || "";
  const pairs = cookieHeader
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const out = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx <= 0) continue;
    const k = pair.slice(0, idx);
    const v = pair.slice(idx + 1);
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function getClientIp(req) {
  const xf = req.headers["x-forwarded-for"];
  if (typeof xf === "string" && xf.length) return xf.split(",")[0].trim();
  return req.socket?.remoteAddress || "0.0.0.0";
}

function safeEqualString(a, b) {
  const ab = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function sign(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function createSessionToken(payload, secret, maxAgeSec = 7 * 24 * 3600) {
  const body = {
    ...payload,
    exp: Date.now() + maxAgeSec * 1000
  };
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = sign(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

function verifySessionToken(token, secret) {
  try {
    if (!token || !secret) return null;
    const [payloadB64, sig] = token.split(".");
    if (!payloadB64 || !sig) return null;

    const expected = sign(payloadB64, secret);
    const sb = Buffer.from(sig);
    const eb = Buffer.from(expected);
    if (sb.length !== eb.length) return null;
    if (!crypto.timingSafeEqual(sb, eb)) return null;

    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function setSessionCookie(res, token, maxAgeSec = 7 * 24 * 3600) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
  res.setHeader("Set-Cookie", cookie);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const cookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  res.setHeader("Set-Cookie", cookie);
}

function getSession(req) {
  const secret = process.env.SESSION_SECRET || "";
  if (!secret) return null;
  const token = parseCookies(req)[SESSION_COOKIE];
  return verifySessionToken(token, secret);
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { code: 401, message: "请先登录" });
    return null;
  }
  return session;
}

function getRateMap() {
  if (!globalThis.__RATE_LIMIT_MAP__) globalThis.__RATE_LIMIT_MAP__ = new Map();
  return globalThis.__RATE_LIMIT_MAP__;
}

function applyRateLimit(req, res, { keyPrefix = "global", windowMs = 60000, max = 30 } = {}) {
  const map = getRateMap();
  const ip = getClientIp(req);
  const slot = Math.floor(Date.now() / windowMs);
  const key = `${keyPrefix}|${ip}|${slot}`;

  const count = (map.get(key) || 0) + 1;
  map.set(key, count);

  if (map.size > 5000) {
    for (const k of map.keys()) {
      if (!k.endsWith(`|${slot}`) && !k.endsWith(`|${slot - 1}`)) map.delete(k);
    }
  }

  res.setHeader("X-RateLimit-Limit", String(max));
  res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - count)));

  if (count > max) {
    res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
    json(res, 429, { code: 429, message: "请求过于频繁，请稍后再试" });
    return false;
  }
  return true;
}

module.exports = {
  getClientIp,
  safeEqualString,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSession,
  requireAuth,
  applyRateLimit
};

