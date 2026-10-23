import { connect } from "cloudflare:sockets";
const CONNECT = 1, DATA = 2, CONTINUE = 3, CLOSE = 4;
const BUF = 1024;
const ACK = 64;
const TIMEOUT = 8000;
const PING = 25000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const packet = (type, id, payload) => { if (Array.isArray(payload)) payload = Uint8Array.from(payload); const len = payload ? payload.byteLength : 0; const p = new Uint8Array(5 + len); p[0] = type; new DataView(p.buffer).setUint32(1, id, true); if (len) p.set(payload instanceof Uint8Array ? payload : new Uint8Array(payload), 5); return p; };
const bytes = d => typeof d === "string" ? null : d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
const readId = b => (b[1] | (b[2] << 8) | (b[3] << 16) | (b[4] << 24)) >>> 0;
const privateHost = h => { h = h.toLowerCase().replace(/^\[|\]$/g, ""); if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true; if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return h.includes(":"); const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if (!m) return false; const [a, b] = [+m[1], +m[2]]; return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; };
const blockList = env => (env.BLOCKED_HOSTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const blocked = (env, host, self) => { const h = host.toLowerCase(); if (self && h === self) return true; if (!env.ALLOW_PRIVATE && privateHost(h)) return true; return blockList(env).some(b => h === b || h.endsWith("." + b)); };
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS", "access-control-allow-headers": "*", "access-control-expose-headers": "x-spd-status,x-spd-text,x-spd-headers,x-spd-error", "access-control-max-age": "86400" };
const DROP_REQ = new Set(["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "content-length", "accept-encoding", "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-real-ip", "forwarded", "via"]);
const DROP_RES = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "alt-svc", "nel", "report-to", "reporting-endpoints", "origin-trial", "p3p", "connection-allowlist", "connection-allowlist-report-only", "set-cookie"]);
const ascii = s => s.replace(/[\u007f-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
const edgeErr = (status, msg) => new Response(msg, { status, headers: { ...CORS, "x-spd-error": String(msg).slice(0, 200).replace(/[^\x20-\x7e]/g, "?") } });
const outHeaders = (h, extra) => { const o = new Headers(); for (const [k, v] of Object.entries(h || {})) { const key = k.toLowerCase(); if (DROP_REQ.has(key) || key.startsWith("cf-") || (extra && extra.has(key))) continue; for (const x of Array.isArray(v) ? v : [v]) try { o.append(k, String(x)); } catch { } } return o; };
const parseD = url => { try { return JSON.parse(url.searchParams.get("d") || ""); } catch { return null; } };
async function edgeFetch(req, env, url) {
if (url.searchParams.has("ping")) return Response.json({ speedster: true, edge: 1 }, { headers: CORS });
const d = parseD(url);
if (!d || !d.u) return edgeErr(400, "bad request");
let t;
try { t = new URL(d.u); } catch { return edgeErr(400, "bad url"); }
if (!/^https?:$/.test(t.protocol)) return edgeErr(400, "bad protocol");
if (blocked(env, t.hostname, url.hostname)) return edgeErr(403, "blocked host");
const method = (d.m || "GET").toUpperCase();
const body = method === "GET" || method === "HEAD" ? null : req.body;
let r;
try { r = await fetch(t.href, { method, headers: outHeaders(d.h), body, redirect: "manual" }); } catch (e) { return edgeErr(502, e && e.message || e); }
const h = {};
r.headers.forEach((v, k) => { if (!DROP_RES.has(k)) (h[k] = h[k] || []).push(v); });
const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
if (sc.length) h["set-cookie"] = sc;
if (r.headers.get("cf-mitigated")) h["x-spd-challenge"] = ["1"];
const nobody = method === "HEAD" || [101, 204, 205, 304].includes(r.status);
return new Response(nobody ? null : r.body, { status: 200, headers: { ...CORS, "content-type": "application/octet-stream", "cache-control": "no-store", "x-spd-status": String(r.status), "x-spd-text": ascii(r.statusText || ""), "x-spd-headers": ascii(JSON.stringify(h)) } });
}
async function edgeSocket(req, env, url) {
const d = parseD(url);
if (!d || !d.u) return new Response("bad request", { status: 400 });
let t;
try { t = new URL(d.u); } catch { return new Response("bad url", { status: 400 }); }
if (!/^wss?:$/.test(t.protocol)) return new Response("bad protocol", { status: 400 });
if (blocked(env, t.hostname, url.hostname)) return new Response("blocked host", { status: 403 });
t.protocol = t.protocol === "wss:" ? "https:" : "http:";
const h = outHeaders(d.h, new Set(["sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "sec-websocket-protocol"]));
h.set("Upgrade", "websocket");
const proto = req.headers.get("sec-websocket-protocol");
if (proto) h.set("Sec-WebSocket-Protocol", proto);
let r;
try { r = await fetch(t.href, { headers: h }); } catch (e) { return new Response(String(e && e.message || e), { status: 502 }); }
const up = r.webSocket;
if (!up) return new Response("upstream refused websocket (" + r.status + ")", { status: 502 });
const pair = new WebSocketPair();
const client = pair[0], ws = pair[1];
up.accept();
ws.accept();
const code = c => c === 1000 || (c >= 3000 && c <= 4999) ? c : 1000;
ws.addEventListener("message", e => { try { up.send(e.data); } catch { } });
up.addEventListener("message", e => { try { ws.send(e.data); } catch { } });
ws.addEventListener("close", e => { try { up.close(code(e.code), e.reason); } catch { } });
up.addEventListener("close", e => { try { ws.close(code(e.code), e.reason); } catch { } });
ws.addEventListener("error", () => { try { up.close(1011); } catch { } });
up.addEventListener("error", () => { try { ws.close(1011); } catch { } });
const chosen = r.headers.get("sec-websocket-protocol");
return new Response(null, { status: 101, webSocket: client, headers: chosen ? { "Sec-WebSocket-Protocol": chosen } : {} });
}
export default {
async fetch(req, env) {
const url = new URL(req.url);
if (req.method === "OPTIONS" && url.pathname.startsWith("/edge")) return new Response(null, { status: 204, headers: CORS });
const ws = (req.headers.get("Upgrade") || "").toLowerCase() === "websocket";
if (url.pathname === "/edge") return ws ? edgeSocket(req, env, url) : edgeFetch(req, env, url);
if (ws) {
if (!url.pathname.startsWith("/wisp")) return new Response("Not found", { status: 404 });
const shards = Math.max(1, +env.SHARDS || 16);
const colo = (req.cf && req.cf.colo) || "x";
return env.WISP.get(env.WISP.idFromName(colo + ":" + Math.floor(Math.random() * shards))).fetch(req);
}
if (url.pathname === "/wisp/" || url.pathname === "/wisp") return Response.json({ name: "Speedster Wisp", protocol: "wisp/1", buffer: BUF, edge: true, upstream: !!env.UPSTREAM_WISP, colo: req.cf && req.cf.colo }, { headers: CORS });
if (env.ASSETS) return env.ASSETS.fetch(req);
return new Response("Not found", { status: 404 });
}
};
export class Wisp {
constructor(state, env) { this.env = env; this.live = 0; }
async fetch(req) {
const pair = new WebSocketPair();
const ws = pair[1];
ws.binaryType = "arraybuffer";
ws.accept();
const url = new URL(req.url);
const m = url.pathname.match(/^\/wisp\/(.+):(\d+)$/);
if (m) new Direct(ws, this.env, decodeURIComponent(m[1]), +m[2], url.hostname).start();
else new Session(ws, this.env, !!req.headers.get("x-speedster-hop"), url.hostname).start();
return new Response(null, { status: 101, webSocket: pair[0] });
}
}
const openSocket = async (host, port) => {
const sock = connect({ hostname: host, port }, { secureTransport: "off", allowHalfOpen: false });
sock.closed.catch(() => { });
let timer;
try { await Promise.race([sock.opened, new Promise((_, rej) => timer = setTimeout(() => rej(new Error("timeout")), TIMEOUT))]); }
catch (e) { shut(sock); throw e; }
finally { clearTimeout(timer); }
return sock;
};
const shut = s => { try { const p = s && s.close(); if (p && p.catch) p.catch(() => { }); } catch { } };
const transient = e => /lost|reset|network|internal/i.test(String(e && e.message || e));
class Direct {
constructor(ws, env, host, port, self) { this.ws = ws; this.env = env; this.host = host; this.port = port; this.self = self; this.queue = []; this.writer = null; this.dead = false; }
start() {
this.ws.addEventListener("message", e => { const b = bytes(e.data); if (!b) return; if (this.writer) this.writer.write(b).catch(() => this.end()); else this.queue.push(b.slice()); });
this.ws.addEventListener("close", () => this.end());
this.ws.addEventListener("error", () => this.end());
this.open();
}
async open() {
if (!this.port || blocked(this.env, this.host, this.self)) return this.end();
try { this.sock = await openSocket(this.host, this.port); } catch { return this.end(); }
if (this.dead) return shut(this.sock);
this.writer = this.sock.writable.getWriter();
this.writer.closed.catch(() => { });
for (const b of this.queue.splice(0)) this.writer.write(b).catch(() => this.end());
const reader = this.sock.readable.getReader();
reader.closed.catch(() => { });
try { for (;;) { const { value, done } = await reader.read(); if (done || this.dead) break; if (value && value.byteLength) this.ws.send(value); } } catch { }
this.end();
}
end() { if (this.dead) return; this.dead = true; try { this.writer && this.writer.close().catch(() => { }); } catch { } shut(this.sock); try { this.ws.close(1000); } catch { } }
}
class Session {
constructor(ws, env, hop, self) {
this.ws = ws;
this.hop = hop;
this.env = env;
this.self = self;
this.streams = new Map();
this.up = null;
this.upQueue = [];
this.dead = false;
}
start() {
this.ws.addEventListener("message", e => this.onMessage(e.data));
this.ws.addEventListener("close", () => this.shutdown());
this.ws.addEventListener("error", () => this.shutdown());
this.send(packet(CONTINUE, 0, u32(BUF)));
this.ping = setInterval(() => this.send(packet(CONTINUE, 0, u32(BUF))), PING);
}
send(p) { if (this.dead) return; try { this.ws.send(p); } catch { this.shutdown(); } }
shutdown() {
if (this.dead) return;
this.dead = true;
clearInterval(this.ping);
for (const st of [...this.streams.values()]) this.close(st, 2, false);
if (this.up && this.up !== "pending") try { this.up.close(1000); } catch { }
try { this.ws.close(1000); } catch { }
}
onMessage(data) {
const b = bytes(data);
if (!b || b.byteLength < 5) return;
const type = b[0];
const id = readId(b);
const payload = b.subarray(5);
if (type === CONNECT) return this.onConnect(id, payload);
const st = this.streams.get(id);
if (!st) return;
if (type === DATA) return this.onData(st, payload, b);
if (type === CLOSE) {
if (st.mode === "up") this.upSend(b);
return this.close(st, payload[0] || 2, false);
}
}
onConnect(id, payload) {
if (id === 0 || this.streams.has(id) || payload.byteLength < 4) return this.send(packet(CLOSE, id, [0x41]));
const kind = payload[0];
const port = payload[1] | (payload[2] << 8);
const host = dec.decode(payload.subarray(3)).trim();
if (kind !== 1 || !host || !port) return this.send(packet(CLOSE, id, [0x41]));
if (blocked(this.env, host, this.self)) return this.send(packet(CLOSE, id, [0x48]));
const st = { id, host, port, mode: "wait", queue: [], recv: 0, done: 0, acked: 0, chain: Promise.resolve(), closed: false, sock: null, writer: null };
this.streams.set(id, st);
this.open(st);
}
async open(st) {
let sock, err;
for (let i = 0; i < 2 && !sock && !st.closed; i++) {
try { sock = await openSocket(st.host, st.port); } catch (e) { err = e; if (!transient(e)) break; }
}
if (!sock) {
if (st.closed) return;
if (this.env.UPSTREAM_WISP && !this.hop) return this.viaUpstream(st);
const msg = String(err && err.message || err).toLowerCase();
return this.close(st, msg.includes("timeout") ? 0x43 : msg.includes("refused") ? 0x44 : 0x42, true);
}
if (st.closed) return shut(sock);
st.sock = sock;
st.writer = sock.writable.getWriter();
st.writer.closed.catch(() => { });
st.mode = "tcp";
for (const chunk of st.queue) this.write(st, chunk);
st.queue = [];
this.pump(st);
}
async pump(st) {
const reader = st.sock.readable.getReader();
reader.closed.catch(() => { });
try {
for (;;) {
const { value, done } = await reader.read();
if (done || st.closed) break;
if (value && value.byteLength) this.send(packet(DATA, st.id, value));
}
} catch { }
this.close(st, 2, true);
}
onData(st, payload, raw) {
if (st.closed) return;
if (st.mode === "up") return this.upSend(raw);
st.recv++;
if (st.mode === "wait") return st.queue.push(payload.slice());
this.write(st, payload);
}
write(st, chunk) {
st.chain = st.chain.then(() => st.closed ? null : st.writer.write(chunk)).then(() => {
st.done++;
if (st.done - st.acked >= ACK) { st.acked = st.done; this.send(packet(CONTINUE, st.id, u32(Math.max(0, BUF - (st.recv - st.done))))); }
}).catch(() => this.close(st, 0x03, true));
}
close(st, reason, notify) {
if (st.closed) return;
st.closed = true;
this.streams.delete(st.id);
if (st.writer) st.writer.close().catch(() => { });
if (st.sock) shut(st.sock);
if (notify) this.send(packet(CLOSE, st.id, [reason]));
}
async upstream() {
if (this.up && this.up !== "pending") return this.up;
if (this.up === "pending") return new Promise(r => this.upQueue.push(r));
this.up = "pending";
try {
const res = await fetch(this.env.UPSTREAM_WISP.replace(/^ws/, "http"), { headers: { Upgrade: "websocket", "x-speedster-hop": "1" } });
const ws = res.webSocket;
if (!ws) throw new Error("no upgrade");
ws.binaryType = "arraybuffer";
ws.accept();
ws.addEventListener("message", e => this.onUpstream(e.data));
const lost = () => { this.up = null; for (const st of [...this.streams.values()]) if (st.mode === "up") this.close(st, 0x03, true); };
ws.addEventListener("close", lost);
ws.addEventListener("error", lost);
this.up = ws;
} catch { this.up = null; }
for (const r of this.upQueue.splice(0)) r(this.up);
return this.up;
}
upSend(p) { if (this.up && this.up !== "pending") try { this.up.send(p); } catch { } }
async viaUpstream(st) {
const ws = await this.upstream();
if (st.closed) return;
if (!ws) return this.close(st, 0x42, true);
st.mode = "up";
const host = enc.encode(st.host);
const body = new Uint8Array(3 + host.byteLength);
body[0] = 1; body[1] = st.port & 255; body[2] = st.port >> 8; body.set(host, 3);
this.upSend(packet(CONNECT, st.id, body));
for (const chunk of st.queue) this.upSend(packet(DATA, st.id, chunk));
st.queue = [];
}
onUpstream(data) {
data = bytes(data);
if (!data || data.byteLength < 5) return;
const type = data[0];
const id = readId(data);
if (id === 0) return;
const st = this.streams.get(id);
if (!st || st.mode !== "up") return;
this.send(data);
if (type === CLOSE) { st.closed = true; this.streams.delete(id); }
}
}
