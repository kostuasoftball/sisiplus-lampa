(function chaturbateAdapterModule(global) {
  'use strict';
  const app = global.SisiPlus;
  const U = app.AdapterUtils;
  const SITE = 'https://chaturbate.com';
  const API = `${SITE}/api/public/affiliates/onlinerooms/`;
  const COUNTRIES = app.LiveAdapters.LIVE_COUNTRIES;

  class ChaturbateAdapter extends app.Adapter {
    constructor() { super('chaturbate'); this.models = new Map(); }
    getName() { return 'Chaturbate'; }
    getCategories() {
      return Promise.resolve([
        { id: 'all', title: 'Популярные' }, { id: 'f', title: 'Девушки' },
        { id: 'm', title: 'Парни' }, { id: 'c', title: 'Пары' }, { id: 't', title: 'Транс-модели' }
      ]);
    }
    getFilters() { return Promise.resolve([U.countryFilter(COUNTRIES)]); }
    requestModels(category, offset, limit, tag = '') {
      const url = new URL(API);
      url.searchParams.set('wm', String(app.Settings ? app.Settings.get('chaturbate_wm', '9cg6A') : '9cg6A'));
      url.searchParams.set('client_ip', 'request_ip');
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      if (category && category !== 'all') url.searchParams.set('gender', category);
      if (tag) url.searchParams.set('tag', tag);
      return app.Api.cached(`cb:${url}`, () => app.Api.siteJson(url.href, { referer: `${SITE}/` }), 20_000);
    }
    mapModel(model) {
      const country = String(model.country || '').toLowerCase();
      const item = {
        id: model.username, title: model.display_name || model.username,
        poster: model.image_url_360x270 || model.image_url || '', background: model.image_url || '',
        badge: [model.is_hd ? 'HD' : '', model.num_users ? `${model.num_users} зр.` : '', country ? U.countryLabel(country) : ''].filter(Boolean).join(' · '),
        webpageUrl: `${SITE}/${encodeURIComponent(model.username)}/`, country, sourceData: model
      };
      this.models.set(model.username, model);
      return item;
    }
    async getList(category = 'all', page = 1, filters = {}) {
      const country = filters.country && filters.country !== 'all' ? filters.country : '';
      const limit = country ? 500 : 90;
      const data = await this.requestModels(category, (page - 1) * limit, limit);
      // The affiliate feed may include rooms that have just switched to a
      // private/hidden show. Their pages deliberately expose an empty HLS URL,
      // so do not present those stale cards as playable live rooms.
      let models = (data.results || []).filter((model) => !model.current_show || model.current_show === 'public');
      if (country) models = models.filter((model) => String(model.country || '').toLowerCase() === country);
      return U.result(models.slice(0, 90).map((model) => this.mapModel(model)), page, models.length >= limit ? page + 1 : page);
    }
    async search(query, page = 1, filters = {}) {
      const needle = String(query || '').trim().toLowerCase();
      const country = filters.country && filters.country !== 'all' ? filters.country : '';
      const data = await this.requestModels('all', 0, 500, needle.replace(/\s+/g, '-'));
      const matches = (data.results || []).filter((model) => {
        if (model.current_show && model.current_show !== 'public') return false;
        const text = `${model.username} ${model.display_name || ''} ${(model.tags || []).join(' ')}`.toLowerCase();
        return text.includes(needle) && (!country || String(model.country || '').toLowerCase() === country);
      });
      return U.result(matches.map((model) => this.mapModel(model)), page, page);
    }
    async getVideo(id, item = {}) {
      const username = item.id || id;
      const pageUrl = item.webpageUrl || `${SITE}/${encodeURIComponent(username)}/`;
      const html = await app.Api.siteText(pageUrl, {
        referer: `${SITE}/`, headers: { Cookie: 'agreeterms=1; over18=1' }
      });
      let stream = '';
      const assignment = html.match(/initialRoomDossier\s*=\s*("(?:\\.|[^"\\])*")/);
      if (assignment) {
        try {
          const dossier = JSON.parse(JSON.parse(assignment[1]));
          stream = dossier.hls_source || '';
        } catch (error) {}
      }
      if (!stream) {
        // Chaturbate encodes quotes as \u0022. Stop at the encoded closing
        // quote as well; otherwise an empty HLS value captures the remainder
        // of the room dossier and is later mistaken for a media URL.
        const escaped = html.match(/hls_source\\u0022\s*:\s*\\u0022([\s\S]*?)\\u0022/);
        if (escaped) {
          try { stream = JSON.parse(`"${escaped[1]}"`); } catch (error) {}
        }
      }
      return { title: item.title || username, poster: item.poster || '', streams: stream ? { HLS: stream } : {}, webpageUrl: pageUrl, headers: { Referer: `${SITE}/` } };
    }
  }
  app.registerAdapter(new ChaturbateAdapter());
})(window);
