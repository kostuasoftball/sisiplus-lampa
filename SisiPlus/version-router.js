(function sisiplusVersionRouter(global) {
  'use strict';

  if (global.__sisiplusVersionRouterStarted) return;
  global.__sisiplusVersionRouterStarted = true;

  const aliases = {
    '1.0.0': '1.0.0',
    '1.0.1': '1.0.1',
    '1.0.2': '1.0.2',
    '100': '1.0.0',
    '101': '1.0.1',
    '102': '1.0.2',
    'beta-1.0.0': 'beta-1.0.0',
    'beta1.0.0': 'beta-1.0.0'
  };

  function findOwnScript() {
    if (document.currentScript && document.currentScript.src) return document.currentScript;
    const scripts = Array.from(document.scripts || []);
    return scripts.reverse().find((node) => /\/SisiPlus\/dist\/sisiplus\.js(?:\?|$)/.test(node.src || ''));
  }

  const own = findOwnScript();
  if (!own) {
    console.error('[SisiPlus] Не удалось определить адрес загрузчика версий');
    return;
  }

  const ownUrl = new URL(own.src, global.location && global.location.href);
  const requested = ownUrl.searchParams.get('v') || '1.0.2';
  const version = aliases[requested] || '1.0.2';
  const module = document.createElement('script');
  module.async = false;
  module.src = new URL(`versions/${version}.js?v=${encodeURIComponent(version)}`, ownUrl).href;
  module.onerror = () => {
    const message = `Не удалось загрузить SisiPlus ${version}`;
    console.error('[SisiPlus]', message);
    if (global.Lampa && Lampa.Noty) Lampa.Noty.show(message);
  };
  (document.head || document.documentElement).appendChild(module);
})(window);
