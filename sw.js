/* Service Worker de Anapanasati.
 * - App: se precachea al instalar (index.html + los recursos que referencia) y se actualiza en segundo plano.
 * - Audio: se sirve desde la caché «anapanasati-audio-v1» si está, respondiendo también a peticiones
 *   por rangos (206), que es como el elemento <audio> pide los MP3. Si no está, va a la red.
 */
const VERSION_APP = "anapanasati-app-v2";
const CACHE_AUDIO = "anapanasati-audio-v1";
const BASE = new URL("./", self.location).href;
const NUCLEO = ["./", "./index.html", "./manifest.webmanifest", "./manifest-abierta.webmanifest", "./contenido.json",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil((async () => {
    const cache = await caches.open(VERSION_APP);
    await cache.addAll(NUCLEO);
    // Añadir los recursos con hash que referencia index.html (JS y CSS de Vite).
    try {
      const html = await (await fetch("./index.html", { cache: "no-store" })).text();
      const recursos = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
      if (recursos.length) await cache.addAll(recursos);
    } catch (_) { /* se cachearán al vuelo */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre !== VERSION_APP && nombre !== CACHE_AUDIO) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (evento) => {
  const req = evento.request;
  if (req.method !== "GET" || !req.url.startsWith(BASE)) return;
  const ruta = new URL(req.url).pathname;

  if (ruta.endsWith(".mp3")) {
    evento.respondWith(servirAudio(req));
  } else if (ruta.includes("/audio/") && ruta.endsWith(".json")) {
    evento.respondWith(primeroCache(req, CACHE_AUDIO));
  } else if (req.mode === "navigate") {
    evento.respondWith(primeroRed(req));
  } else if (ruta.endsWith("/contenido.json")) {
    // Trae la huella del audio vigente: siempre de la red si hay conexión.
    evento.respondWith(redYGuardar(req));
  } else {
    evento.respondWith(cacheYActualizar(req));
  }
});

async function servirAudio(req) {
  const cache = await caches.open(CACHE_AUDIO);
  // Coincidencia exacta, con ?v=: una versión nueva del audio no se confunde con la guardada.
  const guardada = await cache.match(req.url);
  if (!guardada) return fetch(req);
  const rango = req.headers.get("range");
  if (!rango) return guardada;
  const blob = await guardada.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(rango);
  const total = blob.size;
  let ini = m && m[1] ? parseInt(m[1], 10) : 0;
  let fin = m && m[2] ? parseInt(m[2], 10) : total - 1;
  if (m && !m[1] && m[2]) { ini = Math.max(0, total - parseInt(m[2], 10)); fin = total - 1; }
  fin = Math.min(fin, total - 1);
  if (ini > fin) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } });
  return new Response(blob.slice(ini, fin + 1), {
    status: 206,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(fin - ini + 1),
      "Content-Range": `bytes ${ini}-${fin}/${total}`,
      "Accept-Ranges": "bytes",
    },
  });
}

async function primeroCache(req, nombre) {
  const cache = await caches.open(nombre);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const resp = await fetch(req);
  if (resp.ok) cache.put(req, resp.clone());
  return resp;
}

async function primeroRed(req) {
  const cache = await caches.open(VERSION_APP);
  try {
    const resp = await fetch(req);
    if (resp.ok) cache.put("./index.html", resp.clone());
    return resp;
  } catch (_) {
    return (await cache.match("./index.html")) || Response.error();
  }
}

async function redYGuardar(req) {
  const cache = await caches.open(VERSION_APP);
  try {
    const resp = await fetch(req, { cache: "no-cache" });
    if (resp.ok) cache.put(req.url, resp.clone());
    return resp;
  } catch (_) {
    return (await cache.match(req.url)) || Response.error();
  }
}

async function cacheYActualizar(req) {
  const cache = await caches.open(VERSION_APP);
  const guardada = await cache.match(req);
  const red = fetch(req).then((resp) => {
    if (resp.ok) cache.put(req, resp.clone());
    return resp;
  }).catch(() => guardada);
  return guardada || red;
}
