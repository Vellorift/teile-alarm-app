// Teile-Alarm – service worker. Receives push messages (already decrypted
// by the browser) and shows them as notifications.
"use strict";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function safeHttpsUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Teile-Alarm", body: event.data ? event.data.text() : "" };
  }
  const url = safeHttpsUrl(data.url);
  const image = safeHttpsUrl(data.image);
  const options = {
    body: String(data.body || "").slice(0, 400),
    icon: "icon-192.png",
    badge: "badge.png",
    tag: data.tag ? String(data.tag) : undefined,
    data: { url },
    timestamp: Date.now(),
  };
  if (image) options.image = image;
  if (url) options.actions = [{ action: "open", title: "Anzeige öffnen" }];
  event.waitUntil(self.registration.showNotification(String(data.title || "Teile-Alarm").slice(0, 120), options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil(url ? self.clients.openWindow(url) : self.clients.openWindow("./"));
});
