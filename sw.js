// Service worker: permite instalar Horus como app (celular y Windows) y abrir la pantalla con mala señal.
// Los datos (Supabase) nunca se guardan aquí: siempre se piden en línea.
const CACHE = "horus-v2";
const BASE = [
  "./", "index.html", "css/horus.css", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png",
  "icons/emblema.png", "icons/favicon.png", "icons/omega.png", "icons/lafken.png",
  "js/config.js", "js/app.js", "js/nucleo.js", "js/publico.js", "js/equipos.js", "js/inventario.js",
  "js/servicios.js", "js/sala.js", "js/admin.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (siempre la versión más nueva); si no hay conexión, la copia guardada.
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Supabase, CDN, QR: directo a internet
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia));
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match("index.html")))
  );
});
