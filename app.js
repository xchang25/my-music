const $ = (id) => document.getElementById(id);

const platformText = {
  netease: "网易云",
  qq: "QQ音乐",
  kuwo: "酷我",
  itunes: "iTunes"
};

const playModes = [
  { key: "order", label: "顺序" },
  { key: "loop", label: "循环" },
  { key: "single", label: "单曲" },
  { key: "shuffle", label: "随机" }
];

const lyricScales = [
  { label: "小", value: 0.9 },
  { label: "中", value: 1 },
  { label: "大", value: 1.14 },
  { label: "超大", value: 1.28 }
];

const state = {
  loggedIn: false,
  view: "discover",
  theme: localStorage.getItem("theme") || "dark",
  quality: localStorage.getItem("quality") || "320k",
  currentSong: null,
  favorites: JSON.parse(localStorage.getItem("favSongs") || "[]"),
  history: JSON.parse(localStorage.getItem("hisSongs") || "[]"),
  recentSearches: JSON.parse(localStorage.getItem("recentSearches") || "[]"),
  searchResults: [],
  toplists: [],
  activeToplistId: "",
  toplistSongs: [],
  queue: [],
  queueIndex: -1,
  playModeIndex: 0,
  lyricLines: [],
  lyricTimedIndices: [],
  lyricActiveIndex: -1,
  lyricWordActiveIndex: -1,
  lyricAutoScroll: true,
  lyricFullscreen: false,
  resolveCache: {},
  isScrubbing: false,
  drawerOpen: false,
  playerIdle: false,
  playerIdleTimer: null,
  progressHover: false,
  progressHoverSince: 0,
  searchToken: 0,
  lyricScaleIndex: Number(localStorage.getItem("lyricScaleIndex") || 1),
  lastVolume: 0.9,
  touchStartY: null
};

const audio = $("playerAudio");

function saveState() {
  localStorage.setItem("favSongs", JSON.stringify(state.favorites));
  localStorage.setItem("hisSongs", JSON.stringify(state.history));
  localStorage.setItem("recentSearches", JSON.stringify(state.recentSearches));
  localStorage.setItem("theme", state.theme);
  localStorage.setItem("quality", state.quality);
  localStorage.setItem("lyricScaleIndex", String(state.lyricScaleIndex));
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value || "";
}

function setMsg(id, value) {
  setText(id, value);
}

function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "-";
  return `${Math.round(ms)}ms`;
}

function setObs(prefix, { latency = null, count = 0, cache = null } = {}) {
  const safeCount = String(count || 0);
  setText(`${prefix}Latency`, formatLatency(latency));
  setText(`${prefix}Count`, safeCount);
  setText(`${prefix}LyricCount`, safeCount);
  setText(`${prefix}Cache`, cache == null ? "-" : cache ? "命中" : "未命中");
}

function buildTimedLyricIndices(lines) {
  if (!Array.isArray(lines) || !lines.length) return [];
  const points = [];
  lines.forEach((line, idx) => {
    if (typeof line?.time === "number") {
      points.push({ idx, time: line.time });
    }
  });
  return points;
}

function findLyricIndexByTime(time) {
  const points = state.lyricTimedIndices;
  if (!points.length) return -1;

  const target = time + 0.05;
  let left = 0;
  let right = points.length - 1;
  let best = -1;

  while (left <= right) {
    const mid = (left + right) >> 1;
    if (points[mid].time <= target) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return best >= 0 ? points[best].idx : -1;
}

function renderSkeleton(containerId, count = 6) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = "";
  const total = Math.max(1, count);
  for (let index = 0; index < total; index += 1) {
    const node = document.createElement("div");
    node.className = "skeleton-card";
    node.innerHTML = `
      <div class="sk-line w-60"></div>
      <div class="sk-line w-40"></div>
    `;
    container.appendChild(node);
  }
}

function setLyricScale(index) {
  const safeIndex = Number.isFinite(index) ? Math.max(0, Math.min(lyricScales.length - 1, index)) : 1;
  state.lyricScaleIndex = safeIndex;
  const current = lyricScales[state.lyricScaleIndex] || lyricScales[1];
  document.documentElement.style.setProperty("--lyric-scale", String(current.value));
  const btn = $("btnLyricSize");
  if (btn) btn.textContent = `歌词字号：${current.label}`;
  saveState();
}

function cycleLyricScale() {
  const next = (state.lyricScaleIndex + 1) % lyricScales.length;
  setLyricScale(next);
}

function normalizeRecentSearches(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => ({
      keyword: String(entry?.keyword || "").trim(),
      platform: String(entry?.platform || "netease").trim()
    }))
    .filter((entry) => entry.keyword && ["netease", "qq", "kuwo"].includes(entry.platform));
}

function renderRecentSearches() {
  const container = $("recentSearchList");
  if (!container) return;
  const clearBtn = $("btnClearRecent");

  const list = normalizeRecentSearches(state.recentSearches);
  if (!list.length) {
    if (clearBtn) clearBtn.disabled = true;
    container.innerHTML = `<div class=\"tips\">暂无历史关键词</div>`;
    return;
  }

  if (clearBtn) clearBtn.disabled = false;

  container.innerHTML = "";
  list.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip recent-chip";
    button.textContent = `${item.keyword} · ${platformText[item.platform] || item.platform}`;
    button.addEventListener("click", () => {
      const platform = $("searchPlatform");
      const keyword = $("keyword");
      const page = $("page");
      if (platform) platform.value = item.platform;
      if (keyword) keyword.value = item.keyword;
      if (page) page.value = "1";
      setView("search");
      searchSongs();
    });
    container.appendChild(button);
  });
}

function addRecentSearch(keyword, platform) {
  const key = String(keyword || "").trim();
  if (!key) return;

  const next = normalizeRecentSearches(state.recentSearches).filter(
    (item) => !(item.keyword === key && item.platform === platform)
  );
  next.unshift({ keyword: key, platform });
  state.recentSearches = next.slice(0, 10);
  saveState();
  renderRecentSearches();
}

function clearRecentSearches() {
  state.recentSearches = [];
  saveState();
  renderRecentSearches();
}

