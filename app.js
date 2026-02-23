const $ = (id) => document.getElementById(id);

const platformText = {
  netease: "网易云",
  qq: "QQ音乐",
  kuwo: "酷我"
};

const playModes = [
  { key: "order", label: "顺序" },
  { key: "loop", label: "循环" },
  { key: "single", label: "单曲" },
  { key: "shuffle", label: "随机" }
];

const state = {
  loggedIn: false,
  view: "discover",
  theme: localStorage.getItem("theme") || "dark",
  quality: localStorage.getItem("quality") || "320k",
  currentSong: null,
  favorites: JSON.parse(localStorage.getItem("favSongs") || "[]"),
  history: JSON.parse(localStorage.getItem("hisSongs") || "[]"),
  searchResults: [],
  toplists: [],
  activeToplistId: "",
  toplistSongs: [],
  queue: [],
  queueIndex: -1,
  playModeIndex: 0,
  lyricLines: [],
  lyricActiveIndex: -1,
  lyricWordActiveIndex: -1,
  lyricAutoScroll: true,
  lyricFullscreen: false,
  resolveCache: {},
  isScrubbing: false,
  drawerOpen: false,
  playerIdle: false,
  playerIdleTimer: null
};

const audio = $("playerAudio");

function saveState() {
  localStorage.setItem("favSongs", JSON.stringify(state.favorites));
  localStorage.setItem("hisSongs", JSON.stringify(state.history));
  localStorage.setItem("theme", state.theme);
  localStorage.setItem("quality", state.quality);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value || "";
}

