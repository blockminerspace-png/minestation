/**
 * Service worker mínimo (cache/offline desligados).
 * Antes: importScripts remoto para 3nbf4.com — código de terceiros no scope do SW (risco de privacidade / hijack).
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
