importScripts("scram/scramjet.all.js");
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => e.respondWith((async () => {
try {
await scramjet.loadConfig();
if (scramjet.route(e)) return await scramjet.fetch(e);
} catch (err) {
if (scramjet.route(e)) return new Response("Speedster engine error: " + err, { status: 500, headers: { "content-type": "text/plain" } });
}
return fetch(e.request);
})()));