function setMsg(id, value) {
  setText(id, value);
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
    if (!state.isScrubbing) setPlayerIdle(true);
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

function animateCoverTransition() {
  ["coverHero", "coverMini", "coverBar", "lyricFsBg"].forEach((id) => {
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
  document.querySelectorAll(".menu-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

async function api(path, { method = "GET", body } = {}) {
  const options = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" }
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  const response = await fetch(path, options);
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { status: response.status, ok: response.ok, data };
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
    container.innerHTML = `<div class=\"empty\">${emptyText}</div>`;
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
    container.innerHTML = `<div class=\"empty\">暂无榜单，请点击加载</div>`;
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

  if (!state.queue.length) {
    container.innerHTML = `<div class=\"empty\">队列为空</div>`;
    return;
  }

  state.queue.forEach((song, idx) => {
    const node = document.createElement("div");
    node.className = `queue-item ${idx === state.queueIndex ? "active" : ""}`;
    node.innerHTML = `
      <div>
        <div class="queue-title">${song.name || "未知歌曲"}</div>
        <div class="queue-sub">${song.artist || "未知歌手"}</div>
      </div>
      <button class="btn btn-ghost" data-idx="${idx}" type="button">播放</button>
    `;

    node.querySelector("button")?.addEventListener("click", () => {
      playQueueIndex(idx);
    });
    container.appendChild(node);
  });
}

function setNowPlaying(song) {
  state.currentSong = song;
  setText("songTitle", `${song.name || "未知歌曲"}`);
  setText("nowArtist", `${song.artist || "未知歌手"} · ${platformText[song.platform] || song.platform || "未知平台"}`);
  setText("miniTitle", song.name || "未知歌曲");
  setText("miniSub", song.artist || "未知歌手");
  setText("lyricFsTitle", song.name || "未知歌曲");
  setText("lyricFsSub", `${song.artist || "未知歌手"} · ${song.album || "单曲"}`);
  setCover("coverHero", song.cover);
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
  node.className = `lyric-line ${line.time == null ? "dim" : ""}`;
  node.dataset.index = String(idx);

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
    node.innerHTML = line.words
      .map((word, widx) => `<span class="lyric-word" data-widx="${widx}">${escapeHtml(word.text)}</span>`)
      .join("");
  } else {
    node.textContent = line.text || "♪";
  }
  return node;
}

function renderLyrics(lines) {
  const boxes = [$("lyricsRealtime"), $("lyricsFullscreenList")].filter(Boolean);
  if (!boxes.length) return;

  boxes.forEach((box) => {
    if (!lines.length) {
      box.innerHTML = `<div class=\"empty\">暂无歌词，请先播放一首歌曲</div>`;
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
    box.querySelector(".lyric-line.active")?.classList.remove("active");
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
  let idx = -1;
  let wordIdx = -1;
  for (let i = 0; i < state.lyricLines.length; i += 1) {
    const line = state.lyricLines[i];
    if (typeof line.time !== "number") continue;
    if (time >= line.time - 0.05) idx = i;
    else break;
  }
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
  const cacheKey = `${song.platform}|${song.id}|${state.quality}`;
  if (state.resolveCache[cacheKey]) return { ...song, ...state.resolveCache[cacheKey] };

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
    album: parsed?.info?.album || song.album || ""
  };

  state.resolveCache[cacheKey] = resolved;
  return { ...song, ...resolved };
}

async function playQueueIndex(index) {
  if (index < 0 || index >= state.queue.length) return;
  state.queueIndex = index;
  renderQueue();

  const baseSong = state.queue[index];
  setMsg("parseMsg", `正在解析：${baseSong.name || baseSong.id}`);

  try {
    const song = await resolveSong(baseSong);
    state.queue[index] = song;
    setNowPlaying(song);

    state.lyricLines = parseLyrics(song.lyrics);
    state.lyricActiveIndex = -1;
    state.lyricWordActiveIndex = -1;
    renderLyrics(state.lyricLines);

    audio.src = song.url;
    audio.play().catch(() => {});

    focusLyricsArea();

    addHistory(song);
    setMsg("parseMsg", "播放成功");
    renderQueue();
  } catch (error) {
    setMsg("parseMsg", `播放失败：${error.message || "未知错误"}`);
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

async function searchSongs() {
  if (!state.loggedIn) {
    setMsg("searchMsg", "请先登录");
    return;
  }

  const platform = $("searchPlatform").value;
  const keyword = $("keyword").value.trim();
  const page = Math.max(1, Number($("page").value || 1));
  const pageSize = Number($("pageSize").value || 20);

  if (!keyword) {
    setMsg("searchMsg", "请输入关键词");
    return;
  }

  setMsg("searchMsg", "搜索中...");
  setButtonLoading("btnSearch", true, "搜索中...");
  try {
    const { status, data } = await api("/api/search", {
      method: "POST",
      body: { platform, keyword, page, pageSize }
    });

    if (status === 401) return onUnauthorized();
    if (status !== 200 || data.code !== 0) {
      state.searchResults = [];
      renderSongList("searchList", [], { emptyText: "搜索失败" });
      setMsg("searchMsg", data.message || `搜索失败（HTTP ${status}）`);
      return;
    }

    state.searchResults = (data?.data?.songs || []).map((song) => ({ ...song, platform: song.platform || platform }));
    renderSongList("searchList", state.searchResults, {
      showFav: true,
      emptyText: "未找到歌曲"
    });
    setMsg("searchMsg", `搜索完成：${state.searchResults.length} 条`);
  } catch (error) {
    state.searchResults = [];
    renderSongList("searchList", [], { emptyText: "搜索异常" });
    setMsg("searchMsg", `搜索异常：${error?.message || "网络错误"}`);
  } finally {
    setButtonLoading("btnSearch", false);
  }
}

async function loadToplists() {
  if (!state.loggedIn) {
    setMsg("toplistMsg", "请先登录");
    return;
  }

  const platform = $("rankPlatform").value;
  setMsg("toplistMsg", "加载榜单中...");

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
      return;
    }

    state.toplists = data?.data?.toplists || [];
    state.activeToplistId = "";
    renderToplists();
    setMsg("toplistMsg", `已加载 ${state.toplists.length} 个榜单`);

    if (state.toplists.length) {
      loadToplistSongs(state.toplists[0]);
    }
  } catch (error) {
    setMsg("toplistMsg", `加载异常：${error?.message || "网络错误"}`);
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
  document.querySelectorAll(".menu-btn").forEach((btn) => {
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

  progress.max = "10000";

  player?.addEventListener("mouseenter", wakePlayer);
  player?.addEventListener("mousemove", wakePlayer);
  player?.addEventListener("mouseleave", schedulePlayerIdle);
  player?.addEventListener("pointerdown", wakePlayer);
  player?.addEventListener("focusin", wakePlayer);

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
  });

  progress.addEventListener("pointerup", () => {
    seekToProgress();
    state.isScrubbing = false;
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
      schedulePlayerIdle();
    }
  });

  volume.addEventListener("input", () => {
    wakePlayer();
    audio.volume = Number(volume.value);
  });
  audio.volume = Number(volume.value);

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) {
      setDrawerOpen(false);
      schedulePlayerIdle();
    } else {
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
  renderLyrics([]);
  checkMe();
}

initialize();
