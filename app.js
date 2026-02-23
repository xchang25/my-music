const $ = (id) => document.getElementById(id);

const state = {
  loggedIn: false,
  currentSong: null,
  favorites: JSON.parse(localStorage.getItem("favSongs") || "[]"),
  history: JSON.parse(localStorage.getItem("hisSongs") || "[]")
};

function saveState() {
  localStorage.setItem("favSongs", JSON.stringify(state.favorites));
  localStorage.setItem("hisSongs", JSON.stringify(state.history));
}

function songKey(song) {
  return `${song.platform}|${song.id}`;
}

function setMsg(id, text) {
  $(id).textContent = text || "";
}

function setAuthUI() {
  $("authState").textContent = state.loggedIn ? "✅ 已登录" : "❌ 未登录";
  $("btnSearch").disabled = !state.loggedIn;
  $("btnParse").disabled = !state.loggedIn;
  $("btnFav").disabled = !state.loggedIn;
}

async function api(path, { method = "GET", body } = {}) {
  const opts = {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const resp = await fetch(path, opts);
  let data = {};
  try {
    data = await resp.json();
  } catch {
    data = {};
  }
  return { status: resp.status, ok: resp.ok, data };
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
    setAuthUI();
  } catch {
    state.loggedIn = false;
    setAuthUI();
  }
}

async function doLogin() {
  const password = $("password").value.trim();
  if (!password) return setMsg("authState", "请输入密码");

  const { status, data } = await api("/api/login", {
    method: "POST",
    body: { password }
  });

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
  setMsg("authState", "已退出");
}

function addHistory(song) {
  state.history = [song, ...state.history.filter((x) => songKey(x) !== songKey(song))].slice(0, 30);
  saveState();
  renderHistory();
}

function addFavorite(song) {
  if (!song) return;
  if (state.favorites.find((x) => songKey(x) === songKey(song))) return;
  state.favorites.unshift(song);
  saveState();
  renderFavorites();
}

function removeFavorite(song) {
  state.favorites = state.favorites.filter((x) => songKey(x) !== songKey(song));
  saveState();
  renderFavorites();
}

function renderSongList(container, songs, options = {}) {
  container.innerHTML = "";
  if (!songs.length) {
    container.innerHTML = `<div class="item">暂无数据</div>`;
    return;
  }

  songs.forEach((song) => {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="title">${song.name || "未知歌曲"} - ${song.artist || "未知歌手"}</div>
      <div class="meta">ID: ${song.id} ｜ 平台: ${song.platform || "-"}</div>
      <div class="row">
        <button data-action="play">播放</button>
        ${options.showFav ? `<button data-action="fav">收藏</button>` : ""}
        ${options.showUnfav ? `<button data-action="unfav">取消收藏</button>` : ""}
      </div>
    `;

    div.querySelector('[data-action="play"]').onclick = () => {
      $("parsePlatform").value = song.platform || "netease";
      $("ids").value = song.id;
      doParse();
    };

    if (options.showFav) {
      div.querySelector('[data-action="fav"]').onclick = () => addFavorite(song);
    }
    if (options.showUnfav) {
      div.querySelector('[data-action="unfav"]').onclick = () => removeFavorite(song);
    }

    container.appendChild(div);
  });
}

function renderFavorites() {
  renderSongList($("favList"), state.favorites, { showUnfav: true });
}

function renderHistory() {
  renderSongList($("hisList"), state.history, { showFav: true });
}

async function doSearch() {
  if (!state.loggedIn) return setMsg("searchMsg", "请先登录");

  const platform = $("searchPlatform").value;
  const keyword = $("keyword").value.trim();
  const page = Number($("page").value || 0);
  const pageSize = Number($("pageSize").value || 20);

  if (!keyword) return setMsg("searchMsg", "请输入关键词");

  setMsg("searchMsg", "搜索中...");
  $("searchList").innerHTML = "";

  const { status, data } = await api("/api/search", {
    method: "POST",
    body: { platform, keyword, page, pageSize }
  });

  if (status === 401) return onUnauthorized();
  if (status !== 200 || data.code !== 0) {
    return setMsg("searchMsg", `搜索失败：${data.message || "未知错误"}`);
  }

  const songs = data?.data?.songs || [];
  songs.forEach((s) => (s.platform = platform));
  setMsg("searchMsg", `搜索完成：${songs.length} 条${data.localCache ? "（缓存）" : ""}`);
  renderSongList($("searchList"), songs, { showFav: true });
}

function pickPlayableItem(parseResp) {
  const list = parseResp?.data?.data || [];
  return list.find((x) => x.success && x.url) || null;
}

async function doParse() {
  if (!state.loggedIn) return setMsg("parseMsg", "请先登录");

  const platform = $("parsePlatform").value;
  const ids = $("ids").value.trim();
  const quality = $("quality").value;
  if (!ids) return setMsg("parseMsg", "请输入歌曲ID");

  setMsg("parseMsg", "解析中...");
  $("raw").textContent = "";

  const { status, data } = await api("/api/parse", {
    method: "POST",
    body: { platform, ids, quality }
  });

  if (status === 401) return onUnauthorized();

  $("raw").textContent = JSON.stringify(data, null, 2);

  if (status !== 200 || data.code !== 0) {
    return setMsg("parseMsg", `解析失败：${data.message || "未知错误"}`);
  }

  const song = pickPlayableItem(data);
  if (!song) return setMsg("parseMsg", "没有可播放资源，请换平台/音质/ID");

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
  $("songTitle").textContent = `${meta.name} - ${meta.artist}`;
  $("player").src = meta.url;
  $("lyrics").textContent = meta.lyrics || "暂无歌词";
  $("player").play().catch(() => {});

  addHistory(meta);
  setMsg("parseMsg", `播放成功${data.localCache ? "（缓存）" : ""}`);
}

$("btnLogin").onclick = doLogin;
$("btnLogout").onclick = doLogout;
$("btnSearch").onclick = doSearch;
$("btnParse").onclick = doParse;
$("btnFav").onclick = () => {
  if (!state.currentSong) return setMsg("parseMsg", "当前没有歌曲");
  addFavorite(state.currentSong);
  setMsg("parseMsg", "已收藏");
};

renderFavorites();
renderHistory();
checkMe();

