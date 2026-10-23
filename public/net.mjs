import LibcurlClient from "./libcurl/index.mjs";
const TTL = 15 * 60 * 1000;
const flat = h => { const o = {}; for (const [k, v] of Object.entries(h || {})) o[k] = Array.isArray(v) ? v : [String(v)]; return o; };
export default class SpeedsterNet {
constructor(o = {}) {
this.mode = o.mode || "auto";
this.wisp = o.wisp;
this.edge = o.edge || o.wisp.replace(/^ws/, "http").replace(/\/wisp\/?$/, "/");
this.edgeWs = this.edge.replace(/^http/, "ws");
this.curlOpts = { wisp: o.wisp, connections: o.connections || [80, 60, 10], pool: o.pool || 6 };
this.curl = null;
this.curlInit = null;
this.edgeOn = false;
this.avoid = new Map();
this.ready = false;
}
async init() {
if (this.mode !== "secure") {
try { const r = await fetch(this.edge + "edge?ping=1", { cache: "no-store", credentials: "omit" }); this.edgeOn = r.ok && !!(await r.json()).speedster; } catch { this.edgeOn = false; }
}
if (this.mode === "secure" || !this.edgeOn) await this.getCurl();
else if (this.mode === "auto") this.getCurl().catch(() => { });
this.ready = true;
}
getCurl() {
if (!this.curlInit) { this.curl = new LibcurlClient(this.curlOpts); this.curlInit = this.curl.init().then(() => this.curl); }
return this.curlInit;
}
meta() { }
useEdge(host) {
if (!this.edgeOn || this.mode === "secure") return false;
if (this.mode === "edge") return true;
const t = this.avoid.get(host);
if (t && Date.now() - t < TTL) return false;
if (t) this.avoid.delete(host);
return true;
}
async request(remote, method, body, headers, signal) {
if (!this.useEdge(remote.hostname)) return (await this.getCurl()).request(remote, method, body, headers, signal);
if (body && !(body instanceof ArrayBuffer) && typeof body !== "string") body = await new Response(body).arrayBuffer();
try {
const r = await this.edgeRequest(remote, method, body, headers, signal);
if (this.mode === "auto" && r.challenge) throw new Error("challenge");
return r.res;
} catch (e) {
if (signal && signal.aborted) throw e;
if (this.mode !== "auto") throw e;
this.avoid.set(remote.hostname, Date.now());
return (await this.getCurl()).request(remote, method, body, headers, signal);
}
}
async edgeRequest(remote, method, body, headers, signal) {
const d = JSON.stringify({ u: remote.href, m: method, h: headers });
const has = body != null && method !== "GET" && method !== "HEAD";
const r = await fetch(this.edge + "edge?d=" + encodeURIComponent(d), { method: has ? "POST" : "GET", body: has ? body : undefined, signal, credentials: "omit", cache: "no-store", redirect: "manual" });
const status = r.headers.get("x-spd-status");
if (!r.ok || !status) throw new Error(r.headers.get("x-spd-error") || "edge " + r.status);
const h = flat(JSON.parse(r.headers.get("x-spd-headers") || "{}"));
const challenge = !!h["x-spd-challenge"];
delete h["x-spd-challenge"];
return { challenge, res: { body: r.body || new ArrayBuffer(0), headers: h, status: +status, statusText: r.headers.get("x-spd-text") || "" } };
}
connect(url, protocols, requestHeaders, onopen, onmessage, onclose, onerror) {
let cur = null, done = false;
const viaCurl = async () => { const c = await this.getCurl(); if (done) return; cur = c.connect(url, protocols, requestHeaders, onopen, onmessage, (a, b) => { done = true; onclose(a, b); }, onerror); };
if (!this.useEdge(url.hostname)) { viaCurl().catch(() => onerror("connect failed")); return [d => cur && cur[0](d), (c, r) => { done = true; cur && cur[1](c, r); }]; }
const ws = new WebSocket(this.edgeWs + "edge?d=" + encodeURIComponent(JSON.stringify({ u: url.href, h: requestHeaders })), protocols);
ws.binaryType = "arraybuffer";
let opened = false;
ws.onopen = () => { opened = true; onopen(ws.protocol); };
ws.onmessage = e => onmessage(e.data);
ws.onclose = e => {
if (done) return;
if (!opened && this.mode === "auto") { this.avoid.set(url.hostname, Date.now()); viaCurl().catch(() => { done = true; onerror("connect failed"); onclose(1006, ""); }); return; }
done = true;
onclose(e.code, e.reason);
};
ws.onerror = () => { if (opened) onerror(""); };
cur = [d => ws.send(d), (c, r) => { try { ws.close(c, r); } catch { ws.close(); } }];
return [d => cur[0](d), (c, r) => { done = true; cur[1](c, r); }];
}
}
