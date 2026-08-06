(function sisiplusLiveBase(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  const LIVE_COUNTRIES = ['all', 'ru', 'ua', 'us', 'de', 'fr', 'es', 'it', 'br', 'pl', 'jp', 'in']
    .map((id) => ({ id, title: U.COUNTRY_NAMES[id] }));

  class BongaNetworkAdapter extends app.Adapter {
    constructor(id, config) {
      super(id);
      this.config = config;
      this.models = new Map();
    }
    getName() { return this.config.name; }
    getCategories() {
      return Promise.resolve([
        { id: 'all', title: 'Популярные' }, { id: 'new', title: 'Новые' },
        { id: 'female', title: 'Девушки' }, { id: 'couples', title: 'Пары' },
        { id: 'male', title: 'Парни' }, { id: 'transsexual', title: 'Транс-модели' }
      ]);
    }
    getFilters() { return Promise.resolve([U.countryFilter(LIVE_COUNTRIES)]); }
    async requestModels(category, offset, limit) {
      const url = new URL(`${this.config.host}/tools/listing_v3.php`);
      url.searchParams.set('livetab', category || 'all');
      url.searchParams.set('offset', String(offset || 0));
      url.searchParams.set('limit', String(limit || 72));
      const headers = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
      return app.Api.cached(`${this.id}:${url}`, () => app.Api.siteJson(url.href, {
        referer: `${this.config.host}/`, headers
      }), 20_000);
    }
    mapModel(model) {
      const username = model.username;
      const id = String(username || model.id || '');
      const poster = U.absolute(this.config.host, String(model.thumb_image || '').replace('{ext}', 'jpg'));
      const country = U.normalizeLanguage(model.country || model.lang || '');
      const item = {
        id, title: model.display_name || username, poster, background: poster,
        badge: [model.vq, model.viewers ? `${model.viewers} зр.` : '', country ? U.countryLabel(country) : ''].filter(Boolean).join(' · '),
        webpageUrl: `${this.config.roomBase}/${encodeURIComponent(username)}`,
        country, sourceData: model
      };
      this.models.set(id, model);
      return item;
    }
    async getList(category = 'all', page = 1, filters = {}) {
      const current = Math.max(1, Number(page) || 1);
      const country = filters.country && filters.country !== 'all' ? filters.country : '';
      const limit = country ? Math.min(1200, current * 400) : 72;
      const data = await this.requestModels(category, country ? 0 : (current - 1) * limit, limit);
      let models = data.models || [];
      if (country) models = models.filter((model) => U.normalizeLanguage(model.country || model.lang) === country);
      const start = country ? (current - 1) * 72 : 0;
      return U.result(models.slice(start, start + 72).map((model) => this.mapModel(model)), current,
        country ? (models.length > start + 72 ? current + 1 : current) : Math.max(current, Math.ceil((data.total_count || 0) / limit)));
    }
    async search(query, page = 1, filters = {}) {
      const needle = String(query || '').trim().toLowerCase();
      const country = filters.country && filters.country !== 'all' ? filters.country : '';
      const depth = Math.max(1, Number(app.Settings ? app.Settings.get('search_pages', 3) : 3));
      const found = [];
      for (let index = 0; index < depth; index += 1) {
        const data = await this.requestModels('all', index * 400, 400);
        (data.models || []).forEach((model) => {
          const name = `${model.username || ''} ${model.display_name || ''}`.toLowerCase();
          const matchesCountry = !country || U.normalizeLanguage(model.country || model.lang) === country;
          if (name.includes(needle) && matchesCountry) found.push(model);
        });
        if (found.length >= 72 * page) break;
      }
      const start = (page - 1) * 72;
      return U.result(found.slice(start, start + 72).map((model) => this.mapModel(model)), page, found.length > start + 72 ? page + 1 : page);
    }
    getVideo(id, item = {}) {
      const model = item.sourceData || this.models.get(String(id));
      const username = model ? model.username : id;
      const stream = model && model.esid && username ? this.config.stream(model.esid, username) : '';
      return Promise.resolve({
        title: item.title || username || this.getName(), poster: item.poster || '',
        streams: stream ? { HLS: stream } : {}, webpageUrl: item.webpageUrl || `${this.config.roomBase}/${encodeURIComponent(username)}`,
        headers: { Referer: `${this.config.host}/` }
      });
    }
  }

  app.LiveAdapters = { BongaNetworkAdapter, LIVE_COUNTRIES };
})(window);
