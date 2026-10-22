import { connect } from "cloudflare:sockets";
const CONNECT = 1, DATA = 2, CONTINUE = 3, CLOSE = 4;
const BUF = 256;
const ACK = 32;
const TIMEOUT = 10000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const u32 = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
const packet = (type, id, payload) => { if (Array.isArray(payload)) payload = Uint8Array.from(payload); const len = payload ? payload.byteLength : 0; const p = new Uint8Array(5 + len); p[0] = type; new DataView(p.buffer).setUint32(1, id, true); if (len) p.set(payload instanceof Uint8Array ? payload : new Uint8Array(payload), 5); return p; };
const bytes = d => typeof d === "string" ? null : d instanceof Uint8Array ? d : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : new Uint8Array(d);
const readId = b => (b[1] | (b[2] << 8) | (b[3] << 16) | (b[4] << 24)) >>> 0;
const privateHost = h => { h = h.toLowerCase().replace(/^\[|\]$/g, ""); if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true; if (h === "::1" || h === "::" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return h.includes(":"); const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/); if (!m) return false; const [a, b] = [+m[1], +m[2]]; return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224; };
export default {
async fetch(req, env) {
const url = new URL(req.url);
if ((req.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
if (!url.pathname.startsWith("/wisp")) return new Response("Not found", { status: 404 });
return env.WISP.get(env.WISP.newUniqueId()).fetch(req);
}
if (url.pathname === "/wisp/" || url.pathname === "/wisp") return Response.json({ name: "Speedster Wisp", protocol: "wisp/1", buffer: BUF, upstream: !!env.UPSTREAM_WISP });
if (env.ASSETS) return env.ASSETS.fetch(req);
return new Response("Not found", { status: 404 });
}
};
export class Wisp {
constructor(state, env) { this.env = env; }
async fetch(req) {
const pair = new WebSocketPair();
const ws = pair[1];
ws.binaryType = "arraybuffer";
ws.accept();
new Session(ws, this.env, !!req.headers.get("x-speedster-hop")).start();
return new Response(null, { status: 101, webSocket: pair[0] });
}
}
class Session {
constructor(ws, env, hop) {
this.ws = ws;
this.hop = hop;
this.env = env;
this.streams = new Map();
this.up = null;
this.upQueue = [];
this.dead = false;
this.blocked = (env.BLOCKED_HOSTS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}
start() {
this.ws.addEventListener("message", e => this.onMessage(e.data));
this.ws.addEventListener("close", () => this.shutdown());
this.ws.addEventListener("error", () => this.shutdown());
this.send(packet(CONTINUE, 0, u32(BUF)));
}
send(p) { if (this.dead) return; try { this.ws.send(p); } catch { this.shutdown(); } }
shutdown() {
if (this.dead) return;
this.dead = true;
for (const st of this.streams.values()) this.close(st, 2, false);
if (this.up && this.up !== "pending") try { this.up.close(1000); } catch { }
try { this.ws.close(1000); } catch { }
}
onMessage(data) {
const b = bytes(data);
if (!b || b.byteLength < 5) return;
const type = b[0];
const id = readId(b);
const payload = b.subarray(5);
data = b;
if (type === CONNECT) return this.onConnect(id, payload);
const st = this.streams.get(id);
if (!st) return;
if (type === DATA) return this.onData(st, payload, data);
if (type === CLOSE) {
if (st.mode === "up") this.upSend(data);
return this.close(st, payload[0] || 2, false);
}
}
isBlocked(host) {
const h = host.toLowerCase();
if (!this.env.ALLOW_PRIVATE && privateHost(h)) return true;
return this.blocked.some(b => h === b || h.endsWith("." + b));
}
onConnect(id, payload) {
if (id === 0 || this.streams.has(id) || payload.byteLength < 4) return this.send(packet(CLOSE, id, [0x41]));
const kind = payload[0];
const port = payload[1] | (payload[2] << 8);
const host = dec.decode(payload.subarray(3)).trim();
if (kind !== 1) return this.send(packet(CLOSE, id, [0x41]));
if (!host || !port) return this.send(packet(CLOSE, id, [0x41]));
if (this.isBlocked(host)) return this.send(packet(CLOSE, id, [0x48]));
const st = { id, host, port, mode: "wait", queue: [], recv: 0, done: 0, acked: 0, chain: Promise.resolve(), closed: false, sock: null, writer: null };
this.streams.set(id, st);
this.open(st);
}
async open(st) {
let sock;
try {
sock = connect({ hostname: st.host, port: st.port }, { secureTransport: "off", allowHalfOpen: false });
sock.closed.catch(() => { });
let timer;
await Promise.race([sock.opened, new Promise((_, rej) => timer = setTimeout(() => rej(new Error("timeout")), TIMEOUT))]);
clearTimeout(timer);
} catch (e) {
try { sock && sock.close(); } catch { }
if (st.closed) return;
if (this.env.UPSTREAM_WISP && !this.hop) return this.viaUpstream(st);
const msg = String(e && e.message || e).toLowerCase();
return this.close(st, msg.includes("timeout") ? 0x43 : msg.includes("refused") ? 0x44 : 0x42, true);
}
if (st.closed) { try { sock.close(); } catch { } return; }
st.sock = sock;
st.writer = sock.writable.getWriter();
st.mode = "tcp";
for (const chunk of st.queue) this.write(st, chunk);
st.queue = [];
this.pump(st);
}
async pump(st) {
const reader = st.sock.readable.getReader();
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
if (st.sock) try { st.sock.close(); } catch { }
if (notify) this.send(packet(CLOSE, st.id, [reason]));
}
async upstream() {
if (this.up && this.up !== "pending") return this.up;
if (this.up === "pending") return new Promise(r => this.upQueue.push(r));
this.up = "pending";
let ws = null;
try {
const res = await fetch(this.env.UPSTREAM_WISP.replace(/^ws/, "http"), { headers: { Upgrade: "websocket", "x-speedster-hop": "1" } });
ws = res.webSocket;
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
