(function sisiplusCore(global) {
  'use strict';

  const app = global.SisiPlus = global.SisiPlus || {};
  const adapters = new Map();
  let booted = false;
  let lampaInitialized = false;

  class Adapter {
    constructor(id) {
      if (!id) throw new Error('Адаптеру требуется уникальный id');
      this.id = id;
    }
    getName() { throw new Error('getName() не реализован'); }
    getCategories() { return Promise.resolve([]); }
    getFilters() { return Promise.resolve([]); }
    getCapabilities() { return {}; }
    search() { return Promise.resolve({ items: [], page: 1, totalPages: 1 }); }
    getList() { return Promise.resolve({ items: [], page: 1, totalPages: 1 }); }
    getVideo() { throw new Error('getVideo() не реализован'); }
  }

  function validateAdapter(adapter) {
    const methods = ['getName', 'getCategories', 'getFilters', 'search', 'getList', 'getVideo'];
    if (!adapter || typeof adapter.id !== 'string') throw new Error('Некорректный адаптер');
    methods.forEach((method) => {
      if (typeof adapter[method] !== 'function') throw new Error(`${adapter.id}: отсутствует ${method}()`);
    });
  }

  function registerAdapter(adapter) {
    validateAdapter(adapter);
    if (adapters.has(adapter.id)) throw new Error(`Адаптер ${adapter.id} уже зарегистрирован`);
    adapters.set(adapter.id, adapter);
    if (app.Settings) app.Settings.registerAdapter(adapter);
    return adapter;
  }

  function getAdapter(id) { return adapters.get(id); }
  function getAdapters() {
    return Array.from(adapters.values()).filter((adapter) =>
      !app.Settings || app.Settings.isAdapterEnabled(adapter.id)
    );
  }

  function notify(message) {
    if (global.Lampa && Lampa.Noty) Lampa.Noty.show(message);
    else console.warn('[SisiPlus]', message);
  }

  function openSource(adapter) {
    Lampa.Activity.push({
      title: adapter.getName(),
      component: 'sisiplus_main',
      adapterId: adapter.id,
      page: 1
    });
  }

  function showSources() {
    const sources = getAdapters().map((adapter) => ({ title: adapter.getName(), adapter }));
    if (!sources.length) {
      notify('Нет подключённых адаптеров');
      return;
    }
    if (sources.length === 1) {
      openSource(sources[0].adapter);
      return;
    }
    Lampa.Select.show({
      title: 'Источники SisiPlus',
      items: sources,
      onSelect: (item) => openSource(item.adapter),
      onBack: () => Lampa.Controller.toggle('menu')
    });
  }

  function addMenuButton() {
    if (Lampa.Menu && typeof Lampa.Menu.addButton === 'function') {
      Lampa.Menu.addButton(
        '<svg viewBox="0 0 64 64"><path fill="currentColor" d="M8 14h48v8H8zm0 14h30v8H8zm0 14h48v8H8z"/></svg>',
        'SisiPlus',
        showSources
      );
      return;
    }

    // Совместимость со старыми сборками Lampa без Menu.addButton.
    const list = document.querySelector('.menu .menu__list');
    if (!list || list.querySelector('[data-action="sisiplus"]')) return;
    const button = document.createElement('li');
    button.className = 'menu__item selector';
    button.dataset.action = 'sisiplus';
    button.innerHTML = '<div class="menu__ico">SP</div><div class="menu__text">SisiPlus</div>';
    button.addEventListener('hover:enter', showSources);
    list.appendChild(button);
  }

  function initLampa() {
    if (lampaInitialized || !global.Lampa) return;
    lampaInitialized = true;
    app.Settings.init();
    adapters.forEach((adapter) => app.Settings.registerAdapter(adapter));
    if (app.LiveTV) app.LiveTV.init();
    Lampa.Component.add('sisiplus_main', app.UI.createMainComponent);
    Lampa.Component.add('sisiplus_list', app.UI.createListComponent);
    app.UI.installHeaderFilter();
    if (Lampa.Search && typeof Lampa.Search.addSource === 'function') {
      Lampa.Search.addSource(app.UI.createSearchSource());
    }
    addMenuButton();
  }

  function boot() {
    if (booted) return;
    booted = true;
    if (!global.Lampa) {
      console.error('[SisiPlus] Lampa API не найден');
      return;
    }
    if (global.appready) initLampa();
    else Lampa.Listener.follow('app', (event) => event.type === 'ready' && initLampa());
  }

  Object.assign(app, { Adapter, registerAdapter, getAdapter, getAdapters, boot, showSources });
})(window);
