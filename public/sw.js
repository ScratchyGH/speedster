importScripts("scram/scramjet.all.js");
const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => e.respondWith((async () => {
await scramjet.loadConfig();
if (scramjet.route(e)) return scramjet.fetch(e);
return fetch(e.request);
})()));
