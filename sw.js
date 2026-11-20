const CACHE_NAME = "quadra-app-shell-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./supabase-config.js",
  "./community.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("quadra-app-shell-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(async () => {
          const cachedPage = await caches.match("./index.html");
          if (cachedPage) return cachedPage;
          return caches.match("./");
        })
    );
    return;
  }

  if (["/community.js", "/supabase-config.js"].includes(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response.ok) return response;
          return caches.open(CACHE_NAME)
            .then((cache) => cache.put(request, response.clone()).then(() => response, () => response));
        })
        .catch((error) => caches.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          throw error;
        }))
    );
    return;
  }

  event.respondWith(
    caches.match(request)
      .then((cachedResponse) => cachedResponse || fetch(request))
  );
});
