export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (!import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() => {
          if (!('caches' in window)) return null;
          return caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key))));
        })
        .then(() => {
          if (navigator.serviceWorker.controller) {
            window.location.reload();
          }
        })
        .catch((error) => {
          console.warn('Service worker cleanup failed:', error);
        });
    });
    return;
  }

  const canRegister =
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (!canRegister) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        registration.update();
      })
      .catch((error) => {
        console.warn('Service worker registration failed:', error);
      });
  });
}
