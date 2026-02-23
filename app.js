const $ = (id) => document.getElementById(id);

const platformText = {
  netease: "网易云",
  qq: "QQ音乐",
  kuwo: "酷我"
};

const state = {
  loggedIn: false,
  currentSong: null,
  favorites: JSON.parse(localStorage.getItem("favSongs") || "[]"),
  history: JSON.parse(localStorage.getItem("hisSongs") || "[]"),
  toplists: [],
  activeToplistId: "",
  lyricLines: [],
  lyricActiveIndex: -1,
  lyricAutoScroll: true
};

function saveState() {
  localStorage.setItem("favSongs", JSON.stringify(state.favorites));
  localStorage.setItem("hisSongs", JSON.stringify(state.history));
}

function songKey(song) {
  return `${song.platform}|${song.id}`;
}

function setText(id, text) {
  const node = $(id);
  if (node) node.textContent = text || "";
}

function setMsg(id, text) {
  setText(id, text);
}

function setCover(id, cover) {
  const node = $(id);
  if (!node) return;

  if (cover) {
    node.style.backgroundImage = `url(${cover})`;
    node.classList.add("has-art");
    node.textContent = "";
  } else {
    node.style.backgroundImage = "";
    node.classList.remove("has-art");
    node.textContent = "♫";
  }
}

