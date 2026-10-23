const $ = s => document.querySelector(s);
const base = new URL("./", location.href).pathname;
const NEWTAB = "speedster://newtab";
const HISTORY = "speedster://history";
const store = {
get(k, d) { try { const v = localStorage.getItem("spd:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
set(k, v) { try { localStorage.setItem("spd:" + k, JSON.stringify(v)); } catch { } }
};
const DEFAULT_TILES = [
{ title: "Google", url: "https://www.google.com/" },
{ title: "YouTube", url: "https://www.youtube.com/" },
{ title: "Wikipedia", url: "https://www.wikipedia.org/" },
{ title: "GitHub", url: "https://github.com/" },
{ title: "Reddit", url: "https://www.reddit.com/" },
{ title: "Spotify", url: "https://open.spotify.com/" },
{ title: "Twitch", url: "https://www.twitch.tv/" },
{ title: "Discord", url: "https://discord.com/app" }
];
const settings = Object.assign({ wisp: "", engine: "https://duckduckgo.com/?q=%s", cloak: "", panic: "", panicUrl: "https://classroom.google.com/", autoblank: false, bar: true, mode: "auto", pool: 6 }, store.get("settings", {}));
let tiles = store.get("tiles", DEFAULT_TILES);
let bookmarks = store.get("bookmarks", []);
let hist = store.get("history", []);
let closed = [];
let tabs = [];
let active = null;
let ready = false;
let seq = 0;
const isInternal = u => u.startsWith("speedster://");
const wispUrl = () => { let u = (settings.wisp || self.SPEEDSTER_WISP || "").trim(); if (!u) u = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/wisp/"; if (!/^wss?:\/\//.test(u)) u = "wss://" + u.replace(/^https?:\/\//, ""); if (!u.endsWith("/")) u += "/"; return u; };
const { ScramjetController } = $scramjetLoadController();
const scramjet = new ScramjetController({
prefix: base + "go/",
files: { wasm: base + "scram/scramjet.wasm.wasm", all: base + "scram/scramjet.all.js", sync: base + "scram/scramjet.sync.js" },
globals: { wrapfn: "$speedster$wrap", wrappropertybase: "$speedster__", wrappropertyfn: "$speedster$prop", cleanrestfn: "$speedster$clean", importfn: "$speedster$import", rewritefn: "$speedster$rewrite", metafn: "$speedster$meta", setrealmfn: "$speedster$setrealm", pushsourcemapfn: "$speedster$pushsourcemap", trysetfn: "$speedster$tryset", templocid: "$speedster$temploc", tempunusedid: "$speedster$tempunused" },
flags: { sourcemaps: false, captureErrors: true, allowInvalidJs: true, allowFailedIntercepts: true },
codec: {
encode: url => { if (!url) return url; let s = String(url), o = ""; for (let i = 0; i < s.length; i++) o += i % 2 ? String.fromCharCode(s.charCodeAt(i) ^ 3) : s[i]; return encodeURIComponent(o); },
decode: url => { if (!url) return url; let [h, ...q] = String(url).split("?"), s = decodeURIComponent(h), o = ""; for (let i = 0; i < s.length; i++) o += i % 2 ? String.fromCharCode(s.charCodeAt(i) ^ 3) : s[i]; return o + (q.length ? "?" + q.join("?") : ""); }
}
});
const conn = new BareMux.BareMuxConnection(base + "baremux/worker.js");
const proxied = u => scramjet.encodeUrl(u);
const favFor = u => { try { const h = new URL(u).hostname; return ready ? proxied("https://www.google.com/s2/favicons?sz=64&domain=" + h) : "icon.svg"; } catch { return "icon.svg"; } };
const toast = (() => { let el, t; return msg => { if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.append(el); } el.textContent = msg; el.classList.add("show"); clearTimeout(t); t = setTimeout(() => el.classList.remove("show"), 2600); }; })();
function resolve(input) {
const s = input.trim();
if (!s) return null;
if (isInternal(s)) return s;
if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
if (/^(localhost|\[[0-9a-f:]+\]|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(s)) return "http://" + s;
if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return "https://" + s;
return settings.engine.replace("%s", encodeURIComponent(s));
}
function display(u) {
if (u === NEWTAB) return "";
return u.replace(/^https?:\/\/(www\.)?/, m => m.startsWith("https") ? "" : m).replace(/\/$/, "");
}
function makeTab(url = NEWTAB, activate = true) {
const id = ++seq;
const el = document.createElement("div");
el.className = "tab";
el.draggable = true;
el.innerHTML = '<img class="fav" src="icon.svg" alt=""><i class="spin"></i><span class="title">New Tab</span><button class="x" title="Close tab"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
const iframe = document.createElement("iframe");
iframe.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media; picture-in-picture; gamepad; camera; microphone; geolocation");
iframe.setAttribute("allowfullscreen", "");
$("#views").append(iframe);
const frame = scramjet.createFrame(iframe);
const tab = { id, el, iframe, frame, url: NEWTAB, title: "New Tab", icon: "icon.svg", loading: false };
el.querySelector(".fav").onerror = e => { e.target.src = "icon.svg"; };
el.addEventListener("mousedown", e => { if (e.button === 1) { e.preventDefault(); closeTab(tab); } });
el.addEventListener("click", e => { if (e.target.closest(".x")) { e.stopPropagation(); closeTab(tab); } else select(tab); });
el.addEventListener("dragstart", e => { el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; });
el.addEventListener("dragend", () => { el.classList.remove("dragging"); tabs.sort((a, b) => [...$("#tabs").children].indexOf(a.el) - [...$("#tabs").children].indexOf(b.el)); persist(); });
el.addEventListener("dragover", e => { e.preventDefault(); const d = $(".tab.dragging"); if (!d || d === el) return; const r = el.getBoundingClientRect(); $("#tabs").insertBefore(d, e.clientX < r.left + r.width / 2 ? el : el.nextSibling); });
frame.addEventListener("urlchange", e => onUrl(tab, e.url));
frame.addEventListener("navigate", () => setLoading(tab, true));
iframe.addEventListener("load", () => onLoad(tab));
tabs.splice(active ? tabs.indexOf(active) + 1 : tabs.length, 0, tab);
if (active && active.el.nextSibling) $("#tabs").insertBefore(el, active.el.nextSibling); else $("#tabs").append(el);
layoutTabs();
if (activate) select(tab);
navigate(tab, url);
return tab;
}
function closeTab(tab) {
const i = tabs.indexOf(tab);
if (i < 0) return;
if (!isInternal(tab.url)) closed.push(tab.url);
if (closed.length > 25) closed.shift();
tabs.splice(i, 1);
tab.el.remove();
tab.iframe.remove();
if (!tabs.length) { active = null; makeTab(); return; }
if (active === tab) select(tabs[Math.min(i, tabs.length - 1)]);
layoutTabs();
persist();
}
function select(tab) {
active = tab;
for (const t of tabs) { t.el.classList.toggle("active", t === tab); t.iframe.classList.toggle("active", t === tab && !isInternal(t.url)); }
tab.el.scrollIntoView({ block: "nearest", inline: "nearest" });
syncChrome();
}
function navigate(tab, input) {
const url = resolve(input);
if (!url) return;
if (isInternal(url)) {
tab.url = url;
tab.title = url === HISTORY ? "History" : "New Tab";
tab.icon = "icon.svg";
setLoading(tab, false);
renderTab(tab);
if (tab === active) select(tab);
persist();
return;
}
if (!ready) { tab.pending = url; tab.url = url; tab.title = display(url); renderTab(tab); syncChrome(); return; }
tab.url = url;
tab.title = display(url);
setLoading(tab, true);
tab.frame.go(url);
renderTab(tab);
if (tab === active) select(tab);
persist();
}
function onUrl(tab, url) {
if (!url || url === "about:blank") return;
tab.url = url;
renderTab(tab);
if (tab === active) syncChrome();
persist();
}
function onLoad(tab) {
if (isInternal(tab.url)) return setLoading(tab, false);
let win, href;
try { win = tab.iframe.contentWindow; href = win.location.href; } catch { return setLoading(tab, false); }
if (!href.startsWith(location.origin + base + "go/")) return;
setLoading(tab, false);
try { const real = scramjet.decodeUrl(href); if (/^https?:/.test(real)) tab.url = real; } catch { }
readMeta(tab);
addHistory(tab);
hookKeys(win);
if (tab === active) syncChrome();
persist();
}
function readMeta(tab) {
let doc;
try { doc = tab.iframe.contentDocument; } catch { return; }
if (!doc) return;
const title = (doc.title || "").trim();
tab.title = title || display(tab.url);
let icon = null;
try {
const link = doc.querySelector('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]');
if (link) { const raw = link.getAttribute("href"); const href = link.href; if (href && href.startsWith(location.origin + base + "go/")) icon = href; else if (raw) icon = proxied(new URL(raw, tab.url).href); }
} catch { }
if (!icon) { try { icon = proxied(new URL("/favicon.ico", tab.url).href); } catch { icon = "icon.svg"; } }
tab.icon = icon;
renderTab(tab);
}
function setLoading(tab, on) {
tab.loading = on;
tab.el.classList.toggle("loading", on);
if (tab === active) progress(on);
if (tab === active) $("#reload").classList.toggle("loading", on);
}
let progTimer;
function progress(on) {
const bar = $("#progress"), i = bar.querySelector("i");
clearInterval(progTimer);
if (on) {
bar.classList.add("on");
let w = 8;
i.style.width = w + "%";
progTimer = setInterval(() => { w += (90 - w) * 0.08; i.style.width = w + "%"; }, 200);
} else {
i.style.width = "100%";
setTimeout(() => { bar.classList.remove("on"); setTimeout(() => { if (!active || !active.loading) i.style.width = "0"; }, 300); }, 200);
}
}
function renderTab(tab) {
tab.el.querySelector(".title").textContent = tab.title || "New Tab";
tab.el.title = tab.title + (isInternal(tab.url) ? "" : "\n" + tab.url);
const img = tab.el.querySelector(".fav");
if (img.getAttribute("src") !== tab.icon) img.src = tab.icon;
}
function layoutTabs() {
requestAnimationFrame(() => { for (const t of tabs) t.el.classList.toggle("narrow", t.el.offsetWidth < 90); });
}
function syncChrome() {
const tab = active;
if (!tab) return;
const addr = $("#address");
if (document.activeElement !== addr) addr.value = display(tab.url);
const omni = $("#omnibox");
omni.classList.toggle("internal", isInternal(tab.url) || !tab.url);
omni.classList.toggle("insecure", tab.url.startsWith("http:"));
$("#site-info").title = isInternal(tab.url) ? "Speedster page" : tab.url.startsWith("https:") ? "Connection is secure (end-to-end TLS via libcurl)" : "Not secure";
$("#newtab").classList.toggle("show", tab.url === NEWTAB);
$("#history-page").classList.toggle("show", tab.url === HISTORY);
if (tab.url === NEWTAB) renderTiles();
if (tab.url === HISTORY) renderHistory();
$("#star").classList.toggle("on", bookmarks.some(b => b.url === tab.url));
$("#reload").classList.toggle("loading", tab.loading);
$("#progress").classList.toggle("on", tab.loading);
document.title = cloak() ? cloak().title : tab.url === NEWTAB ? "Speedster" : (tab.title || "Speedster") + " - Speedster";
}
function persist() {
store.set("tabs", { list: tabs.map(t => t.pending || t.url), active: tabs.indexOf(active) });
}
function addHistory(tab) {
if (isInternal(tab.url)) return;
const last = hist[0];
if (last && last.url === tab.url) { last.title = tab.title; last.time = Date.now(); }
else hist.unshift({ url: tab.url, title: tab.title, time: Date.now() });
if (hist.length > 1500) hist.length = 1500;
store.set("history", hist);
}
function renderTiles() {
const box = $("#tiles");
box.innerHTML = "";
tiles.forEach((t, i) => {
const el = document.createElement("div");
el.className = "tile";
el.innerHTML = '<div class="ic"><img alt=""></div><span></span><button class="rm" title="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
el.querySelector("img").src = favFor(t.url);
el.querySelector("img").onerror = e => { e.target.src = "icon.svg"; };
el.querySelector("span").textContent = t.title;
el.onclick = e => { if (e.target.closest(".rm")) { tiles.splice(i, 1); store.set("tiles", tiles); renderTiles(); } else navigate(active, t.url); };
box.append(el);
});
const add = document.createElement("div");
add.className = "tile add";
add.innerHTML = '<div class="ic"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></div><span>Add shortcut</span>';
add.onclick = () => { const u = prompt("Shortcut URL"); if (!u) return; const url = resolve(u); let title; try { title = prompt("Name", new URL(url).hostname.replace(/^www\./, "")) || url; } catch { title = u; } tiles.push({ title, url }); store.set("tiles", tiles); renderTiles(); };
box.append(add);
}
function renderBookmarks() {
const bar = $("#bookmarks");
bar.classList.toggle("hide", !settings.bar);
bar.innerHTML = "";
for (const b of bookmarks) {
const el = document.createElement("button");
el.className = "bm";
el.title = b.title + "\n" + b.url;
el.innerHTML = '<img alt=""><span></span>';
el.querySelector("img").src = favFor(b.url);
el.querySelector("img").onerror = e => { e.target.src = "icon.svg"; };
el.querySelector("span").textContent = b.title;
el.onclick = e => { if (e.ctrlKey || e.metaKey) makeTab(b.url, false); else navigate(active, b.url); };
el.onauxclick = e => { if (e.button === 1) makeTab(b.url, false); };
el.oncontextmenu = e => { e.preventDefault(); if (confirm("Remove bookmark \"" + b.title + "\"?")) { bookmarks = bookmarks.filter(x => x !== b); store.set("bookmarks", bookmarks); renderBookmarks(); syncChrome(); } };
bar.append(el);
}
}
function renderHistory() {
const q = $("#hp-filter").value.trim().toLowerCase();
const list = $("#hp-list");
list.innerHTML = "";
let day = "";
for (const h of hist.filter(h => !q || h.url.toLowerCase().includes(q) || (h.title || "").toLowerCase().includes(q)).slice(0, 400)) {
const d = new Date(h.time);
const label = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
if (label !== day) { day = label; const el = document.createElement("div"); el.className = "hp-day"; el.textContent = label; list.append(el); }
const row = document.createElement("div");
row.className = "hp-row";
row.innerHTML = '<time></time><img alt=""><span class="t"></span><span class="u"></span>';
row.querySelector("time").textContent = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
row.querySelector("img").src = favFor(h.url);
row.querySelector("img").onerror = e => { e.target.src = "icon.svg"; };
row.querySelector(".t").textContent = h.title || h.url;
row.querySelector(".u").textContent = h.url;
row.onclick = () => navigate(active, h.url);
list.append(row);
}
if (!list.children.length) list.innerHTML = '<p style="color:var(--dim);padding:20px 10px">No history yet</p>';
}
const addr = $("#address");
let sel = -1, items = [];
function suggest() {
const q = addr.value.trim().toLowerCase();
const box = $("#suggest");
if (!q) { box.classList.remove("show"); items = []; return; }
const seen = new Set();
items = [{ kind: "go", text: addr.value.trim(), url: resolve(addr.value) }];
for (const h of [...bookmarks, ...hist]) {
if (items.length >= 7) break;
if (seen.has(h.url) || h.url === items[0].url) continue;
if (h.url.toLowerCase().includes(q) || (h.title || "").toLowerCase().includes(q)) { seen.add(h.url); items.push({ kind: "page", text: h.title || h.url, url: h.url }); }
}
sel = 0;
box.innerHTML = "";
items.forEach((it, i) => {
const el = document.createElement("div");
el.className = "sg" + (i === sel ? " sel" : "");
const searching = it.kind === "go" && it.url.startsWith(settings.engine.split("%s")[0]);
el.innerHTML = (searching ? '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>' : '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>') + '<span class="t"></span><span class="u"></span>';
el.querySelector(".t").textContent = it.text;
el.querySelector(".u").textContent = searching ? "— Search" : it.kind === "go" ? "" : "— " + display(it.url);
el.onmousedown = e => { e.preventDefault(); go(it.url); };
box.append(el);
});
box.classList.add("show");
}
function moveSel(d) {
if (!items.length) return;
sel = (sel + d + items.length) % items.length;
[...$("#suggest").children].forEach((c, i) => c.classList.toggle("sel", i === sel));
addr.value = items[sel].kind === "go" ? items[sel].text : items[sel].url;
}
function go(url) {
$("#suggest").classList.remove("show");
addr.blur();
if (url) navigate(active, url);
}
addr.addEventListener("input", suggest);
addr.addEventListener("focus", () => { $("#omnibox").classList.add("focus"); setTimeout(() => addr.select(), 0); });
addr.addEventListener("blur", () => { $("#omnibox").classList.remove("focus"); $("#suggest").classList.remove("show"); syncChrome(); });
addr.addEventListener("keydown", e => {
if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1); }
else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1); }
else if (e.key === "Escape") { addr.value = display(active.url); addr.blur(); }
});
$("#omnibox").addEventListener("submit", e => { e.preventDefault(); const it = items[sel]; go(it && $("#suggest").classList.contains("show") && it.kind === "page" ? it.url : resolve(addr.value)); });
$("#nt-form").addEventListener("submit", e => { e.preventDefault(); const v = $("#nt-input").value; $("#nt-input").value = ""; navigate(active, v); });
$("#back").onclick = () => { if (active && !isInternal(active.url)) active.frame.back(); };
$("#forward").onclick = () => { if (active && !isInternal(active.url)) active.frame.forward(); };
$("#reload").onclick = () => { if (!active || isInternal(active.url)) return; if (active.loading) { try { active.iframe.contentWindow.stop(); } catch { } setLoading(active, false); } else reload(active); };
$("#home").onclick = () => navigate(active, NEWTAB);
$("#newtab-btn").onclick = () => { makeTab(); $("#nt-input").focus(); };
$("#star").onclick = () => {
if (!active || isInternal(active.url)) return;
const i = bookmarks.findIndex(b => b.url === active.url);
if (i >= 0) { bookmarks.splice(i, 1); toast("Bookmark removed"); }
else { bookmarks.push({ title: active.title || display(active.url), url: active.url }); toast("Bookmarked"); }
store.set("bookmarks", bookmarks);
renderBookmarks();
syncChrome();
};
$("#hp-filter").addEventListener("input", renderHistory);
$("#hp-clear").onclick = () => { if (!confirm("Clear all browsing history?")) return; hist = []; store.set("history", hist); renderHistory(); };
function reload(tab) {
setLoading(tab, true);
try { tab.frame.reload(); } catch { tab.frame.go(tab.url); }
}
$("#menu-btn").onclick = e => { e.stopPropagation(); $("#menu").classList.toggle("show"); };
document.addEventListener("click", e => { if (!e.target.closest("#menu")) $("#menu").classList.remove("show"); });
$("#menu").onclick = e => {
const b = e.target.closest("button");
if (!b) return;
$("#menu").classList.remove("show");
action(b.dataset.act);
};
function action(a) {
if (a === "newtab") { makeTab(); $("#nt-input").focus(); }
if (a === "dup" && active) makeTab(active.url);
if (a === "reopen" && closed.length) makeTab(closed.pop());
if (a === "blank") openBlank();
if (a === "fullscreen") document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
if (a === "history") { const t = tabs.find(t => t.url === HISTORY); t ? select(t) : makeTab(HISTORY); }
if (a === "settings") openSettings();
}
function openBlank() {
const w = window.open("about:blank", "_blank");
if (!w) { toast("Allow pop-ups to open in about:blank"); return false; }
const c = cloak();
w.document.title = c ? c.title : "Speedster";
const link = w.document.createElement("link");
link.rel = "icon";
link.href = c ? c.icon : new URL("icon.svg", location.href).href;
w.document.head.append(link);
const f = w.document.createElement("iframe");
f.src = location.href.split("#")[0] + "#noblank";
f.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;margin:0";
f.allow = "fullscreen; autoplay; clipboard-read; clipboard-write; encrypted-media; picture-in-picture; gamepad; camera; microphone";
w.document.body.style.margin = "0";
w.document.body.append(f);
location.replace(settings.panicUrl || "https://classroom.google.com/");
return true;
}
function cloak() {
if (!settings.cloak) return null;
const [title, icon] = settings.cloak.split("|");
return { title, icon };
}
function applyCloak() {
const c = cloak();
$("#favicon").href = c ? c.icon : "icon.svg";
syncChrome();
}
function panic() { try { window.top.location.replace(settings.panicUrl || "https://classroom.google.com/"); } catch { location.replace(settings.panicUrl || "https://classroom.google.com/"); } }
function onKey(e) {
if (settings.panic && e.key === settings.panic && !e.ctrlKey && !e.altKey && !e.metaKey && !(e.target && (/^(input|textarea|select)$/i.test(e.target.tagName) || e.target.isContentEditable))) { e.preventDefault(); panic(); return; }
const k = e.key.toLowerCase();
if (e.altKey && !e.ctrlKey) {
if (k === "t" && e.shiftKey) { e.preventDefault(); action("reopen"); }
else if (k === "t") { e.preventDefault(); action("newtab"); }
else if (k === "w") { e.preventDefault(); closeTab(active); }
else if (k === "arrowleft") { e.preventDefault(); $("#back").click(); }
else if (k === "arrowright") { e.preventDefault(); $("#forward").click(); }
else if (k === "d") { e.preventDefault(); addr.focus(); }
else if (k === "h") { e.preventDefault(); action("history"); }
else if (k === ",") { e.preventDefault(); openSettings(); }
else if (/^[1-9]$/.test(k)) { e.preventDefault(); const t = k === "9" ? tabs[tabs.length - 1] : tabs[+k - 1]; if (t) select(t); }
}
if ((e.ctrlKey || e.metaKey) && !e.altKey) {
if (k === "l") { e.preventDefault(); addr.focus(); }
else if (k === "r") { e.preventDefault(); if (active && !isInternal(active.url)) reload(active); }
else if (k === "tab") { e.preventDefault(); const i = tabs.indexOf(active); select(tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length]); }
}
if (k === "f5") { e.preventDefault(); if (active && !isInternal(active.url)) reload(active); }
}
function hookKeys(win) {
try { if (win.__spdKeys) return; win.__spdKeys = 1; win.addEventListener("keydown", onKey, true); } catch { }
}
document.addEventListener("keydown", onKey, true);
window.addEventListener("resize", layoutTabs);
setInterval(() => { for (const t of tabs) if (!isInternal(t.url) && !t.loading) { let title; try { title = t.iframe.contentDocument && t.iframe.contentDocument.title; } catch { } if (title && title !== t.title) { t.title = title; renderTab(t); if (t === active) syncChrome(); } } }, 1500);
function openSettings() {
$("#s-wisp").value = settings.wisp || wispUrl();
$("#s-engine").value = settings.engine;
$("#s-cloak").value = settings.cloak;
$("#s-panic").value = settings.panic;
$("#s-panic-url").value = settings.panicUrl;
$("#s-autoblank").checked = settings.autoblank;
$("#s-bar").checked = settings.bar;
$("#s-mode").value = settings.mode;
$("#s-pool").value = String(settings.pool);
$("#settings").classList.add("show");
$("#modal-bg").classList.add("show");
testWisp(wispUrl(), $("#s-wisp-status"));
}
function closeSettings() { $("#settings").classList.remove("show"); $("#modal-bg").classList.remove("show"); }
$("#modal-bg").onclick = closeSettings;
$("[data-close]").onclick = closeSettings;
$("#s-panic").addEventListener("keydown", e => { e.preventDefault(); e.stopPropagation(); $("#s-panic").value = e.key === "Backspace" || e.key === "Escape" ? "" : e.key; }, true);
$("#s-wisp").addEventListener("change", () => testWisp($("#s-wisp").value.trim(), $("#s-wisp-status")));
$("#s-save").onclick = async () => {
const wisp = $("#s-wisp").value.trim();
const changed = wisp !== wispUrl() || $("#s-mode").value !== settings.mode || +$("#s-pool").value !== +settings.pool;
settings.wisp = wisp === ((self.SPEEDSTER_WISP || "") || ((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/wisp/")) ? "" : wisp;
settings.engine = $("#s-engine").value;
settings.cloak = $("#s-cloak").value;
settings.panic = $("#s-panic").value;
settings.panicUrl = $("#s-panic-url").value.trim() || "https://classroom.google.com/";
settings.autoblank = $("#s-autoblank").checked;
settings.bar = $("#s-bar").checked;
settings.mode = $("#s-mode").value;
settings.pool = +$("#s-pool").value || 6;
store.set("settings", settings);
applyCloak();
renderBookmarks();
closeSettings();
if (changed && ready) { await setTransport(); for (const t of tabs) if (!isInternal(t.url)) reload(t); }
toast("Settings saved");
};
$("#s-reset").onclick = async () => {
if (!confirm("Reset Speedster? This clears tabs, history, bookmarks, cookies and site data.")) return;
try { localStorage.clear(); sessionStorage.clear(); } catch { }
try { for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name); } catch { }
try { for (const k of await caches.keys()) await caches.delete(k); } catch { }
try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch { }
location.reload();
};
function testWisp(url, out) {
if (!url) return;
if (!url.endsWith("/")) url += "/";
const dot = $("#wisp-dot");
if (out) { out.className = "hint"; out.textContent = "Checking " + url + " ..."; }
const started = performance.now();
let ws, done = false;
const finish = (ok, msg) => {
if (done) return;
done = true;
try { ws.close(); } catch { }
dot.className = ok ? "ok" : "bad";
dot.title = ok ? "Wisp connected: " + url : "Wisp unreachable: " + url;
if (out) { out.className = "hint " + (ok ? "ok" : "bad"); out.textContent = msg; }
const st = $("#nt-status");
st.innerHTML = ok ? "Connected to <b>" + new URL(url.replace(/^ws/, "http")).host + "</b> · " + Math.round(performance.now() - started) + " ms" : "Wisp server unreachable · open settings to set one";
};
try {
ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
ws.onmessage = e => { const v = new DataView(e.data); finish(v.getUint8(0) === 3, v.getUint8(0) === 3 ? "Connected · " + Math.round(performance.now() - started) + " ms · buffer " + v.getUint32(5, true) + " · " + ({ auto: "Auto", edge: "Edge", secure: "Secure" })[settings.mode] + " mode" : "Not a Wisp server"); };
ws.onerror = () => finish(false, "Could not connect");
ws.onclose = () => finish(false, "Connection closed");
setTimeout(() => finish(false, "Timed out"), 6000);
} catch { finish(false, "Invalid URL"); }
}
$("#wisp-dot").onclick = openSettings;
async function setTransport() {
await conn.setTransport(base + "net.mjs", [{ wisp: wispUrl(), mode: settings.mode, pool: +settings.pool || 6, connections: [80, 60, 10] }]);
}
async function boot() {
if (settings.autoblank && window.top === window && !location.hash.includes("noblank") && openBlank()) return;
if (location.hash.includes("noblank")) history.replaceState(null, "", location.pathname + location.search);
applyCloak();
renderBookmarks();
const saved = store.get("tabs", null);
const list = saved && saved.list && saved.list.length ? saved.list : [NEWTAB];
for (const u of list) makeTab(u, false);
select(tabs[Math.min(Math.max(saved ? saved.active : 0, 0), tabs.length - 1)]);
testWisp(wispUrl());
if (!("serviceWorker" in navigator)) { toast("Service workers are unavailable in this browser"); return; }
try {
await scramjet.init();
await navigator.serviceWorker.register(base + "sw.js", { scope: base });
await navigator.serviceWorker.ready;
await setTransport();
} catch (e) {
console.error(e);
toast("Speedster failed to start: " + (e && e.message || e));
return;
}
ready = true;
for (const t of tabs) { const p = t.pending; if (p) { delete t.pending; navigate(t, p); } }
syncChrome();
renderBookmarks();
}
boot();
