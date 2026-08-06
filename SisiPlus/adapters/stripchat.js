(function stripchatAdapterModule(global) {
  'use strict';

  const app = global.SisiPlus;
  if (!app || !app.Adapter || !app.Api) throw new Error('SisiPlus core не загружен');

  const API_URL = 'https://go.rmhfrtnd.com/api/models';
  const SITE_URL = 'https://ru.stripchat.com';
  const PAGE_SIZE = 60;
  const SEARCH_PAGE_SIZE = 400;

  class StripchatAdapter extends app.Adapter {
    constructor() {
      super('stripchat');
      this.models = new Map();
    }

    getName() { return 'Stripchat'; }

    getFilters() {
      return Promise.resolve([app.AdapterUtils.countryFilter()]);
    }

    getCategories() {
      return Promise.resolve([
        { id: 'popular', title: 'Популярные' },
        { id: 'girls/best', title: 'Девушки' },
        { id: 'girls/new', title: 'Новые модели' },
        { id: 'girls/russian', title: 'Русскоязычные' },
        { id: 'couples/best', title: 'Пары' },
        { id: 'men/best', title: 'Парни' },
        { id: 'trans/best', title: 'Транс-модели' },
        { id: 'girls/vr', title: 'VR-камеры' }
      ]);
    }

    requestModels({ limit = PAGE_SIZE, offset = 0, tag = '', country = '' } = {}) {
      const url = new URL(API_URL);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('sortBy', 'viewersCount');
      url.searchParams.set('sortOrder', 'desc');
      if (tag && tag !== 'popular') url.searchParams.set('tag', tag);
      if (country && country !== 'all') url.searchParams.set('modelsCountry', country);
      const key = `stripchat:${url.searchParams.toString()}`;
      return app.Api.cached(key, () => app.Api.siteJson(url.href, { referer: `${SITE_URL}/` }), 30_000);
    }

    mapModel(model) {
      this.models.set(String(model.id), model);
      const status = model.status === 'public' ? 'LIVE' : String(model.status || '').toUpperCase();
      const country = String(model.modelsCountry || '').toLowerCase();
      return {
        id: String(model.id),
        title: model.username,
        poster: model.snapshotUrl || model.widgetPreviewUrl || model.avatarUrl || '',
        background: model.previewUrlThumbBig || model.previewUrl || model.snapshotUrl || '',
        preview: model.previewUrl || '',
        badge: [status, model.viewersCount ? `${model.viewersCount} зр.` : '', country ? app.AdapterUtils.countryLabel(country) : ''].filter(Boolean).join(' · '),
        webpageUrl: `${SITE_URL}/${encodeURIComponent(model.username)}`,
        country,
        sourceData: model
      };
    }

    async getList(category = 'popular', page = 1, filters = {}) {
      const currentPage = Math.max(1, Number(page) || 1);
      const data = await this.requestModels({
        limit: PAGE_SIZE,
        offset: (currentPage - 1) * PAGE_SIZE,
        tag: category,
        country: filters.country || ''
      });
      return {
        items: (data.models || []).map((model) => this.mapModel(model)),
        page: currentPage,
        totalPages: Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE))
      };
    }

    async search(query, page = 1, filters = {}) {
      const needle = String(query || '').trim().toLocaleLowerCase('ru');
      if (!needle) return { items: [], page: 1, totalPages: 1 };

      const maxPages = Math.max(1, Number(app.Settings ? app.Settings.get('search_pages', 6) : 6));
      const matches = [];
      // API не предоставляет стабильный полнотекстовый параметр. Страницы читаются
      // небольшими параллельными группами и кэшируются на 30 секунд.
      for (let start = 0; start < maxPages; start += 3) {
        const indexes = Array.from({ length: Math.min(3, maxPages - start) }, (_, i) => start + i);
        const batches = await Promise.all(indexes.map((index) =>
          this.requestModels({ limit: SEARCH_PAGE_SIZE, offset: index * SEARCH_PAGE_SIZE, country: filters.country || '' })
        ));
        batches.forEach((data) => (data.models || []).forEach((model) => {
          if (String(model.username || '').toLocaleLowerCase('ru').includes(needle)) matches.push(model);
        }));
        if (matches.length >= PAGE_SIZE) break;
      }

      const unique = Array.from(new Map(matches.map((model) => [String(model.id), model])).values());
      const currentPage = Math.max(1, Number(page) || 1);
      const slice = unique.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
      return {
        items: slice.map((model) => this.mapModel(model)),
        page: currentPage,
        totalPages: Math.max(1, Math.ceil(unique.length / PAGE_SIZE))
      };
    }

    async getVideo(id, item = {}) {
      let model = item.sourceData || this.models.get(String(id));
      if (!model) {
        const data = await this.requestModels({ limit: SEARCH_PAGE_SIZE });
        model = (data.models || []).find((candidate) => String(candidate.id) === String(id));
      }

      const username = model && model.username ? model.username : item.title;
      const urls = model && model.stream ? (model.stream.urls || {}) : {};
      const fallback = model && model.stream ? model.stream.url : '';
      const streams = { ...urls };
      if (fallback && !streams.original) streams.original = fallback;

      return {
        title: username || 'Stripchat',
        poster: model ? (model.snapshotUrl || model.avatarUrl || '') : (item.poster || ''),
        streams,
        webpageUrl: item.webpageUrl || (username ? `${SITE_URL}/${encodeURIComponent(username)}` : SITE_URL),
        headers: { Referer: `${SITE_URL}/`, Origin: SITE_URL }
      };
    }
  }

  app.registerAdapter(new StripchatAdapter());
})(window);
