(function sisiplusLoader(global) {
  'use strict';

  if (global.__sisiplusLoaderStarted) return;
  global.__sisiplusLoaderStarted = true;

  const script = document.currentScript;
  const baseUrl = new URL('.', script && script.src ? script.src : global.location.href);
  const scriptUrl = new URL(script && script.src ? script.src : global.location.href);
  const version = scriptUrl.searchParams.get('v') || (script && script.dataset.version) || 'beta-1.0.1';
  global.SisiPlusVersion = version;
  const coreModules = ['api.js', 'adapter-utils.js', 'auth.js', 'player.js', 'livetv.js', 'ui.js', 'settings.js', 'core.js'];
  const fallbackAdapterModules = [
    'adapters/live-base.js',
    'adapters/pornhub.js', 'adapters/xvideos.js', 'adapters/xhamster.js', 'adapters/efukt.js',
    'adapters/bongacams.js', 'adapters/runetki.js', 'adapters/chaturbate.js', 'adapters/stripchat.js'
  ];

  function loadModule(path) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, baseUrl).href;
      const versionedUrl = new URL(url);
      versionedUrl.searchParams.set('v', version);
      const moduleUrl = versionedUrl.href;
      const existing = Array.from(document.scripts).find((node) => node.src === moduleUrl);

      if (existing && existing.dataset.sisiplusLoaded === 'true') {
        resolve();
        return;
      }

      const node = existing || document.createElement('script');
      node.async = false;
      node.dataset.sisiplusModule = path;
      node.onload = () => {
        node.dataset.sisiplusLoaded = 'true';
        resolve();
      };
      node.onerror = () => reject(new Error(`Не удалось загрузить модуль ${path}`));

      if (!existing) {
        node.src = moduleUrl;
        (document.head || document.documentElement).appendChild(node);
      }
    });
  }

  async function getAdapterModules() {
    if (Array.isArray(global.SisiPlusAdapterModules)) return global.SisiPlusAdapterModules;
    if (typeof fetch !== 'function') return fallbackAdapterModules;
    try {
      const response = await fetch(new URL('adapters/manifest.json', baseUrl).href, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (!manifest || !Array.isArray(manifest.adapters)) throw new Error('Некорректный manifest');
      return manifest.adapters
        .filter((item) => typeof item === 'string' || item.enabled !== false)
        .map((item) => typeof item === 'string' ? item : item.module)
        .filter((path) => typeof path === 'string' && path.length > 0);
    } catch (error) {
      console.warn('[SisiPlus] Не удалось прочитать adapters/manifest.json:', error);
      return fallbackAdapterModules;
    }
  }

  coreModules
    .reduce((chain, path) => chain.then(() => loadModule(path)), Promise.resolve())
    .then(() => getAdapterModules())
    .then((adapterModules) => adapterModules.reduce(
      (chain, path) => chain.then(() => loadModule(path).catch((error) => {
        // Отказ одного независимого адаптера не должен останавливать ядро.
        console.error('[SisiPlus]', error);
      })),
      Promise.resolve()
    ))
    .then(() => global.SisiPlus && global.SisiPlus.boot())
    .catch((error) => {
      console.error('[SisiPlus]', error);
      if (global.Lampa && global.Lampa.Noty) global.Lampa.Noty.show(error.message);
    });
})(window);