function setAuthUI() {
  setText("authState", state.loggedIn ? "✅ 已登录，可使用全部功能" : "❌ 未登录");
  setText("topAuthBadge", state.loggedIn ? "已登录" : "未登录");

  const disabled = !state.loggedIn;
  ["btnSearch", "btnParse", "btnFav", "btnLoadToplists"].forEach((id) => {
    const button = $(id);
    if (button) button.disabled = disabled;
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
  setMsg("authState", "登录状态已失效，请重新登录");
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
  const password = $("password")?.value?.trim() || "";
  if (!password) {
    setMsg("authState", "请输入登录密码");
    return;
  }

  const { status, data } = await api("/api/login", {
    method: "POST",
    body: { password }
  });

  if (status === 200 && data.code === 0) {
    state.loggedIn = true;
    setAuthUI();
    setMsg("authState", "登录成功");
    if ($("password")) $("password").value = "";
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

function addHistory(song) {
  state.history = [song, ...state.history.filter((item) => songKey(item) !== songKey(song))].slice(0, 50);
  saveState();
  renderHistory();
}

function addFavorite(song) {
  if (!song) return;
  if (state.favorites.find((item) => songKey(item) === songKey(song))) return;
  state.favorites.unshift(song);
  saveState();
  renderFavorites();
}

function removeFavorite(song) {
  state.favorites = state.favorites.filter((item) => songKey(item) !== songKey(song));
  saveState();
  renderFavorites();
}

function renderSongList(container, songs, options = {}) {
  if (!container) return;
  container.innerHTML = "";

  if (!songs.length) {
    container.innerHTML = `<div class="empty-hint">${options.emptyText || "暂无数据"}</div>`;
    return;
  }

  songs.forEach((song) => {
    const wrap = document.createElement("div");
    wrap.className = "song-item";

    const thumb = document.createElement("div");
    thumb.className = "song-thumb";
    if (song.cover) {
      thumb.classList.add("has-art");
      thumb.style.backgroundImage = `url(${song.cover})`;
      thumb.textContent = "";
    } else {
      thumb.textContent = "♫";
    }

    const info = document.createElement("div");
    info.innerHTML = `
      <div class="song-name">${song.name || "未知歌曲"}</div>
      <div class="song-meta">${song.artist || "未知歌手"} · ${platformText[song.platform] || song.platform || "未知平台"} · ID ${song.id}</div>
    `;

    const actions = document.createElement("div");
    actions.className = "song-actions";

    const playBtn = document.createElement("button");
    playBtn.className = "action-play";
    playBtn.type = "button";
    playBtn.textContent = "播放";
    playBtn.onclick = () => {
      $("parsePlatform").value = song.platform || "netease";
      $("ids").value = song.id;
      doParse();
    };

    actions.appendChild(playBtn);

    if (options.showFav) {
      const favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.textContent = "收藏";
      favBtn.onclick = () => addFavorite(song);
      actions.appendChild(favBtn);
    }

    if (options.showUnfav) {
      const unfavBtn = document.createElement("button");
      unfavBtn.type = "button";
      unfavBtn.textContent = "取消";
      unfavBtn.onclick = () => removeFavorite(song);
      actions.appendChild(unfavBtn);
    }

    wrap.appendChild(thumb);
    wrap.appendChild(info);
    wrap.appendChild(actions);
    container.appendChild(wrap);
  });
}

function renderFavorites() {
  renderSongList($("favList"), state.favorites, {
    showUnfav: true,
    emptyText: "还没有收藏歌曲"
  });
}

function renderHistory() {
  renderSongList($("hisList"), state.history, {
    showFav: true,
    emptyText: "还没有播放历史"
  });
}

function renderToplists() {
  const container = $("toplistList");
  if (!container) return;

  if (!state.toplists.length) {
    container.innerHTML = `<div class="empty-hint">暂无榜单，请点击“加载榜单”</div>`;
    return;
  }

  container.innerHTML = "";
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

async function loadToplists() {
  if (!state.loggedIn) {
    setMsg("toplistMsg", "请先登录");
    return;
  }

  const platform = $("rankPlatform").value;
  setMsg("toplistMsg", "正在加载榜单...");

  const { status, data } = await api("/api/toplists", {
    method: "POST",
    body: { platform }
  });

  if (status === 401) {
    onUnauthorized();
    return;
  }

  if (status !== 200 || data.code !== 0) {
    setMsg("toplistMsg", `加载失败：${data.message || "未知错误"}`);
    return;
  }

  state.toplists = data?.data?.toplists || [];
  state.activeToplistId = "";
  renderToplists();
  setMsg("toplistMsg", `加载完成：${state.toplists.length} 个榜单`);

  if (state.toplists.length > 0) {
    loadToplistSongs(state.toplists[0]);
  } else {
    renderSongList($("topSongList"), [], { emptyText: "暂无榜单歌曲" });
  }
}

async function loadToplistSongs(toplist) {
  if (!toplist || !toplist.id) return;

  const platform = $("rankPlatform").value;
  state.activeToplistId = toplist.id;
  renderToplists();

  setText("topSongsTitle", `${toplist.name} · 榜单歌曲`);
  setMsg("toplistMsg", `正在加载「${toplist.name}」...`);

  const { status, data } = await api("/api/toplist", {
    method: "POST",
    body: { platform, id: toplist.id }
  });

  if (status === 401) {
    onUnauthorized();
    return;
  }

  if (status !== 200 || data.code !== 0) {
    setMsg("toplistMsg", `榜单加载失败：${data.message || "未知错误"}`);
    return;
  }

  const songs = (data?.data?.songs || []).map((song) => ({
    ...song,
    platform: song.platform || platform
  }));

  renderSongList($("topSongList"), songs, { showFav: true, emptyText: "暂无歌曲" });
  setMsg("toplistMsg", `已加载 ${songs.length} 首歌曲${data.localCache ? "（缓存）" : ""}`);
}

async function doSearch() {
  if (!state.loggedIn) {
    setMsg("searchMsg", "请先登录");
    return;
  }

  const platform = $("searchPlatform").value;
  const keyword = $("keyword").value.trim();
  const page = Number($("page").value || 0);
  const pageSize = Number($("pageSize").value || 20);

  if (!keyword) {
    setMsg("searchMsg", "请输入关键词");
    return;
  }

  setMsg("searchMsg", "搜索中...");
  renderSongList($("searchList"), [], { emptyText: "正在加载，请稍候..." });

  const { status, data } = await api("/api/search", {
    method: "POST",
    body: { platform, keyword, page, pageSize }
  });

  if (status === 401) {
    onUnauthorized();
    return;
  }

  if (status !== 200 || data.code !== 0) {
    setMsg("searchMsg", `搜索失败：${data.message || "未知错误"}`);
    renderSongList($("searchList"), [], { emptyText: "暂无搜索结果" });
    return;
  }

  const songs = (data?.data?.songs || []).map((song) => ({
    ...song,
    platform: song.platform || platform
  }));

  setMsg("searchMsg", `搜索完成：${songs.length} 条结果${data.localCache ? "（命中缓存）" : ""}`);
  renderSongList($("searchList"), songs, { showFav: true, emptyText: "没有找到相关歌曲" });
}

function pickPlayableItem(parseResponse) {
  const list = parseResponse?.data?.data || [];
  return list.find((item) => item.success && item.url) || null;
}

function parseTimestamp(text) {
  const m = text.match(/^(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  const ms = Number((m[3] || "0").padEnd(3, "0"));
  return min * 60 + sec + ms / 1000;
}

function parseLyricsToTimeline(rawLyrics) {
  const text = (rawLyrics || "").toString().replace(/\r/g, "");
  const lines = text.split("\n").filter(Boolean);
  const timeline = [];
  const hasTimeTag = /\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/;

  lines.forEach((line) => {
    const tags = [...line.matchAll(/\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g)];
    const lyricText = line.replace(/\[(\d{1,2}:\d{2}(?:\.\d{1,3})?)\]/g, "").trim();

    if (!tags.length) {
      if (lyricText) timeline.push({ time: null, text: lyricText });
      return;
    }

    tags.forEach((tag) => {
      const ts = parseTimestamp(tag[1]);
      if (ts != null) {
        timeline.push({ time: ts, text: lyricText || "♪" });
      }
    });
  });

  if (!timeline.length && text.trim()) {
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({ time: null, text: line }));
  }

  if (!hasTimeTag.test(text)) {
    return timeline.map((item) => ({ ...item, time: null }));
  }

  return timeline.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}

function renderLyrics(lines) {
  const container = $("lyricsRealtime");
  if (!container) return;

  if (!lines.length) {
    container.innerHTML = `<div class="empty-hint">暂无歌词，请先播放一首歌曲</div>`;
    return;
  }

  container.innerHTML = "";
  lines.forEach((line, index) => {
    const node = document.createElement("div");
    node.className = "lyric-line";
    node.dataset.index = String(index);
    if (line.time == null) node.classList.add("dim");
    node.textContent = line.text || "♪";
    container.appendChild(node);
  });
}

function setActiveLyric(index) {
  const container = $("lyricsRealtime");
  if (!container) return;

  const prev = container.querySelector(".lyric-line.active");
  if (prev) prev.classList.remove("active");

  if (index < 0) return;
  const current = container.querySelector(`.lyric-line[data-index=\"${index}\"]`);
  if (!current) return;

  current.classList.add("active");

  if (state.lyricAutoScroll) {
    const targetTop = current.offsetTop - container.clientHeight * 0.35;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }
}

function updateLyricByTime(currentTime) {
  if (!state.lyricLines.length) return;

  const timed = state.lyricLines.filter((line) => typeof line.time === "number");
  if (!timed.length) return;

  let idx = -1;
  for (let i = 0; i < state.lyricLines.length; i += 1) {
    const line = state.lyricLines[i];
    if (typeof line.time !== "number") continue;
    if (currentTime >= line.time - 0.05) idx = i;
    else break;
  }

  if (idx !== state.lyricActiveIndex) {
    state.lyricActiveIndex = idx;
    setActiveLyric(idx);
  }
}

function setNowPlaying(meta) {
  setText("songTitle", `${meta.name} - ${meta.artist}`);
  setText("nowArtist", `${platformText[meta.platform] || meta.platform} · ${meta.album || "单曲"}`);
  setText("miniTitle", meta.name || "未知歌曲");
  setText("miniSub", meta.artist || "未知歌手");

  setCover("nowCover", meta.cover);
  setCover("miniCover", meta.cover);
}

async function doParse() {
  if (!state.loggedIn) {
    setMsg("parseMsg", "请先登录");
    return;
  }

  const platform = $("parsePlatform").value;
  const ids = $("ids").value.trim();
  const quality = $("quality").value;

  if (!ids) {
    setMsg("parseMsg", "请输入歌曲 ID");
    return;
  }

  setMsg("parseMsg", "解析中...");
  setText("raw", "");

  const { status, data } = await api("/api/parse", {
    method: "POST",
    body: { platform, ids, quality }
  });

  if (status === 401) {
    onUnauthorized();
    return;
  }

  setText("raw", JSON.stringify(data, null, 2));

  if (status !== 200 || data.code !== 0) {
    setMsg("parseMsg", `解析失败：${data.message || "未知错误"}`);
    return;
  }

  const song = pickPlayableItem(data);
  if (!song) {
    setMsg("parseMsg", "没有可播放资源，请更换平台/音质/ID");
    return;
  }

  const meta = {
    id: song.id || ids.split(",")[0],
    platform,
    name: song?.info?.name || "未知歌曲",
    artist: song?.info?.artist || "未知歌手",
    album: song?.info?.album || "",
    url: song.url,
    cover: song.cover || "",
    lyrics: song.lyrics || ""
  };

  state.currentSong = meta;
  setNowPlaying(meta);

  state.lyricLines = parseLyricsToTimeline(meta.lyrics);
  state.lyricActiveIndex = -1;
  renderLyrics(state.lyricLines);

  const player = $("player");
  player.src = meta.url;
  player.currentTime = 0;
  player.play().catch(() => {});

  addHistory(meta);
  setMsg("parseMsg", `播放成功${data.localCache ? "（命中缓存）" : ""}`);
}

function bindPlayerEvents() {
  const player = $("player");
  if (!player) return;

  player.addEventListener("timeupdate", () => {
    updateLyricByTime(player.currentTime || 0);
  });

  player.addEventListener("seeked", () => {
    updateLyricByTime(player.currentTime || 0);
  });
}

function bindDemoButtons() {
  document.querySelectorAll("[data-demo]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-demo") || "";
      const platform = button.getAttribute("data-platform") || "netease";
      $("parsePlatform").value = platform;
      $("searchPlatform").value = platform;
      $("rankPlatform").value = platform;
      $("ids").value = id;
      setMsg("parseMsg", `已填入 ${platformText[platform] || platform} 示例 ID，可直接解析播放`);
    });
  });
}

function bindActions() {
  $("btnLogin").onclick = doLogin;
  $("btnLogout").onclick = doLogout;
  $("btnSearch").onclick = doSearch;
  $("btnParse").onclick = doParse;
  $("btnLoadToplists").onclick = loadToplists;

  $("btnFav").onclick = () => {
    if (!state.currentSong) {
      setMsg("parseMsg", "当前没有可收藏的歌曲");
      return;
    }
    addFavorite(state.currentSong);
    setMsg("parseMsg", "已加入收藏");
  };

  $("btnAutoLyric").onclick = () => {
    state.lyricAutoScroll = !state.lyricAutoScroll;
    $("btnAutoLyric").textContent = `歌词自动滚动：${state.lyricAutoScroll ? "开" : "关"}`;
  };

  $("keyword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") doSearch();
  });

  $("ids").addEventListener("keydown", (event) => {
    if (event.key === "Enter") doParse();
  });
}

renderFavorites();
renderHistory();
renderToplists();
renderLyrics([]);
bindDemoButtons();
bindActions();
bindPlayerEvents();
checkMe();

