(function sisiplusUi(global) {
  'use strict';

  const app = global.SisiPlus = global.SisiPlus || {};

  const Preview = (() => {
    let timer = 0;
    let active = null;
    let styleReady = false;

    function injectStyle() {
      if (styleReady || typeof document === 'undefined' || !document.head) return;
      styleReady = true;
      const style = document.createElement('style');
      style.textContent = [
        '.sisiplus-preview{position:absolute;inset:0;overflow:hidden;background:#000;z-index:2;pointer-events:none}',
        '.sisiplus-preview video{width:100%;height:100%;object-fit:cover}',
        '.sisiplus-preview--hidden{display:none}'
      ].join('');
      document.head.appendChild(style);
    }

    function unwrap(target) {
      if (!target) return null;
      if (target.nodeType === 1) return target;
      if (target[0] && target[0].nodeType === 1) return target[0];
      if (typeof target.get === 'function') return target.get(0);
      return null;
    }

    function hide() {
      clearTimeout(timer);
      timer = 0;
      if (!active) return;
      const video = active.querySelector('video');
      if (video) {
        try { video.pause(); } catch (error) {}
        video.removeAttribute('src');
        video.load();
      }
      active.remove();
      active = null;
    }

    function show(target, item) {
      hide();
      const enabled = !app.Settings || app.Settings.get('preview_enabled', true) !== false;
      if (!enabled || !item || !item.preview) return;
      const isAndroid = global.Lampa && Lampa.Platform && typeof Lampa.Platform.is === 'function' &&
        Lampa.Platform.is('android');
      if (isAndroid && app.Settings && app.Settings.get('preview_android', false) !== true) return;
      timer = setTimeout(() => {
        const root = unwrap(target);
        if (!root || root.isConnected === false) return;
        injectStyle();
        if (global.getComputedStyle && getComputedStyle(root).position === 'static') {
          root.style.position = 'relative';
        }
        const container = document.createElement('div');
        container.className = 'sisiplus-preview';
        const video = document.createElement('video');
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.src = item.preview;
        container.appendChild(video);
        root.appendChild(container);
        active = container;
        try {
          const promise = video.play();
          if (promise && typeof promise.catch === 'function') promise.catch(() => hide());
        } catch (error) {
          hide();
        }
      }, 900);
    }

    return { show, hide };
  })();

  function normalizeResult(result, page = 1) {
    if (Array.isArray(result)) return { items: result, page, totalPages: page };
    return {
      items: result.items || [],
      page: result.page || page,
      totalPages: result.totalPages || page
    };
  }

  function toLampaCard(item, adapterId) {
    const card = {
      ...item,
      adapterId,
      source: `sisiplus_${adapterId}`,
      name: item.title || item.name || String(item.id),
      title: item.title || item.name || String(item.id),
      poster: item.poster || item.image || '',
      img: item.poster || item.image || '',
      background_image: item.background || item.poster || item.image || '',
      quality: item.badge || item.quality || ''
    };
    // Lampa 3.x Maker читает события из params.emit. Старые Interaction-компоненты
    // игнорируют это поле и получают обработчики через cardRender/card_events.
    card.params = {
      style: { name: 'collection' },
      emit: {
        onlyEnter(target, data) {
          const selected = data || card;
          app.Player.playItem(selected, app.getAdapter(selected.adapterId));
        },
        onLong(target, data) { showCardMenu(data || card, app.getAdapter(adapterId)); },
        onFocus(target, data) { Preview.show(target, data || card); }
      }
    };
    return card;
  }

  function toCollection(result, adapterId) {
    const data = normalizeResult(result);
    return {
      results: data.items.map((item) => toLampaCard(item, adapterId)),
      page: data.page,
      total_pages: data.totalPages,
      collection: true,
      source: `sisiplus_${adapterId}`,
      params: { items: { mapping: 'grid', cols: 3, align_left: true } }
    };
  }

  function empty(component, error) {
    const message = error && error.message ? error.message : 'Ничего не найдено';
    const view = new Lampa.Empty({ descr: message });
    component.activity.loader(false);
    component.start = view.start.bind(view);
    const body = component.activity.render().find('.activity__body > div')[0];
    if (body) body.appendChild(view.render(true));
    component.activity.toggle();
  }

  function bindCard(card, item, adapter) {
    card.onEnter = () => app.Player.playItem(item, adapter);
    card.onMenu = () => showCardMenu(item, adapter);
    const originalFocus = card.onFocus;
    card.onFocus = (target, data) => {
      if (typeof originalFocus === 'function') originalFocus(target, data);
      Preview.show(target, data || item);
    };
  }

  function showCardMenu(item, adapter) {
    const options = [{ title: 'Открыть страницу источника', webpage: true }];
    if (item.country && adapter) {
      options.push({
        title: `Показать: ${app.AdapterUtils.countryLabel(item.country)}`,
        country: item.country
      });
    }
    Lampa.Select.show({
      title: item.title || item.name || 'SisiPlus',
      items: options,
      onBack: () => Lampa.Controller.toggle('content'),
      onSelect(option) {
        Lampa.Controller.toggle('content');
        if (option.country) {
          Lampa.Activity.push({
            title: `${adapter.getName()} · ${app.AdapterUtils.countryLabel(option.country)}`,
            component: 'sisiplus_list', adapterId: adapter.id, category: 'popular', page: 1,
            filters: { country: option.country }
          });
        } else if (!app.Player.openWebPage(item.webpageUrl)) Lampa.Noty.show('Не удалось открыть страницу');
      }
    });
  }

  async function loadMainLines(adapter) {
    const categories = await adapter.getCategories();
    // На стартовом экране достаточно трёх линий. Это заметно ускоряет открытие
    // источника на слабом Android TV и не провоцирует anti-bot несколькими запросами.
    const lines = await Promise.all(categories.slice(0, 3).map(async (category) => {
      try {
        const data = toCollection(await adapter.getList(category.id, 1), adapter.id);
        return {
          ...data,
          title: category.title,
          category,
          adapterId: adapter.id,
          url: category.id,
          card_events: {
            onEnter(card, item) { app.Player.playItem(item, adapter); },
            onMenu(card, item) { showCardMenu(item, adapter); }
          }
        };
      } catch (error) {
        console.warn(`[SisiPlus:${adapter.id}]`, category.id, error);
        return null;
      }
    }));
    const ready = lines.filter((line) => line && line.results.length);
    if (!ready.length) throw new Error('Источник не вернул доступных моделей');
    return ready;
  }

  function createLegacyMainComponent(object) {
    const component = new Lampa.InteractionMain(object);
    const adapter = app.getAdapter(object.adapterId);

    component.create = function create() {
      this.activity.loader(true);
      loadMainLines(adapter)
        .then((lines) => {
          this.build(lines);
          this.activity.loader(false);
        })
        .catch((error) => empty(this, error));
      return this.render();
    };

    component.onMore = (line) => Lampa.Activity.push({
      title: line.title,
      component: 'sisiplus_list',
      adapterId: adapter.id,
      category: line.category.id,
      page: 2
    });
    component.onAppend = (line) => {
      line.onAppend = (card) => {
        const originalFocus = card.onFocus;
        card.onFocus = (target, item) => {
          if (typeof originalFocus === 'function') originalFocus(target, item);
          Preview.show(target, item);
        };
      };
    };
    return component;
  }

  function createMakerMainComponent(object) {
    const adapter = app.getAdapter(object.adapterId);
    const component = Lampa.Maker.make('Main', object);
    component.use({
      onCreate() {
        loadMainLines(adapter)
          .then((lines) => this.build(lines))
          .catch((error) => {
            console.error('[SisiPlus:ui]', error);
            Lampa.Noty.show(error.message || 'Не удалось загрузить источник');
            this.build([]);
          });
      },
      onInstance(line, data) {
        line.use({
          onMore() {
            Lampa.Activity.push({
              title: data.title,
              component: 'sisiplus_list',
              adapterId: adapter.id,
              category: data.category.id,
              page: 2
            });
          }
        });
      },
      onPause: Preview.hide,
      onStop: Preview.hide,
      onDestroy: Preview.hide
    });
    return component;
  }

  function createMainComponent(object) {
    return Lampa.Maker && typeof Lampa.Maker.make === 'function'
      ? createMakerMainComponent(object)
      : createLegacyMainComponent(object);
  }

  function askSearch(adapter) {
    Lampa.Input.edit({ title: `Поиск — ${adapter.getName()}`, value: '', free: true, nosave: true }, (query) => {
      Lampa.Controller.toggle('content');
      if (!query || !query.trim()) return;
      Lampa.Activity.push({
        title: `Поиск: ${query.trim()}`,
        component: 'sisiplus_list',
        adapterId: adapter.id,
        query: query.trim(),
        page: 1
      });
    });
  }

  function showFilterOptions(adapter, object, filter) {
    const selected = object.filters && object.filters[filter.id] ? object.filters[filter.id] : 'all';
    const options = filter.options.map((option) => ({ ...option, selected: option.id === selected }));
    Lampa.Select.show({
      title: filter.title,
      items: options,
      onBack: () => Lampa.Controller.toggle('content'),
      onSelect(option) {
        Lampa.Controller.toggle('content');
        Lampa.Activity.push({
          ...object,
          title: `${adapter.getName()} · ${option.title}`,
          component: 'sisiplus_list',
          page: 1,
          filters: { ...(object.filters || {}), [filter.id]: option.id }
        });
      }
    });
  }

  function showListMenu(adapter, component, object) {
    Promise.all([adapter.getCategories(), adapter.getFilters(object)]).then(([categories, filters]) => {
      const items = [
        { title: 'Поиск', search: true },
        ...filters.map((filter) => {
          const selected = object.filters && object.filters[filter.id];
          const option = filter.options.find((entry) => entry.id === selected);
          return { title: `${filter.title}: ${option ? option.title : 'Все'}`, filter };
        }),
        ...categories
      ];
      Lampa.Select.show({
        title: adapter.getName(),
        items,
        onBack: () => Lampa.Controller.toggle('content'),
        onSelect: (item) => {
          if (item.search) askSearch(adapter);
          else if (item.filter) showFilterOptions(adapter, object, item.filter);
          else Lampa.Activity.push({
            title: item.title,
            component: 'sisiplus_list',
            adapterId: adapter.id,
            category: item.id,
            page: 1
          });
        }
      });
    }).catch((error) => console.error('[SisiPlus:ui]', error));
  }

  function createLegacyListComponent(object) {
    const component = new Lampa.InteractionCategory(object);
    const adapter = app.getAdapter(object.adapterId);
    const load = (params) => params.query
      ? adapter.search(params.query, params.page || 1, params.filters || {})
      : adapter.getList(params.category, params.page || 1, params.filters || {});

    component.create = function create() {
      this.activity.loader(true);
      Promise.resolve(load(object))
        .then((result) => {
          this.build(toCollection(result, adapter.id));
          this.activity.loader(false);
        })
        .catch((error) => empty(this, error));
    };
    component.nextPageReuest = (params, resolve, reject) => {
      Promise.resolve(load(params)).then((result) => resolve(toCollection(result, adapter.id)), reject);
    };
    component.cardRender = (params, item, card) => bindCard(card, item, adapter);
    component.onRight = () => showListMenu(adapter, component, object);
    return component;
  }

  function createMakerListComponent(object) {
    const adapter = app.getAdapter(object.adapterId);
    const load = (params) => params.query
      ? adapter.search(params.query, params.page || 1, params.filters || {})
      : adapter.getList(params.category, params.page || 1, params.filters || {});
    const component = Lampa.Maker.make('Category', object, (module) => {
      if (Lampa.Maker.module) module.toggle(Lampa.Maker.module('Category').MASK.base, 'Pagination');
    });
    component.use({
      onCreate() {
        Promise.resolve(load(object))
          .then((result) => this.build(toCollection(result, adapter.id)))
          .catch((error) => {
            console.error('[SisiPlus:ui]', error);
            Lampa.Noty.show(error.message || 'Не удалось загрузить список');
            this.build(toCollection([], adapter.id));
          });
      },
      onNext(resolve, reject) {
        Promise.resolve(load(object)).then(
          (result) => resolve(toCollection(result, adapter.id)),
          reject
        );
      },
      onRight() { showListMenu(adapter, component, object); },
      onPause: Preview.hide,
      onStop: Preview.hide,
      onDestroy: Preview.hide
    });
    return component;
  }

  function createListComponent(object) {
    return Lampa.Maker && typeof Lampa.Maker.make === 'function'
      ? createMakerListComponent(object)
      : createLegacyListComponent(object);
  }

  function createSearchSource() {
    return {
      title: 'SisiPlus',
      search(params, complete) {
        const enabled = app.Settings && app.Settings.get('age_confirmed', false);
        if (!enabled) return complete([]);
        Promise.all(app.getAdapters().map(async (adapter) => {
          try {
            const result = normalizeResult(await adapter.search(params.query, 1, {}));
            return result.items.map((item) => toLampaCard(item, adapter.id));
          } catch (error) {
            console.warn(`[SisiPlus:${adapter.id}:search]`, error);
            return [];
          }
        })).then((groups) => complete(groups.flat()));
      },
      onCancel() {},
      onSelect(params, close) {
        if (close) close();
        app.Player.playItem(params.element, app.getAdapter(params.element.adapterId));
      },
      params: {
        lazy: true,
        align_left: true,
        card_events: { onMenu(card, item) { showCardMenu(item, app.getAdapter(item.adapterId)); } }
      }
    };
  }

  app.UI = { createMainComponent, createListComponent, createSearchSource, toLampaCard, Preview };
})(window);
