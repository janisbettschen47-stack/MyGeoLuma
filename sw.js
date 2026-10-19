// Service Worker von MyGeoLuma: macht die Seite installierbar und offline nutzbar.
// - Eigene Dateien: Netzwerk zuerst (kurzes Zeitlimit), sonst Zwischenspeicher
// - Bibliotheken, Schriften, Flaggen, Kartendaten: aus dem Zwischenspeicher, im Hintergrund erneuert
// - Firebase-Daten (Anmeldung, Firestore) laufen nie über den Zwischenspeicher
const SHELL_CACHE = 'mygeoluma-shell-v13';
const RUNTIME_CACHE = 'mygeoluma-rt-v1';
const KEEP = [SHELL_CACHE, RUNTIME_CACHE];

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/logo-mark-256.png'
];

// Externe Dateien, die für den Start der App zwingend nötig sind
const CORE_EXTERNAL = [
  'https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js',
  'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore-compat.js'
];

// Nur diese fremden Quellen dürfen zwischengespeichert werden
function isCacheableExternal(url){
  if(url.hostname === 'cdn.jsdelivr.net') return true;
  if(url.hostname === 'www.gstatic.com') return url.pathname.startsWith('/firebasejs/');
  if(url.hostname === 'flagcdn.com') return true;
  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') return true;
  if(url.hostname === 'commons.wikimedia.org' || url.hostname === 'upload.wikimedia.org') return true;
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL_CACHE);
    // Einzeln laden: eine fehlende Datei soll die Installation nicht verhindern
    await Promise.all(SHELL_FILES.map((f) => shell.add(f).catch(() => {})));
    const rt = await caches.open(RUNTIME_CACHE);
    // Externe Dateien dürfen die Installation höchstens 8 Sekunden aufhalten
    const ext = Promise.all(CORE_EXTERNAL.map((u) =>
      fetch(u).then((r) => { if(r && r.ok) return rt.put(u, r); }).catch(() => {})
    ));
    await Promise.race([ext, new Promise((res) => setTimeout(res, 8000))]);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function okToStore(response){
  return response && (response.ok || response.type === 'opaque');
}

// Eigene Dateien: Netzwerk zuerst, nach 4 Sekunden oder bei Fehler der Zwischenspeicher
function networkFirst(request){
  return new Promise((resolve) => {
    let settled = false;
    const fallback = () => caches.match(request, { ignoreSearch: true })
      .then((c) => c || (request.mode === 'navigate' ? caches.match('./index.html') : undefined));
    const timer = setTimeout(() => {
      fallback().then((c) => { if(c && !settled){ settled = true; resolve(c); } });
    }, 4000);
    fetch(request).then((response) => {
      clearTimeout(timer);
      if(response && response.ok){
        const copy = response.clone();
        caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
      }
      if(!settled){ settled = true; resolve(response); }
    }).catch(() => {
      clearTimeout(timer);
      fallback().then((c) => { if(!settled){ settled = true; resolve(c || Response.error()); } });
    });
  });
}

// Externe Dateien: sofort aus dem Zwischenspeicher, im Hintergrund erneuern
function staleWhileRevalidate(request){
  return caches.open(RUNTIME_CACHE).then((cache) =>
    cache.match(request.url).then((cached) => {
      // Bei Bildern/Skripten ohne CORS wird die Datei per CORS neu geholt, damit sie
      // nicht als "opaque" gespeichert wird (belegt sonst unnötig viel Speicherplatz)
      const wantCors = request.mode === 'no-cors' && new URL(request.url).hostname !== 'commons.wikimedia.org';
      const fetchOnce = () => wantCors
        ? fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' })).catch(() => fetch(request))
        : fetch(request);
      const network = fetchOnce().then((response) => {
        if(okToStore(response)) cache.put(request.url, response.clone()).catch(() => {});
        return response;
      }).catch(() => cached || Response.error());
      return cached || network;
    })
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if(request.method !== 'GET') return;
  const url = new URL(request.url);

  if(url.origin === self.location.origin){
    event.respondWith(networkFirst(request));
    return;
  }
  if(isCacheableExternal(url)){
    event.respondWith(staleWhileRevalidate(request));
  }
  // Alles andere (Firebase, Anmeldung, APIs) geht unverändert übers Netz
});
