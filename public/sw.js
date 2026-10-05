const CACHE_NAME = "profile-shell-v4";
const SHELL_ASSETS = ["/", "/style.css", "/app.js"];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// A phone notification arrives from the server (see lib/push.js) even when the app is closed.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Profile", {
      body: data.body || "",
      icon: "/icon-192.png?v=2",
      badge: "/icon-192.png?v=2",
      tag: data.tag || undefined,
      data: { url: data.url || "/" },
    })
  );
});

// Tapping it opens (or focuses) the app, on the screen the notification is about.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("focus" in client) {
          if ("navigate" in client) client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return; // cheque/session data must always be live, never cached
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
