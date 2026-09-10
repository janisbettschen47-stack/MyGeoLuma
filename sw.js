// Einfacher Service Worker: macht die Seite installierbar und sorgt dafür,
// dass sie auch bei kurzzeitig fehlender Internetverbindung nicht mit einem
// nackten Browser-Fehler abstürzt. Baut bewusst KEIN tiefes Offline-Erlebnis –
// Lernfortschritt & Login brauchen ohnehin eine Verbindung zu Firebase.
const CACHE_NAME = 'mygeoluma-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Nur eigene Seitenaufrufe (GET) behandeln – alles andere (Firebase, APIs,
  // Kartendaten) soll ganz normal übers Netzwerk laufen, nicht zwischenspeichern
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html')))
  );
});
