self.addEventListener('fetch', (evt) => {
  const url = new URL(evt.request.url);
  const isHTML = evt.request.headers.get('accept')?.includes('text/html');
  const isPreset = url.pathname.startsWith('/Battletech-Mobile-Skirmish/presets/');

  if (isHTML || isPreset) {
    // network-first for HTML and preset JSON
    evt.respondWith(
      fetch(evt.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(evt.request, copy));
        return res;
      }).catch(() => caches.match(evt.request))
    );
    return;
  }

  // default: cache-first
  evt.respondWith(
    caches.match(evt.request).then(c => c || fetch(evt.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(evt.request, copy));
      return res;
    }))
  );
});
