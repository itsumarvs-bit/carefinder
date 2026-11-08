if (!window.matchMedia) {
  const matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;
  window.matchMedia = matchMedia;
}

if (!document.querySelector('base')) {
  const base = document.createElement('base');
  base.href = 'http://localhost/';
  document.head.append(base);
}
