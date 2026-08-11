(function stripchatAdapterModule(global) {
  'use strict';

  const app = global.SisiPlus;
  if (!app || !app.Adapter || !app.Api) throw new Error('SisiPlus core не загружен');

  const API_URL = 'https://go.rmhfrtnd.com/api/models';
  const SITE_URL = 'https://ru.stripchat.com';
  const PAGE_SIZE = 60;
  const SEARCH_PAGE_SIZE = 400;
  const ACCOUNT_API = 'https://stripchat.com/api/front';

  class StripchatAdapter extends app.Adapter {
    constructor() {
      super('stripchat');
      this.models = new Map();
      this.accountToken = null;
      this.accountTokenExpires = 0;
    }

    getName() { return 'Stripchat'; }
    getCapabilities() { return { account: true, favorites: true, liveTv: true }; }
    getLiveTVItems(options = {}) { return this.getList('popular', options.page || 1, {}); }

    getFilters() {
      return Promise.resolve([app.AdapterUtils.countryFilter()]);
    }

    getCategories() {
      return Promise.resolve([
        { id: 'popular', title: 'Популярные', group: 'type' },
        { id: 'girls/best', title: 'Девушки', group: 'type' },
        { id: 'girls/new', title: 'Новые модели', group: 'type' },
        { id: 'girls/russian', title: 'Русскоязычные', group: 'type' },
        { id: 'couples/best', title: 'Пары', group: 'type' },
        { id: 'men/best', title: 'Парни', group: 'type' },
        { id: 'trans/best', title: 'Транс-модели', group: 'type' },
        { id: 'girls/vr', title: 'VR-камеры', group: 'feature' }
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
      const country = this.modelCountry(model);
      return {
        id: String(model.id),
        title: model.username,
        poster: model.snapshotUrl || model.widgetPreviewUrl || model.avatarUrl || '',
        background: model.previewUrlThumbBig || model.previewUrl || model.snapshotUrl || '',
        preview: model.previewUrl || '',
        badge: model.viewersCount ? `${model.viewersCount} зр.` : status,
        webpageUrl: `${SITE_URL}/${encodeURIComponent(model.username)}`,
        country,
        sourceData: model
      };
    }

    modelCountry(model) {
      return app.AdapterUtils.normalizeLanguage(
        model.modelsCountry || model.country || model.countryCode || model.language || ''
      );
    }

    async getList(category = 'popular', page = 1, filters = {}) {
      const currentPage = Math.max(1, Number(page) || 1);
      const country = filters.country && filters.country !== 'all' ? filters.country : '';
      if (country) {
        // Публичный endpoint Stripchat иногда лишь поднимает выбранную страну
        // вверх, а затем добавляет комнаты других стран. Поэтому параметр API
        // используется как подсказка, но окончательная фильтрация всегда наша.
        const wanted = currentPage * PAGE_SIZE;
        const found = [];
        for (let batch = 0; batch < 3 && found.length < wanted; batch += 1) {
          const data = await this.requestModels({
            limit: SEARCH_PAGE_SIZE, offset: batch * SEARCH_PAGE_SIZE, tag: category, country
          });
          (data.models || []).forEach((model) => {
            if (this.modelCountry(model) === country) found.push(model);
          });
          if (!(data.models || []).length) break;
        }
        const unique = Array.from(new Map(found.map((model) => [String(model.id), model])).values());
        const start = (currentPage - 1) * PAGE_SIZE;
        return {
          items: unique.slice(start, start + PAGE_SIZE).map((model) => this.mapModel(model)),
          page: currentPage,
          totalPages: unique.length > start + PAGE_SIZE ? currentPage + 1 : currentPage
        };
      }
      const data = await this.requestModels({
        limit: PAGE_SIZE, offset: (currentPage - 1) * PAGE_SIZE, tag: category
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

    sessionCookie(session) {
      return String(session || '').replace(/^cookie\s*:\s*/i, '').trim();
    }

    findDeep(value, keys) {
      if (!value || typeof value !== 'object') return undefined;
      for (const key of Object.keys(value)) {
        if (keys.includes(key) && value[key] !== undefined && value[key] !== null) return value[key];
      }
      for (const child of Object.values(value)) {
        if (child && typeof child === 'object') {
          const found = this.findDeep(child, keys);
          if (found !== undefined) return found;
        }
      }
      return undefined;
    }

    async accountConfig(session, force = false) {
      if (!force && this.accountToken && this.accountTokenExpires > Date.now()) {
        return { token: this.accountToken, account: this.accountName || '' };
      }
      const config = await app.Api.siteJson(`${ACCOUNT_API}/v3/config/dynamic`, {
        referer: 'https://stripchat.com/', proxy: 'never', retries: 0,
        headers: { Cookie: this.sessionCookie(session), Accept: 'application/json' }
      });
      const token = this.findDeep(config, ['jwtToken', 'jwt_token', 'jwt']);
      const user = this.findDeep(config, ['user', 'currentUser', 'loggedUser']);
      const account = user && typeof user === 'object'
        ? (user.username || user.login || user.name || '')
        : (this.findDeep(config, ['username', 'userName']) || '');
      const guest = user && typeof user === 'object' && (user.isGuest === true || user.guest === true);
      this.accountToken = token || '';
      this.accountName = account || '';
      this.accountTokenExpires = Date.now() + 4 * 60_000;
      return { token: this.accountToken, account: this.accountName, guest, config };
    }

    clearSession() {
      this.accountToken = null;
      this.accountName = '';
      this.accountTokenExpires = 0;
    }

    async favoriteRequest(path, session, forceToken = false) {
      const account = await this.accountConfig(session, forceToken);
      if (!account.token) throw new Error('Stripchat не выдал токен сессии');
      return app.Api.siteJson(`${ACCOUNT_API}${path}`, {
        referer: 'https://stripchat.com/favorites', proxy: 'never', retries: 0,
        headers: {
          Cookie: this.sessionCookie(session), Authorization: account.token,
          Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest'
        }
      });
    }

    async validateSession(session) {
      const account = await this.accountConfig(session, true);
      if (!account.token || account.guest || !account.account) {
        return { valid: false, message: 'Сессия Stripchat не содержит авторизованный аккаунт' };
      }
      try {
        await this.favoriteRequest('/models/favorites?limit=1&offset=0', session);
      } catch (error) {
        this.clearSession();
        return { valid: false, message: 'Stripchat отклонил сессию или она истекла' };
      }
      return { valid: true, account: account.account };
    }

    favoriteModels(payload) {
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.models)) return payload.models;
      if (payload && payload.data && Array.isArray(payload.data.models)) return payload.data.models;
      if (payload && payload.result && Array.isArray(payload.result.models)) return payload.result.models;
      return [];
    }

    async getFavorites(session) {
      let online;
      let offline;
      try {
        [online, offline] = await Promise.all([
          this.favoriteRequest('/models/favorites?limit=100&offset=0', session),
          this.favoriteRequest('/models/favorites/offline?limit=100&offset=0', session)
        ]);
      } catch (error) {
        // JWT динамический. Один раз обновляем его, затем отдаём реальную ошибку.
        this.clearSession();
        [online, offline] = await Promise.all([
          this.favoriteRequest('/models/favorites?limit=100&offset=0', session, true),
          this.favoriteRequest('/models/favorites/offline?limit=100&offset=0', session)
        ]);
      }
      const onlineItems = this.favoriteModels(online).map((model) => this.mapModel(model));
      const offlineItems = this.favoriteModels(offline).map((model) => {
        const item = this.mapModel(model);
        item.badge = 'OFFLINE';
        item.offline = true;
        return item;
      });
      return Array.from(new Map(onlineItems.concat(offlineItems).map((item) => [String(item.id), item])).values());
    }
  }

  app.registerAdapter(new StripchatAdapter());
})(window);