function dedupeSongs(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((song) => {
    const key = `${song?.platform || "unknown"}|${song?.id || ""}`;
    if (!song?.id || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildSearchPlatformOrder(selectedPlatform) {
  const all = ["netease", "qq", "kuwo"];
  const selected = all.includes(selectedPlatform) ? selectedPlatform : "netease";
  return [selected, ...all.filter((name) => name !== selected)];
}

function summarizeSearchAttempts(attempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  if (!list.length) return "";
  return list
    .map((item) => {
      const platform = platformText[item.platform] || item.platform;
      const pageText = Number.isFinite(item.page) ? `P${item.page}` : "";
      if (item.status === 200 && item.code === 0) return `${platform}${pageText}:${item.count}`;
      if (item.status === 429) return `${platform}:限流`;
      if (item.status === 401) return `${platform}:未授权`;
      if (item.status > 0) return `${platform}:失败`;
      return `${platform}:异常`;
    })
    .join(" / ");
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || "").toUpperCase();
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function setButtonLoading(id, pending, loadingText = "处理中...") {
  const btn = $(id);
  if (!btn) return;
  if (pending) {
    if (!btn.dataset.normalText) btn.dataset.normalText = btn.textContent || "";
    btn.dataset.wasDisabled = btn.disabled ? "1" : "0";
    btn.textContent = loadingText;
    btn.disabled = true;
  } else {
    btn.textContent = btn.dataset.normalText || btn.textContent || "";
    const needAuth = id === "btnSearch" || id === "btnLoadToplists";
    btn.disabled = (!state.loggedIn && needAuth) || btn.dataset.wasDisabled === "1";
  }
}

function setCover(elId, url) {
  const node = $(elId);
  if (!node) return;
  if (url) {
    node.style.backgroundImage = `url(${url})`;
    node.classList.add("has");
    node.textContent = "";
  } else {
    node.style.backgroundImage = "";
    node.classList.remove("has");
    node.textContent = "♫";
  }
}

function setTheme(theme) {
  state.theme = theme;
  if (theme === "light") document.body.classList.add("light");
  else document.body.classList.remove("light");
  saveState();
}

function setDrawerOpen(open) {
  state.drawerOpen = !!open;
  const player = document.querySelector(".player");
  if (!player) return;
  player.classList.toggle("open", state.drawerOpen);
  const btn = $("btnDrawer");
  if (btn) btn.textContent = state.drawerOpen ? "收起" : "展开";
}

function setPlayerIdle(idle) {
  state.playerIdle = !!idle;
  const player = document.querySelector(".player");
  if (!player) return;
  player.classList.toggle("idle", state.playerIdle);
}

function schedulePlayerIdle() {
  if (window.innerWidth <= 760) return;
  if (state.playerIdleTimer) clearTimeout(state.playerIdleTimer);
  state.playerIdleTimer = setTimeout(() => {
    if (state.progressHover && Date.now() - state.progressHoverSince > 1800) {
      state.progressHover = false;
    }
    if (!state.isScrubbing && !state.progressHover) setPlayerIdle(true);
    else schedulePlayerIdle();
  }, 2600);
}

function wakePlayer() {
  if (state.playerIdleTimer) clearTimeout(state.playerIdleTimer);
  setPlayerIdle(false);
  schedulePlayerIdle();
}

function focusLyricsArea() {
  const lyricsCard = $("lyricsCard");
  if (!lyricsCard) return;

  lyricsCard.classList.add("focused");
  setTimeout(() => lyricsCard.classList.remove("focused"), 1200);

  if (window.innerWidth <= 1120) {
    lyricsCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  if (window.innerWidth <= 760) {
    setDrawerOpen(true);
  }
}

function setLyricFsCover(url) {
  const node = $("lyricFsBg");
  if (!node) return;
  if (url) {
    node.style.backgroundImage = `url(${url})`;
    node.classList.add("has");
  } else {
    node.style.backgroundImage = "";
    node.classList.remove("has");
  }
}

function setPlayPauseUI(isPlaying) {
  const btn = $("btnPlayPause");
  if (!btn) return;
  btn.textContent = isPlaying ? "⏸" : "▶";
  btn.title = isPlaying ? "暂停" : "播放";
  btn.setAttribute("aria-label", isPlaying ? "暂停" : "播放");
}

function toggleMute() {
  const volume = $("volume");
  if (!volume) return;

  if (audio.volume > 0.001) {
    state.lastVolume = audio.volume;
    audio.volume = 0;
    volume.value = "0";
  } else {
    const nextVolume = Number(state.lastVolume || 0.9);
    audio.volume = nextVolume;
    volume.value = String(nextVolume);
  }
}

function animateCoverTransition() {
  ["coverMini", "coverBar", "lyricFsBg"].forEach((id) => {
    const node = $(id);
    if (!node) return;
    node.classList.remove("cover-anim");
    void node.offsetWidth;
    node.classList.add("cover-anim");
  });
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setLyricFullscreen(open) {
  state.lyricFullscreen = !!open;
  const layer = $("lyricFullscreen");
  if (!layer) return;

  renderLyrics(state.lyricLines);
  setActiveLyric(state.lyricActiveIndex, state.lyricWordActiveIndex);

  layer.classList.toggle("open", state.lyricFullscreen);
  layer.setAttribute("aria-hidden", state.lyricFullscreen ? "false" : "true");
  document.body.style.overflow = state.lyricFullscreen ? "hidden" : "";
  const btn = $("btnLyricFullscreen");
  if (btn) btn.textContent = state.lyricFullscreen ? "退出全屏" : "歌词全屏";
}

function setAuthUI() {
  setText("authState", state.loggedIn ? "✅ 已登录" : "❌ 未登录");
  setText("topAuthBadge", state.loggedIn ? "已登录" : "未登录");
  $("authDot")?.classList.toggle("online", state.loggedIn);

  ["btnSearch", "btnLoadToplists"].forEach((id) => {
    const btn = $(id);
    if (btn) btn.disabled = !state.loggedIn;
  });
}

function setView(view) {
  state.view = view;
  ["discover", "search", "rank", "library"].forEach((name) => {
    const panel = $(`panel-${name}`);
    if (panel) panel.classList.toggle("hidden", name !== view);
  });
  document.querySelectorAll(".menu-btn, .mobile-nav-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });

  if (window.innerWidth <= 1120) {
    document.querySelector(".main")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function api(path, { method = "GET", body } = {}) {
  const controller = new AbortController();
  const timeoutMs = 12000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const options = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  try {
    const response = await fetch(path, options);
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    return { status: response.status, ok: response.ok, data };
  } catch (error) {
    const aborted = error?.name === "AbortError";
    return {
      status: 0,
      ok: false,
      data: {
        code: -1,
        message: aborted ? `请求超时（>${timeoutMs / 1000}s）` : `网络异常：${error?.message || "未知错误"}`
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function onUnauthorized() {
  state.loggedIn = false;
  setAuthUI();
  setMsg("authState", "登录已失效，请重新登录");
}

async function checkMe() {
  try {
    const { data } = await api("/api/me");
    state.loggedIn = !!data.loggedIn;
  } catch {
    state.loggedIn = false;
  }
  setAuthUI();
}

async function doLogin() {
  const password = ($("password")?.value || "").trim();
  if (!password) {
    setMsg("authState", "请输入登录密码");
    return;
  }

  const { status, data } = await api("/api/login", { method: "POST", body: { password } });
  if (status === 200 && data.code === 0) {
    state.loggedIn = true;
    setAuthUI();
    setMsg("authState", "登录成功");
    $("password").value = "";
  } else {
    state.loggedIn = false;
    setAuthUI();
    setMsg("authState", data.message || "登录失败");
  }
}

async function doLogout() {
  await api("/api/logout", { method: "POST" });
  state.loggedIn = false;
  setAuthUI();
  setMsg("authState", "已退出登录");
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function songKey(song) {
  return `${song.platform}|${song.id}`;
}

function addFavorite(song) {
  if (!song) return;
  if (state.favorites.some((item) => songKey(item) === songKey(song))) return;
  state.favorites.unshift({ ...song });
  saveState();
  renderFavorites();
}

function removeFavorite(song) {
  state.favorites = state.favorites.filter((item) => songKey(item) !== songKey(song));
  saveState();
  renderFavorites();
}

function addHistory(song) {
  state.history = [{ ...song }, ...state.history.filter((item) => songKey(item) !== songKey(song))].slice(0, 80);
  saveState();
  renderHistory();
}

function renderSongList(containerId, songs, { showFav = false, showUnfav = false, emptyText = "暂无数据" } = {}) {
  const container = $(containerId);
  if (!container) return;

  container.innerHTML = "";
  if (!songs.length) {
    container.innerHTML = `<div class=\"empty\"><div class=\"empty-ill\">🎵</div>${emptyText}</div>`;
    return;
  }

  songs.forEach((song, idx) => {
    const node = document.createElement("div");
    node.className = "song-item";

    const cover = song.cover
      ? `<div class="song-cover has" style="background-image:url('${song.cover.replace(/'/g, "\\'")}')"></div>`
      : `<div class="song-cover">♫</div>`;

    node.innerHTML = `
      ${cover}
      <div>
        <div class="song-name">${song.name || "未知歌曲"}</div>
        <div class="song-meta">${song.artist || "未知歌手"} · ${platformText[song.platform] || song.platform || "未知"} · ID ${song.id}</div>
      </div>
      <div class="song-actions">
        <button class="play" data-action="play" data-idx="${idx}">播放</button>
        <button data-action="queue" data-idx="${idx}">队列</button>
        ${showFav ? `<button data-action="fav" data-idx="${idx}">收藏</button>` : ""}
        ${showUnfav ? `<button data-action="unfav" data-idx="${idx}">取消</button>` : ""}
      </div>
    `;

    node.querySelectorAll("button[data-action]").forEach((button) => {
      button.onclick = () => {
        const action = button.dataset.action;
        const target = songs[Number(button.dataset.idx)];
        if (!target) return;

        if (action === "play") {
          setQueueAndPlay(songs, Number(button.dataset.idx));
        } else if (action === "queue") {
          enqueueSong(target);
        } else if (action === "fav") {
          addFavorite(target);
        } else if (action === "unfav") {
          removeFavorite(target);
        }
      };
    });

    container.appendChild(node);
  });
}

function renderFavorites() {
  renderSongList("favList", state.favorites, {
    showUnfav: true,
    emptyText: "还没有收藏歌曲"
  });
}

function renderHistory() {
  renderSongList("hisList", state.history, {
    showFav: true,
    emptyText: "还没有播放历史"
  });
}

function renderToplists() {
  const container = $("toplistList");
  if (!container) return;
  container.innerHTML = "";

  if (!state.toplists.length) {
    container.innerHTML = `<div class=\"empty\"><div class=\"empty-ill\">🏆</div>暂无榜单，请点击加载</div>`;
    return;
  }

  state.toplists.forEach((item) => {
    const node = document.createElement("div");
    node.className = `rank-item ${state.activeToplistId === item.id ? "active" : ""}`;
    node.innerHTML = `
      <div class="rank-name">${item.name}</div>
      <div class="rank-meta">${item.update || ""}</div>
      <div class="rank-meta">${item.desc || ""}</div>
    `;
    node.onclick = () => loadToplistSongs(item);
    container.appendChild(node);
  });
}

function renderTopSongs() {
  renderSongList("topSongList", state.toplistSongs, {
    showFav: true,
    emptyText: "暂无榜单歌曲"
  });
}

function renderQueue() {
  const container = $("queueList");
  if (!container) return;
  container.innerHTML = "";
  setText("queueCount", String(state.queue.length));
  const clearBtn = $("btnQueueClear");
  if (clearBtn) clearBtn.disabled = state.queue.length === 0;

  if (!state.queue.length) {
    container.innerHTML = `<div class=\"empty\"><div class=\"empty-ill\">📭</div>队列为空</div>`;
    return;
  }

  state.queue.forEach((song, idx) => {
    const node = document.createElement("div");
    node.className = `queue-item ${idx === state.queueIndex ? "active" : ""}`;
    const nowTag = idx === state.queueIndex ? `<span class="queue-now">正在播放</span>` : "";
    node.innerHTML = `
      <div class="queue-main" role="button" tabindex="0" data-act="play" data-idx="${idx}">
        <div class="queue-index">${String(idx + 1).padStart(2, "0")}</div>
        <div>
          <div class="queue-title">${song.name || "未知歌曲"}</div>
          <div class="queue-sub">${song.artist || "未知歌手"} ${nowTag}</div>
        </div>
      </div>
      <div class="row queue-item-actions">
        <button class="btn btn-ghost" data-act="up" data-idx="${idx}" type="button" title="上移" aria-label="上移" ${idx === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-ghost" data-act="down" data-idx="${idx}" type="button" title="下移" aria-label="下移" ${idx === state.queue.length - 1 ? "disabled" : ""}>↓</button>
        <button class="btn btn-ghost" data-act="remove" data-idx="${idx}" type="button" title="移除" aria-label="移除">✕</button>
      </div>
    `;

    node.querySelectorAll("[data-act]")?.forEach((button) => {
      if (button.classList?.contains("btn")) {
        button.addEventListener("click", (event) => {
          event.stopPropagation();
        });
      }

      button.addEventListener("click", () => {
        const act = button.dataset.act;
        if (act === "play") {
          playQueueIndex(idx);
          return;
        }
        if (act === "up") {
          moveQueueItem(idx, idx - 1);
          return;
        }
        if (act === "down") {
          moveQueueItem(idx, idx + 1);
          return;
        }
        removeQueueIndex(idx);
      });

      if (button.dataset.act === "play") {
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            playQueueIndex(idx);
          }
        });
      }
    });
    container.appendChild(node);
  });
}

function moveQueueItem(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= state.queue.length || toIndex >= state.queue.length) return;

  const [item] = state.queue.splice(fromIndex, 1);
  state.queue.splice(toIndex, 0, item);

  if (state.queueIndex === fromIndex) {
    state.queueIndex = toIndex;
  } else if (fromIndex < state.queueIndex && toIndex >= state.queueIndex) {
    state.queueIndex -= 1;
  } else if (fromIndex > state.queueIndex && toIndex <= state.queueIndex) {
    state.queueIndex += 1;
  }

  renderQueue();
}

function removeQueueIndex(idx) {
  if (idx < 0 || idx >= state.queue.length) return;
  state.queue.splice(idx, 1);
  if (state.queueIndex === idx) {
    state.queueIndex = -1;
    if (!state.queue.length) {
      audio.pause();
      audio.removeAttribute("src");
      setPlayPauseUI(false);
    } else {
      playQueueIndex(Math.min(idx, state.queue.length - 1));
    }
  } else if (idx < state.queueIndex) {
    state.queueIndex -= 1;
  }
  renderQueue();
}

function clearQueue() {
  state.queue = [];
  state.queueIndex = -1;
  state.lyricLines = [];
  state.lyricTimedIndices = [];
  state.lyricActiveIndex = -1;
  state.lyricWordActiveIndex = -1;
  audio.pause();
  audio.removeAttribute("src");
  setPlayPauseUI(false);
  renderLyrics([]);
  renderQueue();
  setObs("parse", { latency: null, count: 0, cache: null });
  setMsg("parseMsg", "播放队列已清空");
}

function setNowPlaying(song) {
  state.currentSong = song;
  setText("songTitle", `${song.name || "未知歌曲"}`);
  setText("nowArtist", `${song.artist || "未知歌手"} · ${platformText[song.platform] || song.platform || "未知平台"}`);
  setText("miniTitle", song.name || "未知歌曲");
  setText("miniSub", song.artist || "未知歌手");
  setText("lyricFsTitle", song.name || "未知歌曲");
  setText("lyricFsSub", `${song.artist || "未知歌手"} · ${song.album || "单曲"}`);
  setCover("coverMini", song.cover);
  setCover("coverBar", song.cover);
  setLyricFsCover(song.cover);
  animateCoverTransition();
}

function parseTs(text) {
  const m = text.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  const ms = Number((m[3] || "0").padEnd(3, "0"));
  return min * 60 + sec + ms / 1000;
}

function parseLyrics(raw) {
  const text = String(raw || "").replace(/\r/g, "").trim();
  if (!text) return [];

  const lines = [];
  text.split("\n").forEach((lineRaw) => {
    const line = lineRaw.trim();
    if (!line) return;

    const krcHeader = line.match(/^\[(\d+),(\d+)\]/);
    if (krcHeader) {
      const base = Number(krcHeader[1]) / 1000;
      const body = line.replace(/^\[\d+,\d+\]/, "");
      const words = [];
      const krcWordPattern = /<(\d+),(\d+),\d+>([^<]+)/g;
      let km;
      while ((km = krcWordPattern.exec(body)) !== null) {
        const offset = Number(km[1]) / 1000;
        const content = (km[3] || "").trim();
        if (!content) continue;
        words.push({ time: base + offset, text: content });
      }
      const merged = words.map((w) => w.text).join("").trim() || body.replace(/<\d+,\d+,\d+>/g, "").trim();
      lines.push({ time: base, text: merged || "♪", words });
      return;
    }

    const tags = [...line.matchAll(/\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g)];
    const content = line.replace(/\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g, "").trim();

    const enhancedWords = [];
    const enhancedPattern = /<(\d{1,2}:\d{2}(?:\.\d{1,3})?)>([^<]*)/g;
    let em;
    while ((em = enhancedPattern.exec(content)) !== null) {
      const ts = parseTs(em[1]);
      const w = (em[2] || "").trim();
      if (ts != null && w) enhancedWords.push({ time: ts, text: w });
    }
    const plain = content.replace(/<(\d{1,2}:\d{2}(?:\.\d{1,3})?)>/g, "").trim();

    if (!tags.length) {
      if (plain) lines.push({ time: null, text: plain });
      return;
    }

    tags.forEach((tag) => {
      const ts = parseTs(tag[1]);
      if (ts != null) {
        lines.push({
          time: ts,
          text: plain || "♪",
          words: enhancedWords.length ? enhancedWords.map((w) => ({ ...w })) : []
        });
      }
    });
  });

  lines.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  return lines;
}

function createLyricLineNode(line, idx) {
  const node = document.createElement("div");
  node.className = `lyric-line line-enter ${line.time == null ? "dim" : ""}`;
  node.dataset.index = String(idx);
  node.style.setProperty("--line-delay", `${Math.min(idx, 40) * 0.02}s`);

  if (typeof line.time === "number") {
    node.dataset.time = String(line.time);
    node.style.cursor = "pointer";
    node.title = "点击跳转到该句";
    node.addEventListener("click", () => {
      audio.currentTime = line.time;
      updateLyricByTime(line.time);
      if (audio.paused) audio.play().catch(() => {});
    });
  }

  if (Array.isArray(line.words) && line.words.length > 0) {
    const html = line.words
      .map((word, widx) => {
        const text = String(word?.text ?? "");
        if (!text) return "";
        return `<span class="lyric-word" data-widx="${widx}">${escapeHtml(text)}</span>`;
      })
      .join("");
    if (html) {
      node.innerHTML = html;
    } else {
      node.textContent = line.text || "♪";
    }
  } else {
    node.textContent = line.text || "♪";
  }

  if (!node.textContent || !node.textContent.trim()) {
    node.textContent = line.text || "♪";
  }
  return node;
}

function renderLyrics(lines) {
  const boxes = [$("lyricsRealtime"), $("lyricsFullscreenList")].filter(Boolean);
  if (!boxes.length) return;

  boxes.forEach((box) => {
    if (!lines.length) {
      box.innerHTML = `<div class=\"empty\"><div class=\"empty-ill\">🎤</div>暂无歌词，请先播放一首歌曲</div>`;
      return;
    }

    box.innerHTML = "";
    lines.forEach((line, idx) => {
      box.appendChild(createLyricLineNode(line, idx));
    });
  });
}

function setActiveLyric(index, wordIndex = -1) {
  const boxes = [$("lyricsRealtime"), $("lyricsFullscreenList")].filter(Boolean);
  if (!boxes.length) return;

  boxes.forEach((box) => {
    box.querySelectorAll(".lyric-line").forEach((lineNode) => {
      const currentIndex = Number(lineNode.dataset.index || -1);
      const isActive = index >= 0 && currentIndex === index;
      lineNode.classList.toggle("active", isActive);
      lineNode.classList.toggle("past", index >= 0 && currentIndex < index);
      lineNode.classList.toggle("upcoming", index >= 0 && currentIndex > index);
    });
    box.querySelectorAll(".lyric-word.active-word").forEach((node) => {
      node.classList.remove("active-word");
    });
    if (index < 0) return;

    const node = box.querySelector(`.lyric-line[data-index=\"${index}\"]`);
    if (!node) return;
    node.classList.add("active");

    if (wordIndex >= 0) {
      const word = node.querySelector(`.lyric-word[data-widx=\"${wordIndex}\"]`);
      if (word) word.classList.add("active-word");
    }

    if (state.lyricAutoScroll) {
      const top = node.offsetTop - box.clientHeight * 0.35;
      box.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  });
}

function updateLyricByTime(time) {
  if (!state.lyricLines.length) return;
  let idx = findLyricIndexByTime(time);
  if (idx < 0 && state.lyricTimedIndices.length) {
    idx = state.lyricTimedIndices[0].idx;
  }
  let wordIdx = -1;

  if (idx >= 0) {
    const line = state.lyricLines[idx];
    if (Array.isArray(line.words) && line.words.length) {
      for (let i = 0; i < line.words.length; i += 1) {
        if (time >= line.words[i].time - 0.02) wordIdx = i;
        else break;
      }
    }
  }

  if (idx !== state.lyricActiveIndex || wordIdx !== state.lyricWordActiveIndex) {
    state.lyricActiveIndex = idx;
    state.lyricWordActiveIndex = wordIdx;
    setActiveLyric(idx, wordIdx);
  }
}

async function resolveSong(song) {
  if (song?.url || song?.directUrl) {
    return {
      ...song,
      url: song.url || song.directUrl,
      lyrics: song.lyrics || "",
      parseCache: true,
      parseCacheSource: "direct"
    };
  }

  const cacheKey = `${song.platform}|${song.id}|${state.quality}`;
  if (state.resolveCache[cacheKey]) {
    return {
      ...song,
      ...state.resolveCache[cacheKey],
      parseCache: true,
      parseCacheSource: "memory"
    };
  }

  if (!state.loggedIn) {
    onUnauthorized();
    throw new Error("未登录");
  }

  const { status, data } = await api("/api/parse", {
    method: "POST",
    body: {
      platform: song.platform,
      ids: String(song.id),
      quality: state.quality
    }
  });

  if (status === 401) {
    onUnauthorized();
    throw new Error("未授权");
  }

  if (status !== 200 || data.code !== 0) {
    throw new Error(data.message || "解析失败");
  }

  const parsed = (data?.data?.data || []).find((item) => item.success && item.url);
  if (!parsed) throw new Error("无可播放资源");

  const resolved = {
    url: parsed.url,
    lyrics: parsed.lyrics || "",
    cover: parsed.cover || song.cover || "",
    name: parsed?.info?.name || song.name,
    artist: parsed?.info?.artist || song.artist,
    album: parsed?.info?.album || song.album || "",
    parseCache: !!data?.localCache,
    parseCacheSource: data?.localCache ? "remote" : "none"
  };

  state.resolveCache[cacheKey] = resolved;
  return { ...song, ...resolved };
}

async function playQueueIndex(index) {
  if (index < 0 || index >= state.queue.length) return;
  state.queueIndex = index;
  renderQueue();
  const startedAt = performance.now();

  const baseSong = state.queue[index];
  setMsg("parseMsg", `正在解析：${baseSong.name || baseSong.id}`);
  setObs("parse", { latency: null, count: 0, cache: null });

  try {
    const song = await resolveSong(baseSong);
    state.queue[index] = song;
    setNowPlaying(song);

    state.lyricLines = parseLyrics(song.lyrics);
    state.lyricTimedIndices = buildTimedLyricIndices(state.lyricLines);
    state.lyricActiveIndex = -1;
    state.lyricWordActiveIndex = -1;
    renderLyrics(state.lyricLines);

    audio.src = song.url;
    audio.play().catch(() => {});

    focusLyricsArea();

    addHistory(song);
    setMsg("parseMsg", "播放成功");
    setObs("parse", {
      latency: performance.now() - startedAt,
      count: state.lyricLines.length,
      cache: !!song.parseCache
    });
    renderQueue();
  } catch (error) {
    setMsg("parseMsg", `播放失败：${error.message || "未知错误"}`);
    setObs("parse", {
      latency: performance.now() - startedAt,
      count: 0,
      cache: null
    });
  }
}

function enqueueSong(song) {
  state.queue.push({ ...song });
  renderQueue();
}

function setQueueAndPlay(list, startIndex = 0) {
  state.queue = list.map((item) => ({ ...item }));
  state.queueIndex = -1;
  renderQueue();
  playQueueIndex(startIndex);
}

function getMode() {
  return playModes[state.playModeIndex] || playModes[0];
}

function cyclePlayMode() {
  state.playModeIndex = (state.playModeIndex + 1) % playModes.length;
  $("btnMode").textContent = getMode().label;
}

function nextIndex() {
  if (!state.queue.length) return -1;
  const mode = getMode().key;

  if (mode === "single") return state.queueIndex;
  if (mode === "shuffle") return Math.floor(Math.random() * state.queue.length);

  const idx = state.queueIndex + 1;
  if (idx < state.queue.length) return idx;
  if (mode === "loop") return 0;
  return -1;
}

function prevIndex() {
  if (!state.queue.length) return -1;
  const mode = getMode().key;

  if (mode === "shuffle") return Math.floor(Math.random() * state.queue.length);

  const idx = state.queueIndex - 1;
  if (idx >= 0) return idx;
  if (mode === "loop") return state.queue.length - 1;
  return 0;
}

function playNext() {
  const idx = nextIndex();
  if (idx >= 0) playQueueIndex(idx);
}

function playPrev() {
  const idx = prevIndex();
  if (idx >= 0) playQueueIndex(idx);
}

async function doSearchRequest(platform, keyword, page, pageSize) {
  const { status, data } = await api("/api/search", {
    method: "POST",
    body: { platform, keyword, page, pageSize }
  });
  return {
    status,
    data,
    songs: data?.data?.songs || [],
    localCache: !!data?.localCache,
    code: Number(data?.code),
    message: data?.message || ""
  };
}

async function doOpenSearchRequest(keyword, pageSize) {
  const { status, data } = await api("/api/search_open", {
    method: "POST",
    body: { keyword, pageSize }
  });
  return {
    status,
    data,
    songs: data?.data?.songs || [],
    localCache: !!data?.localCache,
    code: Number(data?.code),
    message: data?.message || ""
  };
}

async function searchSongs() {
  if (!state.loggedIn) {
    setMsg("searchMsg", "请先登录");
    return;
  }

  const selectedPlatform = $("searchPlatform").value;
  const keyword = $("keyword").value.trim();
  const page = Math.max(1, Number($("page").value || 1));
  const pageSize = Math.max(1, Math.min(50, Number($("pageSize").value || 20)));

  if (!keyword) {
    setMsg("searchMsg", "请输入关键词");
    return;
  }

  const token = ++state.searchToken;
  setMsg("searchMsg", "搜索中...");
  setButtonLoading("btnSearch", true, "搜索中...");
  renderSkeleton("searchList", 8);
  const startedAt = performance.now();
  const attempts = [];

  try {
    const order = buildSearchPlatformOrder(selectedPlatform);
    const pageCandidates = Array.from(new Set([page, Math.max(0, page - 1), 0]));
    let finalPlatform = selectedPlatform;
    let finalSongs = [];
    let finalCache = null;
    let finalError = "";

    for (const platform of order) {
      for (const pageValue of pageCandidates) {
        const result = await doSearchRequest(platform, keyword, pageValue, pageSize);
        if (token !== state.searchToken) return;

        attempts.push({
          platform,
          status: result.status,
          code: result.code,
          count: Array.isArray(result.songs) ? result.songs.length : 0,
          page: pageValue
        });

        if (result.status === 401) return onUnauthorized();
        if (result.status === 429) {
          finalError = result.message || "搜索请求过于频繁，请稍后重试";
          break;
        }

        if (result.status === 200 && result.code === 0) {
          const normalized = (result.songs || []).map((song) => ({
            ...song,
            platform: song.platform || platform
          }));

          if (normalized.length) {
            finalPlatform = platform;
            finalSongs = normalized;
            finalCache = result.localCache;
            break;
          }
        } else if (!finalError) {
          finalError = result.message || `搜索失败（HTTP ${result.status}）`;
        }
      }

      if (finalSongs.length || /频繁/.test(finalError)) {
        break;
      }
    }

    state.searchResults = dedupeSongs(finalSongs);

    if (!state.searchResults.length) {
      if (!/频繁|未授权/.test(finalError)) {
        const open = await doOpenSearchRequest(keyword, pageSize);
        if (token !== state.searchToken) return;

        attempts.push({
          platform: "itunes",
          status: open.status,
          code: open.code,
          count: Array.isArray(open.songs) ? open.songs.length : 0,
          page: 1
        });

        if (open.status === 200 && open.code === 0 && (open.songs || []).length) {
          state.searchResults = dedupeSongs(
            (open.songs || []).map((song) => ({
              ...song,
              platform: song.platform || "itunes"
            }))
          );
          finalCache = open.localCache;
          finalPlatform = "itunes";

          addRecentSearch(keyword, finalPlatform);
          renderSongList("searchList", state.searchResults, {
            showFav: true,
            emptyText: "未找到歌曲"
          });
          setMsg(
            "searchMsg",
            `三平台无结果，已切到开放搜索（iTunes 试听）：${state.searchResults.length} 条（${summarizeSearchAttempts(attempts)}）`
          );
          setObs("search", {
            latency: performance.now() - startedAt,
            count: state.searchResults.length,
            cache: finalCache
          });
          return;
        }
      }

      renderSongList("searchList", [], { emptyText: "未找到歌曲" });
      if (!finalError) {
        finalError = "暂无可用歌曲，建议尝试“歌手+歌名”或更换平台";
      }
      const summary = summarizeSearchAttempts(attempts);
      if (summary) {
        setMsg("searchMsg", `${finalError || "三平台均无结果"}（${summary}）`);
      } else {
        setMsg("searchMsg", finalError || "未找到歌曲，请更换关键词");
      }
      setObs("search", {
        latency: performance.now() - startedAt,
        count: 0,
        cache: finalCache
      });
      return;
    }

    addRecentSearch(keyword, finalPlatform);

    renderSongList("searchList", state.searchResults, {
      showFav: true,
      emptyText: "未找到歌曲"
    });

    if (state.searchResults.length && finalPlatform !== selectedPlatform) {
      setMsg(
        "searchMsg",
        `已自动切换到 ${platformText[finalPlatform] || finalPlatform}：${state.searchResults.length} 条（${summarizeSearchAttempts(attempts)}）`
      );
    } else {
      setMsg("searchMsg", `搜索完成：${state.searchResults.length} 条（${summarizeSearchAttempts(attempts)}）`);
    }
    setObs("search", {
      latency: performance.now() - startedAt,
      count: state.searchResults.length,
      cache: finalCache
    });
  } catch (error) {
    if (token !== state.searchToken) return;
    state.searchResults = [];
    renderSongList("searchList", [], { emptyText: "搜索异常" });
    setMsg("searchMsg", `搜索异常：${error?.message || "网络错误"}`);
    setObs("search", {
      latency: performance.now() - startedAt,
      count: 0,
      cache: null
    });
  } finally {
    if (token === state.searchToken) {
      setButtonLoading("btnSearch", false);
    }
  }
}

async function loadToplists() {
  if (!state.loggedIn) {
    setMsg("toplistMsg", "请先登录");
    return;
  }

  const platform = $("rankPlatform").value;
  setMsg("toplistMsg", "加载榜单中...");
  renderSkeleton("toplistList", 6);
  renderSkeleton("topSongList", 8);
  const startedAt = performance.now();

  setButtonLoading("btnLoadToplists", true, "加载中...");
  try {
    const { status, data } = await api("/api/toplists", {
      method: "POST",
      body: { platform }
    });

    if (status === 401) return onUnauthorized();
    if (status !== 200 || data.code !== 0) {
      state.toplists = [];
      renderToplists();
      setMsg("toplistMsg", data.message || "加载失败");
      setObs("rank", {
        latency: performance.now() - startedAt,
        count: 0,
        cache: !!data?.localCache
      });
      return;
    }

    state.toplists = data?.data?.toplists || [];
    state.activeToplistId = "";
    renderToplists();
    setMsg("toplistMsg", `已加载 ${state.toplists.length} 个榜单`);
    setObs("rank", {
      latency: performance.now() - startedAt,
      count: state.toplists.length,
      cache: !!data?.localCache
    });

    if (state.toplists.length) {
      loadToplistSongs(state.toplists[0]);
    }
  } catch (error) {
    setMsg("toplistMsg", `加载异常：${error?.message || "网络错误"}`);
    setObs("rank", {
      latency: performance.now() - startedAt,
      count: 0,
      cache: null
    });
  } finally {
    setButtonLoading("btnLoadToplists", false);
  }
}

async function loadToplistSongs(top) {
  if (!top?.id) return;

  const platform = $("rankPlatform").value;
  state.activeToplistId = top.id;
  renderToplists();
  setText("topSongsTitle", `${top.name} · 榜单歌曲`);
  setMsg("toplistMsg", `加载「${top.name}」...`);

  const { status, data } = await api("/api/toplist", {
    method: "POST",
    body: { platform, id: top.id }
  });

  if (status === 401) return onUnauthorized();
  if (status !== 200 || data.code !== 0) {
    state.toplistSongs = [];
    renderTopSongs();
    setMsg("toplistMsg", data.message || "榜单加载失败");
    return;
  }

  state.toplistSongs = (data?.data?.songs || []).map((song) => ({ ...song, platform: song.platform || platform }));
  renderTopSongs();
  setMsg("toplistMsg", `已加载 ${state.toplistSongs.length} 首歌曲`);
}

function bindMenu() {
  document.querySelectorAll(".menu-btn, .mobile-nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      setView(btn.dataset.view);
    });
  });

  document.querySelectorAll(".quick-item[data-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setView(btn.dataset.jump);
    });
  });
}

function bindDemos() {
  document.querySelectorAll(".chip[data-demo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const platform = btn.dataset.platform || "netease";
      const id = btn.dataset.demo || "";
      const tempSong = {
        id,
        platform,
        name: `${platformText[platform] || platform} 示例歌曲`,
        artist: "Demo"
      };
      setQueueAndPlay([tempSong], 0);
    });
  });
}

function bindTopActions() {
  $("btnTheme").addEventListener("click", () => {
    setTheme(state.theme === "dark" ? "light" : "dark");
  });
  $("btnLogin").addEventListener("click", doLogin);
  $("btnLogout").addEventListener("click", doLogout);
  $("btnSearch").addEventListener("click", searchSongs);
  $("btnClearRecent")?.addEventListener("click", clearRecentSearches);
  $("btnLoadToplists").addEventListener("click", loadToplists);

  $("qualityGlobal").addEventListener("change", (event) => {
    state.quality = event.target.value || "320k";
    saveState();
    setMsg("parseMsg", `已切换音质：${state.quality}`);
  });

  $("keyword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchSongs();
  });

  $("password").addEventListener("keydown", (event) => {
    if (event.key === "Enter") doLogin();
  });

  $("btnLyricFullscreen").addEventListener("click", () => {
    setLyricFullscreen(!state.lyricFullscreen);
  });

  $("btnLyricSize")?.addEventListener("click", cycleLyricScale);

  $("btnLyricFsClose").addEventListener("click", () => {
    setLyricFullscreen(false);
  });

  $("lyricFullscreen").addEventListener("click", (event) => {
    if (event.target?.id === "lyricFullscreen") {
      setLyricFullscreen(false);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.lyricFullscreen) {
      setLyricFullscreen(false);
    }
  });
}

function bindPlayerActions() {
  const progress = $("progress");
  const volume = $("volume");
  const drawer = $("btnDrawer");
  const player = document.querySelector(".player");
  const progressRow = $("progressRow");
  const controls = $("playerControls");

  progress.max = "10000";

  player?.addEventListener("mouseenter", wakePlayer);
  player?.addEventListener("mousemove", wakePlayer);
  player?.addEventListener("mouseleave", schedulePlayerIdle);
  player?.addEventListener("pointerdown", wakePlayer);
  player?.addEventListener("focusin", wakePlayer);
  player?.addEventListener(
    "touchstart",
    (event) => {
      state.touchStartY = event.touches?.[0]?.clientY ?? null;
    },
    { passive: true }
  );
  player?.addEventListener(
    "touchend",
    (event) => {
      if (window.innerWidth > 760) return;
      if (state.touchStartY == null) return;
      const endY = event.changedTouches?.[0]?.clientY ?? state.touchStartY;
      const delta = endY - state.touchStartY;
      state.touchStartY = null;
      if (Math.abs(delta) < 36) return;
      if (delta < 0) setDrawerOpen(true);
      else setDrawerOpen(false);
    },
    { passive: true }
  );
  player?.addEventListener(
    "touchcancel",
    () => {
      state.touchStartY = null;
    },
    { passive: true }
  );

  controls?.addEventListener("mouseenter", wakePlayer);
  controls?.addEventListener("mousemove", wakePlayer);

  progressRow?.addEventListener("mouseenter", () => {
    state.progressHover = true;
    state.progressHoverSince = Date.now();
    wakePlayer();
  });
  progressRow?.addEventListener("mousemove", () => {
    state.progressHover = true;
    state.progressHoverSince = Date.now();
    wakePlayer();
  });
  progressRow?.addEventListener("mouseleave", () => {
    state.progressHover = false;
    state.progressHoverSince = 0;
    schedulePlayerIdle();
  });

  $("btnPlayPause").addEventListener("click", () => {
    wakePlayer();
    if (!audio.src) {
      if (state.queue.length) playQueueIndex(Math.max(0, state.queueIndex));
      return;
    }
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  });

  $("btnPrev").addEventListener("click", playPrev);
  $("btnNext").addEventListener("click", playNext);
  $("btnMode").addEventListener("click", cyclePlayMode);
  $("btnFav").addEventListener("click", () => {
    if (!state.currentSong) {
      setMsg("parseMsg", "当前没有可收藏歌曲");
      return;
    }
    addFavorite(state.currentSong);
    setMsg("parseMsg", "已加入收藏");
  });

  $("btnAutoLyric").addEventListener("click", () => {
    state.lyricAutoScroll = !state.lyricAutoScroll;
    $("btnAutoLyric").textContent = `歌词滚动：${state.lyricAutoScroll ? "开" : "关"}`;
  });

  drawer?.addEventListener("click", () => {
    setDrawerOpen(!state.drawerOpen);
  });

  audio.addEventListener("play", () => {
    setPlayPauseUI(true);
  });

  $("btnQueueClear")?.addEventListener("click", clearQueue);

  audio.addEventListener("pause", () => {
    setPlayPauseUI(false);
  });

  audio.addEventListener("loadedmetadata", () => {
    setText("timeTotal", formatTime(audio.duration));
  });

  audio.addEventListener("timeupdate", () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    setText("timeCurrent", formatTime(current));
    if (duration > 0 && !state.isScrubbing) {
      progress.value = String(Math.min(10000, Math.floor((current / duration) * 10000)));
    }
    updateLyricByTime(current);
  });

  audio.addEventListener("ended", () => {
    playNext();
  });

  const seekToProgress = () => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration <= 0) return;
    const target = (Number(progress.value) / 10000) * duration;
    audio.currentTime = target;
    setText("timeCurrent", formatTime(target));
    updateLyricByTime(target);
  };

  progress.addEventListener("pointerdown", () => {
    wakePlayer();
    state.isScrubbing = true;
    state.progressHover = true;
    state.progressHoverSince = Date.now();
  });

  progress.addEventListener("pointerup", () => {
    seekToProgress();
    state.isScrubbing = false;
    state.progressHover = false;
    state.progressHoverSince = 0;
    schedulePlayerIdle();
  });

  progress.addEventListener("input", () => {
    wakePlayer();
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration <= 0) return;
    const preview = (Number(progress.value) / 10000) * duration;
    setText("timeCurrent", formatTime(preview));
    updateLyricByTime(preview);
  });

  progress.addEventListener("change", () => {
    seekToProgress();
  });

  window.addEventListener("pointerup", () => {
    if (state.isScrubbing) {
      seekToProgress();
      state.isScrubbing = false;
      state.progressHover = false;
      state.progressHoverSince = 0;
      schedulePlayerIdle();
    }
  });

  volume.addEventListener("input", () => {
    wakePlayer();
    audio.volume = Number(volume.value);
    if (audio.volume > 0) state.lastVolume = audio.volume;
  });
  audio.volume = Number(volume.value);
  state.lastVolume = audio.volume || 0.9;

  window.addEventListener("keydown", (event) => {
    if (isEditableTarget(event.target)) return;

    if (event.code === "Space") {
      event.preventDefault();
      $("btnPlayPause")?.click();
      return;
    }

    if (event.key === "ArrowRight") {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (duration <= 0) return;
      event.preventDefault();
      audio.currentTime = Math.min(duration, audio.currentTime + 5);
      wakePlayer();
      return;
    }

    if (event.key === "ArrowLeft") {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (duration <= 0) return;
      event.preventDefault();
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      wakePlayer();
      return;
    }

    if (event.key.toLowerCase() === "m") {
      event.preventDefault();
      toggleMute();
      wakePlayer();
    }
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      setDrawerOpen(false);
      schedulePlayerIdle();
    } else {
      state.progressHover = false;
      setPlayerIdle(false);
    }
  });

  schedulePlayerIdle();
}

function initialize() {
  setTheme(state.theme);
  setView(state.view);
  $("btnMode").textContent = getMode().label;
  setPlayPauseUI(false);
  setLyricFsCover("");
  setLyricScale(state.lyricScaleIndex);
  setObs("search", { latency: null, count: 0, cache: null });
  setObs("rank", { latency: null, count: 0, cache: null });
  setObs("parse", { latency: null, count: 0, cache: null });
  $("qualityGlobal").value = state.quality;
  setDrawerOpen(false);
  setLyricFullscreen(false);

  bindMenu();
  bindDemos();
  bindTopActions();
  bindPlayerActions();

  renderFavorites();
  renderHistory();
  renderToplists();
  renderTopSongs();
  renderQueue();
  renderRecentSearches();
  renderLyrics([]);
  checkMe();
}

initialize();
