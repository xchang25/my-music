const fs = require("fs");
const path = require("path");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const root = path.resolve(__dirname, "..");

  const indexHtml = read(path.join(root, "index.html"));
  const appJs = read(path.join(root, "app.js"));
  const apiSearch = read(path.join(root, "api", "search.js"));
  const stylesCss = read(path.join(root, "styles.css"));
  const loginApi = read(path.join(root, "api", "login.js"));
  const apiUtils = read(path.join(root, "api", "_utils.js"));
  const openSearchApi = read(path.join(root, "api", "search_open.js"));
  const packageJson = JSON.parse(read(path.join(root, "package.json")));

  const mustHaveIndex = [
    "id=\"btnSearch\"",
    "id=\"btnPrevPage\"",
    "id=\"btnNextPage\"",
    "id=\"searchPageHint\"",
    "id=\"searchList\"",
    "id=\"recentSearchList\"",
    "id=\"searchLatency\"",
    "id=\"searchCache\"",
    "id=\"rankLatency\"",
    "id=\"rankCache\"",
    "id=\"parseLatency\"",
    "id=\"parseLyricCount\"",
    "id=\"parseCache\"",
    "id=\"btnQueueClear\"",
    "id=\"btnLyricSize\"",
    "id=\"mobileNav\""
  ];

  const mustHaveApp = [
    "AbortController",
    "function api(path",
    "function setObs(",
    "function renderSkeleton(",
    "function buildTimedLyricIndices(",
    "function findLyricIndexByTime(",
    "function buildSearchPlatformOrder(",
    "function summarizeSearchAttempts(",
    "function dedupeSongs(",
    "function doOpenSearchRequest(",
    "function searchSongs()",
    "function renderQueue()",
    "function cycleLyricScale()",
    "function clearRecentSearches()",
    "function moveQueueItem(fromIndex, toIndex)",
    "function toggleMute()"
  ];

  const mustHaveStyles = [
    "--lyric-scale",
    ".obs-row",
    ".parse-obs",
    ".skeleton-card",
    ".empty-ill",
    ".mobile-nav",
    ".queue-item-actions",
    ".queue-now",
    ".lyric-line.past",
    ".lyric-line.upcoming"
  ];

  const mustHaveLoginApi = ["MAX_FAIL_COUNT", "LOCK_MS", "登录失败次数过多"];
  const mustHaveApiUtils = ["data.result.songs", "songInfo", "albumCover"];
  const mustHaveOpenSearchApi = ["itunes.apple.com/search", "directUrl", "search-open:"];
  const mustHaveSearchApi = ["DoSearchForQQMusicLite", "u.y.qq.com/cgi-bin/musicu.fcg", "qq_direct", "item_song"];

  mustHaveIndex.forEach((token) => {
    assert(indexHtml.includes(token), `index.html 缺少关键标记: ${token}`);
  });

  mustHaveApp.forEach((token) => {
    assert(appJs.includes(token), `app.js 缺少关键函数/逻辑: ${token}`);
  });

  mustHaveStyles.forEach((token) => {
    assert(stylesCss.includes(token), `styles.css 缺少关键样式: ${token}`);
  });

  mustHaveLoginApi.forEach((token) => {
    assert(loginApi.includes(token), `api/login.js 缺少关键防护逻辑: ${token}`);
  });

  mustHaveApiUtils.forEach((token) => {
    assert(apiUtils.includes(token), `api/_utils.js 缺少搜索兼容逻辑: ${token}`);
  });

  mustHaveOpenSearchApi.forEach((token) => {
    assert(openSearchApi.includes(token), `api/search_open.js 缺少开放搜索逻辑: ${token}`);
  });

  mustHaveSearchApi.forEach((token) => {
    assert(apiSearch.includes(token), `api/search.js 缺少 QQ 直连搜索逻辑: ${token}`);
  });

  assert(packageJson?.scripts?.check, "package.json 缺少 check 脚本");
  assert(packageJson?.scripts?.["check:syntax"], "package.json 缺少 check:syntax 脚本");
  assert(packageJson?.scripts?.["check:smoke"], "package.json 缺少 check:smoke 脚本");

  console.log("smoke-check: ok");
}

try {
  run();
} catch (error) {
  console.error(`smoke-check: fail - ${error.message}`);
  process.exit(1);
}
