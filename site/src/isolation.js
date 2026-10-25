// GitHub Pages cannot send the headers that unlock SharedArrayBuffer (cross-origin isolation),
// but a service worker can add them to every response. On a visitor's first load the page
// registers it and reloads once; from then on the physics can use worker threads.
export function ensureIsolation() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (window.crossOriginIsolated) return;
  if (window.location.hostname === 'localhost' && window.location.port === '5173') return; // vite dev: skip
  const key = 'coi-reloaded';
  navigator.serviceWorker.register('/coi-sw.js', { scope: '/' }).then((reg) => {
    const reload = () => {
      if (sessionStorage.getItem(key)) return; // never loop
      sessionStorage.setItem(key, '1');
      window.location.reload();
    };
    if (reg.active && !navigator.serviceWorker.controller) reload();
    else navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true });
  }).catch(() => { /* no isolation: the sim stays single-threaded */ });
}
