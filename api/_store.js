const KEY_PREFIX = process.env.LIBRARY_KEY_PREFIX || "qmusichub";

function getMode() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  if (url && token) return "redis";
  return "memory";
}

function getRedisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
  return { url, token };
}

function getMemoryMap() {
  if (!globalThis.__QMUSIC_MEMORY_STORE__) {
    globalThis.__QMUSIC_MEMORY_STORE__ = new Map();
  }
  return globalThis.__QMUSIC_MEMORY_STORE__;
}

function buildKey(uid) {
  return `${KEY_PREFIX}:library:${uid}`;
}

async function redisCommand(args) {
  const { url, token } = getRedisConfig();
  if (!url || !token) {
    throw new Error("Redis not configured");
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `redis http ${response.status}`);
  }
  if (payload?.error) {
    throw new Error(payload.error);
  }
  return payload?.result;
}

async function getLibrary(uid) {
  const key = buildKey(uid);

  if (getMode() === "redis") {
    try {
      const raw = await redisCommand(["GET", key]);
      if (!raw) return null;
      if (typeof raw === "string") return JSON.parse(raw);
      return raw;
    } catch {
      return null;
    }
  }

  const map = getMemoryMap();
  return map.get(key) || null;
}

async function setLibrary(uid, value, ttlSeconds = 180 * 24 * 3600) {
  const key = buildKey(uid);

  if (getMode() === "redis") {
    const serialized = JSON.stringify(value || {});
    await redisCommand(["SET", key, serialized, "EX", String(Math.max(60, Number(ttlSeconds) || 60))]);
    return;
  }

  const map = getMemoryMap();
  map.set(key, value || {});
}

module.exports = {
  getMode,
  getLibrary,
  setLibrary
};
