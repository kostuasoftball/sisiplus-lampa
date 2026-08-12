(function sisiplusLiveBase(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  // Единый полный справочник для всех live-адаптеров. Отсутствующая в текущей
  // выдаче страна просто вернёт пустой список и не требует правок интерфейса.
  const LIVE_COUNTRIES = U.COUNTRY_OPTIONS;
  const COUNTRY_TAGS = {
    ru: 'russian', ua: 'ukrainian', by: 'belarusian', kz: 'kazakh', us: 'american', gb: 'british',
    de: 'german', fr: 'french', es: 'spanish', it: 'italian', br: 'brazilian', co: 'colombian',
    mx: 'mexican', ar: 'argentinian', pl: 'polish', cz: 'czech', ro: 'romanian', nl: 'dutch',
    jp: 'japanese', cn: 'chinese', kr: 'korean', in: 'indian', ph: 'filipina'
  };

  class BongaNetworkAdapter extends app.Adapter {
    constructor(id, config) {
      super(id);
      this.config = config;
      this.models = new Map();
    }
    getName() { return this.config.name; }
    getCapabilities() { return {}; }
    getCategories() {
      return Promise.resolve([
        { id: 'all', title: 'Популярные', group: 'type' }, { id: 'new', title: 'Новые', group: 'type' },
        { id: 'female', title: 'Девушки', group: 'type' }, { id: 'couples', title: 'Пары', group: 'type' },
        { id: 'male', title: 'Парни', group: 'type' }, { id: 'transsexual', title: 'Транс-модели', group: 'type' }
      ]);
    }
    getFilters() { return Promise.resolve([U.countryFilter(LIVE_COUNTRIES)]); }
    listingPage(category, offset, limit, country = '') {
      const routes = { all: '', new: 'new-models', female: 'female', couples: 'couples', male: 'male', transsexual: 'trans' };
      let route = routes[category || 'all'] == null ? '' : routes[category || 'all'];
      const tag = COUNTRY_TAGS[country];
      if (tag) route = [route, 'tags', tag].filter(Boolean).join('/');
      const url = new URL(route ? `${this.config.host}/${route}` : `${this.config.host}/`);
      const page = Math.floor(Math.max(0, Number(offset) || 0) / Math.max(1, Number(limit) || 72)) + 1;
      if (page > 1) url.searchParams.set('page', String(page));
      return url.href;
    }
    parseListingPage(html) {
      const match = String(html || '').match(/<script[^>]+id=["']listingConfiguration["'][^>]*>([\s\S]*?)<\/script>/i);
      if (!match) return null;
      try {
        const data = JSON.parse(U.decodeHtml(match[1]));
        const models = data && data.stateData && Array.isArray(data.stateData.models) ? data.stateData.models : [];
        if (!models.length) return null;
        return { models, total_count: Number(data.stateData.online_count || models.length) };
      } catch (error) { return null; }
    }
    async requestListingPage(category, offset, limit, country = '') {
      const url = this.listingPage(category, offset, limit, country);
      let html = await app.Api.siteText(url, { referer: `${this.config.host}/`, retries: 0 });
      let data = this.parseListingPage(html);
      if (!data) {
        html = await app.Api.siteText(url, { referer: `${this.config.host}/`, proxy: 'always', retries: 0 });
        data = this.parseListingPage(html);
      }
      if (!data) throw new Error(`${this.getName()} не вернул каталог ни через API, ни через страницу`);
      if (country) data.models.forEach((model) => { model._sisiplusCountry = country; });
      return data;
    }
    async requestModels(category, offset, limit, country = '') {
      const url = new URL(`${this.config.host}/tools/listing_v3.php`);
      url.searchParams.set('livetab', category || 'all');
      url.searchParams.set('offset', String(offset || 0));
      url.searchParams.set('limit', String(limit || 72));
      if (country && COUNTRY_TAGS[country]) url.searchParams.set('tag', COUNTRY_TAGS[country]);
      const headers = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' };
      return app.Api.cached(`${this.id}:${url}`, async () => {
        try {
          const data = await app.Api.siteJson(url.href, {
            referer: `${this.config.host}/`, headers, retries: 0
          });
          if (data && Array.isArray(data.models) && data.models.length) {
            if (country) data.models.forEach((model) => { model._sisiplusCountry = country; });
            return data;
          }
        } catch (error) {
          console.warn(`[SisiPlus:${this.id}] listing API недоступен, использую HTML-каталог: ${error.message || error}`);
        }
        return this.requestListingPage(category, offset, limit, country);
      }, 20_000);
    }
    mapModel(model) {
      const username = model.username;
      const id = String(username || model.id || '');
      const poster = U.absolute(this.config.host, String(model.thumb_image || '').replace('{ext}', 'jpg'));
      const country = U.normalizeLanguage(model.country || model.lang || model._sisiplusCountry || '');
      const item = {
        id, title: model.display_name || username, poster, background: poster,
        badge: model.viewers ? `${model.viewers} зр.` : (model.vq || 'LIVE'),
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
      const data = await this.requestModels(category, country ? 0 : (current - 1) * limit, limit, country);
      let models = data.models || [];
      if (country) models = models.filter((model) => U.normalizeLanguage(model.country || model.lang || model._sisiplusCountry) === country);
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
        const data = await this.requestModels('all', index * 400, 400, country);
        (data.models || []).forEach((model) => {
          const name = `${model.username || ''} ${model.display_name || ''}`.toLowerCase();
          const matchesCountry = !country || U.normalizeLanguage(model.country || model.lang || model._sisiplusCountry) === country;
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
