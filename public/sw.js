importScripts("scram/scramjet.all.js");
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
const CACHE = "spd-assets-__SPD_BUILD__";
const DEST = new Set(["script", "style", "font", "image", "worker", "sharedworker"]);
const MAX = 2500;
let puts = 0;
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => { for (const k of await caches.keys()) if (k.startsWith("spd-assets-") && k !== CACHE) await caches.delete(k); await self.clients.claim(); })()));
const life = res => {
const cc = (res.headers.get("cache-control") || "").toLowerCase();
if (/no-store|no-cache|private/.test(cc) || res.headers.has("set-cookie") || res.headers.has("vary") && /\*/.test(res.headers.get("vary"))) return 0;
const m = cc.match(/(?:s-)?max-age=(\d+)/);
if (m) return +m[1];
if (cc.includes("immutable")) return 31536000;
const exp = Date.parse(res.headers.get("expires") || "");
return exp ? Math.max(0, (exp - Date.now()) / 1000) : 0;
};
const key = req => req.url + "#" + req.destination;
async function cached(req) {
const c = await caches.open(CACHE);
const hit = await c.match(key(req));
if (!hit) return null;
if (+hit.headers.get("x-spd-exp") < Date.now()) { c.delete(key(req)); return null; }
return hit;
}
async function store(req, res) {
const ttl = life(res);
if (ttl < 300) return;
const h = new Headers(res.headers);
h.set("x-spd-exp", String(Date.now() + Math.min(ttl, 604800) * 1000));
const body = await res.blob();
if (body.size > 8 * 1024 * 1024) return;
const c = await caches.open(CACHE);
await c.put(key(req), new Response(body, { status: res.status, statusText: res.statusText, headers: h }));
if (++puts % 100 === 0) { const keys = await c.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) await c.delete(k); }
}
self.addEventListener("fetch", e => e.respondWith((async () => {
try {
await scramjet.loadConfig();
if (scramjet.route(e)) {
const cacheable = e.request.method === "GET" && DEST.has(e.request.destination) && !e.request.headers.has("range");
if (cacheable) { const hit = await cached(e.request).catch(() => null); if (hit) return hit; }
const res = await scramjet.fetch(e);
if (cacheable && res && res.status === 200 && life(res) >= 300) e.waitUntil(store(e.request, res.clone()).catch(() => { }));
return res;
}
} catch (err) {
if (scramjet.route(e)) return new Response("Speedster engine error: " + err, { status: 500, headers: { "content-type": "text/plain" } });
}
return fetch(e.request);
})()));
